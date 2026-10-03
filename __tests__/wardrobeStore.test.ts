import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { useAppStore } from '../store/useAppStore';
import { loadWardrobe } from '../services/wardrobeService';
import type { OutfitChoice } from '../lib/outfitSelection';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/likeService', () => ({
  fetchLikedProducts: jest.fn().mockResolvedValue([]),
  fetchPassedProductIds: jest.fn().mockResolvedValue([]),
}));
const input = {
  title: 'Gömleğim',
  brand: '',
  category: 'upper_body' as const,
  imageUrl: 'file:///cache/photo.jpg',
};
describe('local wardrobe CRUD', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    useAppStore.getState().resetSession();
    await useAppStore.getState().hydrateSession('owner');
  });
  it('stores a durable photo, updates state after save and restores it on login', async () => {
    await useAppStore.getState().addWardrobeItem(input);
    const item = useAppStore.getState().wardrobeItems[0];
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: input.imageUrl,
      to: item.imageUrl,
    });
    expect(item.imageUrl).toMatch(/^file:\/\/\/documents\/wardrobe\/owner\//);
    expect((await loadWardrobe('owner')).wardrobeItems).toEqual([item]);
    useAppStore.getState().resetSession();
    expect(useAppStore.getState().wardrobeItems).toEqual([]);
    await useAppStore.getState().hydrateSession('owner');
    expect(useAppStore.getState().wardrobeItems).toEqual([item]);
  });
  it('edits and removes the last item without touching favorites', async () => {
    await useAppStore.getState().addWardrobeItem(input);
    const id = useAppStore.getState().wardrobeItems[0].id;
    await useAppStore.getState().updateWardrobeItem(id, {
      title: 'Yeni ad',
      brand: 'Markam',
      category: 'lower_body',
    });
    expect(useAppStore.getState().wardrobeItems[0]).toMatchObject({
      title: 'Yeni ad',
      category: 'lower_body',
    });
    await useAppStore.getState().removeWardrobeItem(id);
    expect(useAppStore.getState().wardrobeItems).toEqual([]);
    expect((await loadWardrobe('owner')).wardrobeItems).toEqual([]);
    expect(useAppStore.getState().likedProducts).toEqual([]);
  });
  it('serializes concurrent additions and keeps different accounts separate', async () => {
    await Promise.all([
      useAppStore.getState().addWardrobeItem(input),
      useAppStore.getState().addWardrobeItem({ ...input, title: 'Pantolonum' }),
    ]);
    expect(useAppStore.getState().wardrobeItems).toHaveLength(2);
    await useAppStore.getState().hydrateSession('other');
    expect(useAppStore.getState().wardrobeItems).toEqual([]);
    await useAppStore.getState().hydrateSession('owner');
    expect(useAppStore.getState().wardrobeItems).toHaveLength(2);
  });
  it('does not display a successful addition when persistence fails', async () => {
    jest
      .mocked(AsyncStorage.setItem)
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(useAppStore.getState().addWardrobeItem(input)).rejects.toThrow(
      'disk full',
    );
    expect(useAppStore.getState().wardrobeItems).toEqual([]);
    await useAppStore.getState().addWardrobeItem(input);
    expect(useAppStore.getState().wardrobeItems).toHaveLength(1);
  });
  it('loads existing saved outfits without manufacturing sample outfits', async () => {
    const outfit = {
      id: 'saved-1',
      title: 'Günlük kombin',
      wardrobeItemIds: ['owned-1'],
      catalogProductIds: ['catalog-1'],
      createdAt: '2026-09-28',
    };
    await AsyncStorage.setItem(
      'vitrify.wardrobe.v1.owner',
      JSON.stringify({ wardrobeItems: [], savedOutfits: [outfit] }),
    );
    await useAppStore.getState().hydrateWardrobe('owner');
    expect(useAppStore.getState().savedOutfits).toEqual([outfit]);
  });
  it('creates and persists a combination of the exact chosen owned garments', async () => {
    await useAppStore.getState().addWardrobeItem(input);
    await useAppStore.getState().addWardrobeItem({
      ...input,
      title: 'Pantolonum',
      category: 'lower_body',
    });
    const [top, bottom] = useAppStore.getState().wardrobeItems;
    const upper: OutfitChoice = {
      key: `wardrobe:${top.id}`,
      source: 'wardrobe',
      item: top,
    };
    const lower: OutfitChoice = {
      key: `wardrobe:${bottom.id}`,
      source: 'wardrobe',
      item: bottom,
    };
    await useAppStore
      .getState()
      .createOutfit({ upper_body: upper, lower_body: lower });
    const saved = useAppStore.getState().savedOutfits[0];
    expect(saved.wardrobeItemIds).toEqual([top.id, bottom.id]);
    expect(saved.catalogProductIds).toEqual([]);
    expect((await loadWardrobe('owner')).savedOutfits).toEqual([saved]);
    useAppStore.getState().resetSession();
    await useAppStore.getState().hydrateSession('owner');
    expect(useAppStore.getState().savedOutfits).toEqual([saved]);
    await useAppStore.getState().removeWardrobeItem(top.id);
    await expect(
      useAppStore
        .getState()
        .createOutfit({ upper_body: upper, lower_body: lower }),
    ).rejects.toThrow('kaldırılmış');
    expect(useAppStore.getState().savedOutfits).toHaveLength(1);
  });
});
