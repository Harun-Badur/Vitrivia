import { create } from 'zustand';
import { createDiscoverySlice, type DiscoverySlice } from './discoverySlice';
import { createFavoritesSlice, type FavoritesSlice } from './favoritesSlice';
import { createProfileSlice, type ProfileSlice } from './profileSlice';
import { createWardrobeSlice, type WardrobeSlice } from './wardrobeSlice';

// Keep the existing flat selector/action API for screens and components.
export type AppState = DiscoverySlice &
  FavoritesSlice &
  ProfileSlice &
  WardrobeSlice;
export type { FeedStatus } from './discoverySlice';
export type { LikeAlertPatch } from './favoritesSlice';
export type { SessionSyncStatus } from './profileSlice';

export const useAppStore = create<AppState>((...args) => ({
  ...createDiscoverySlice(...args),
  ...createFavoritesSlice(...args),
  ...createProfileSlice(...args),
  ...createWardrobeSlice(...args),
}));
