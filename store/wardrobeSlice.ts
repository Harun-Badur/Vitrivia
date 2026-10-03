import type { StateCreator } from 'zustand';
import {
  loadWardrobe,
  saveWardrobe,
  storeWardrobePhoto,
  type WardrobeData,
} from '../services/wardrobeService';
import {
  wardrobeImage,
  type WardrobeItem,
  type SavedOutfit,
} from '../types/wardrobe';
import {
  createWardrobeCutout,
  uploadWardrobeCutout,
  wardrobeCutoutConfigured,
} from '../services/wardrobeCutoutService';
import { logger } from '../lib/logger';
import type { AppState } from './useAppStore';
import {
  selectedOutfitCandidate,
  type OutfitSelection,
} from '../lib/outfitSelection';

export interface WardrobeSlice {
  wardrobeItems: WardrobeItem[];
  savedOutfits: SavedOutfit[];
  wardrobeStatus: 'idle' | 'loading' | 'ready' | 'error';
  hydrateWardrobe: (userId: string) => Promise<void>;
  addWardrobeItem: (
    item: Pick<WardrobeItem, 'title' | 'imageUrl' | 'category' | 'brand'>,
  ) => Promise<void>;
  updateWardrobeItem: (
    id: string,
    patch: Pick<WardrobeItem, 'title' | 'category' | 'brand'>,
  ) => Promise<void>;
  removeWardrobeItem: (id: string) => Promise<void>;
  createOutfit: (selection: OutfitSelection) => Promise<void>;
}

export const createWardrobeSlice: StateCreator<
  AppState,
  [],
  [],
  WardrobeSlice
> = (set, get) => {
  let queue: Promise<void> = Promise.resolve();
  let cutoutQueue: Promise<void> = Promise.resolve();
  const cutoutTasks = new Set<string>();
  let generation = 0;
  const mutate = (
    change: (data: WardrobeData, userId: string) => Promise<WardrobeData>,
  ): Promise<void> => {
    const userId = get().sessionUserId;
    const version = generation;
    const task = queue.then(async () => {
      if (
        !userId ||
        version !== generation ||
        get().sessionUserId !== userId ||
        get().wardrobeStatus !== 'ready'
      ) {
        throw new Error('Dolabın yüklenmesini bekleyip tekrar dene.');
      }
      const data = await change(
        {
          wardrobeItems: get().wardrobeItems,
          savedOutfits: get().savedOutfits,
        },
        userId,
      );
      if (version !== generation || get().sessionUserId !== userId) {
        throw new Error('Oturum değişti. Kıyafeti yeniden eklemeyi dene.');
      }
      await saveWardrobe(userId, data);
      if (version === generation && get().sessionUserId === userId) set(data);
    });
    queue = task.catch(() => {});
    return task;
  };
  const enqueueCutout = (userId: string, id: string, version: number): void => {
    const taskKey = `${userId}:${id}:${version}`;
    const existing = get().wardrobeItems.find((item) => item.id === id);
    if (
      !existing ||
      cutoutTasks.has(taskKey) ||
      (!existing.cutoutLocalUri &&
        !existing.cutoutStoragePath &&
        !wardrobeCutoutConfigured())
    )
      return;
    cutoutTasks.add(taskKey);
    const currentItem = (): WardrobeItem | undefined =>
      version === generation && get().sessionUserId === userId
        ? get().wardrobeItems.find((item) => item.id === id)
        : undefined;
    const persist = async (patch: Partial<WardrobeItem>): Promise<void> => {
      if (!currentItem()) return;
      await mutate(async (data, owner) => {
        if (owner !== userId || !currentItem()) return data;
        return {
          ...data,
          wardrobeItems: data.wardrobeItems.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        };
      });
    };
    // Inference runs separately from local CRUD, one image at a time.
    cutoutQueue = cutoutQueue.then(async () => {
      try {
        let item = currentItem();
        if (!item) return;
        if (!item.cutoutLocalUri && !item.cutoutStoragePath) {
          const cutoutLocalUri = await createWardrobeCutout(userId, item);
          await persist({ cutoutLocalUri, cutoutStatus: 'pending' });
        }
        item = currentItem();
        if (!item) return;
        const remote = await uploadWardrobeCutout(userId, item);
        await persist({ ...remote, cutoutStatus: 'ready' });
      } catch {
        // A failed upload/inference must not discard the original or block offline CRUD.
        try {
          await persist({ cutoutStatus: 'error' });
        } catch {
          // Keep the persisted pending record for the next hydration retry.
        }
        logger.warn('Dolap cutout işlemi tamamlanamadı; yeniden denenecek.');
      } finally {
        cutoutTasks.delete(taskKey);
      }
    });
  };
  return {
    wardrobeItems: [],
    savedOutfits: [],
    wardrobeStatus: 'idle',
    hydrateWardrobe: async (userId) => {
      const version = ++generation;
      set({ wardrobeItems: [], savedOutfits: [], wardrobeStatus: 'loading' });
      try {
        const data = await loadWardrobe(userId);
        if (version === generation && get().sessionUserId === userId) {
          set({ ...data, wardrobeStatus: 'ready' });
          for (const item of data.wardrobeItems)
            if (
              item.cutoutStatus === 'pending' ||
              item.cutoutStatus === 'error' ||
              (item.cutoutStoragePath &&
                (item.cutoutUrlExpiresAt ?? 0) < Date.now() + 5 * 60 * 1000)
            )
              enqueueCutout(userId, item.id, version);
        }
      } catch {
        if (version === generation && get().sessionUserId === userId)
          set({ wardrobeStatus: 'error' });
      }
    },
    addWardrobeItem: async (input) => {
      const id = `wardrobe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const userId = get().sessionUserId;
      const version = generation;
      await mutate(async (data, userId) => {
        const imageUrl = await storeWardrobePhoto(userId, id, input.imageUrl);
        const item = {
          ...input,
          imageUrl,
          id,
          createdAt: new Date().toISOString(),
          cutoutStatus: 'pending' as const,
        };
        return { ...data, wardrobeItems: [...data.wardrobeItems, item] };
      });
      if (userId) enqueueCutout(userId, id, version);
    },
    updateWardrobeItem: (id, patch) =>
      mutate(async (data) => ({
        ...data,
        wardrobeItems: data.wardrobeItems.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      })),
    removeWardrobeItem: (id) =>
      mutate(async (data) => ({
        ...data,
        wardrobeItems: data.wardrobeItems.filter((item) => item.id !== id),
      })),
    createOutfit: (selection) =>
      mutate(async (data) => {
        const candidate = selectedOutfitCandidate(selection);
        const wardrobeItemIds = candidate.items
          .filter((item) => item.sourceType === 'wardrobe')
          .map((item) => item.sourceId);
        if (
          wardrobeItemIds.some(
            (id) => !data.wardrobeItems.some((item) => item.id === id),
          )
        ) {
          throw new Error(
            'Seçilen kıyafetlerden biri dolabından kaldırılmış. Yeniden seçmelisin.',
          );
        }
        const top = selection.upper_body!.item;
        const outfit: SavedOutfit = {
          id: `outfit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title: `Kombin ${data.savedOutfits.length + 1}`,
          imageUrl:
            selection.upper_body!.source === 'wardrobe'
              ? wardrobeImage(selection.upper_body!.item)
              : top.imageUrl,
          wardrobeItemIds,
          catalogProductIds: candidate.items
            .filter((item) => item.sourceType === 'catalog')
            .map((item) => item.sourceId),
          createdAt: new Date().toISOString(),
        };
        return { ...data, savedOutfits: [...data.savedOutfits, outfit] };
      }),
  };
};
