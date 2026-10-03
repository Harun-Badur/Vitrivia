import type { StateCreator } from 'zustand';
import { logger } from '../lib/logger';
import { setLastFeedMode } from '../lib/recsFeedState';
import { resetSessionIntent } from '../lib/sessionIntent';
import {
  fetchLikedProducts,
  fetchPassedProductIds,
} from '../services/likeService';
import { DEFAULT_FEED_MODE } from '../types/recommendation';
import type { AppState } from './useAppStore';
import { excludeSeen } from './productState';

export type SessionSyncStatus = 'idle' | 'loading' | 'error' | 'success';

export interface ProfileSlice {
  sessionUserId: string | null;
  sessionSyncStatus: SessionSyncStatus;
  hydrateSession: (userId: string) => Promise<void>;
  resetSession: () => void;
}

export const createProfileSlice: StateCreator<
  AppState,
  [],
  [],
  ProfileSlice
> = (set, get) => ({
  sessionUserId: null,
  sessionSyncStatus: 'idle',
  hydrateSession: async (userId): Promise<void> => {
    set({ sessionUserId: userId, sessionSyncStatus: 'loading' });
    const wardrobeLoad = get().hydrateWardrobe(userId);
    try {
      const [likedProducts, passedIds] = await Promise.all([
        fetchLikedProducts(userId),
        fetchPassedProductIds(userId),
      ]);
      set((state) => ({
        likedProducts,
        passedProductIds: passedIds,
        sessionSyncStatus: 'success',
        currentProducts: excludeSeen(
          state.currentProducts,
          likedProducts,
          passedIds,
        ),
      }));
    } catch (error) {
      logger.error('Oturum verisi yüklenemedi', { error });
      set({ sessionSyncStatus: 'error' });
    }
    await wardrobeLoad;
  },
  resetSession: (): void => {
    setLastFeedMode(DEFAULT_FEED_MODE);
    set({
      sessionUserId: null,
      sessionSyncStatus: 'idle',
      wardrobeItems: [],
      savedOutfits: [],
      wardrobeStatus: 'idle',
      likedProducts: [],
      passedProductIds: [],
      passedStack: [],
      feedIsPersonalized: false,
      feedMode: DEFAULT_FEED_MODE,
      feedFallback: false,
      feedRelaxed: [],
    });
    resetSessionIntent();
  },
});
