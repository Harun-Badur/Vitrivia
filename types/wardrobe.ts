import type { GarmentCategory, Product } from './product';

export interface WardrobeItem {
  id: string;
  title: string;
  imageUrl: string;
  // imageUrl always retains the original photo; cutouts are owned-clothes only.
  cutoutUrl?: string;
  cutoutLocalUri?: string;
  cutoutStoragePath?: string;
  cutoutUrlExpiresAt?: number;
  cutoutStatus?: 'pending' | 'ready' | 'error';
  category: GarmentCategory;
  brand: string;
  createdAt: string;
}

const wardrobeImages = (item: WardrobeItem): string[] => [
  ...new Set(
    [item.cutoutUrl, item.cutoutLocalUri, item.imageUrl].filter(
      (uri): uri is string => typeof uri === 'string' && uri.trim().length > 0,
    ),
  ),
];

export const wardrobeImage = (item: WardrobeItem): string =>
  wardrobeImages(item)[0] ?? '';

export interface SavedOutfit {
  id: string;
  title: string;
  imageUrl?: string;
  wardrobeItemIds: string[];
  catalogProductIds: string[];
  createdAt: string;
}

// Presentation adapter only: owned clothes never enter catalog/favorites state.
export const wardrobeProduct = (item: WardrobeItem): Product => ({
  ...item,
  imageUrl: wardrobeImage(item),
  images: wardrobeImages(item),
  price: 0,
  garmentDescription: item.title,
});
