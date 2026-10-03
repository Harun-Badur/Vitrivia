import { router } from 'expo-router';
import type { Product } from '../types/product';

export const openWardrobeList = (
  section: 'clothes' | 'favorites' | 'outfits',
): void =>
  router.push({ pathname: '/wardrobe/[section]', params: { section } });
export const openWardrobeEditor = (id?: string): void =>
  router.push({ pathname: '/wardrobe/add', params: id ? { id } : {} });
export const openOutfitCreator = (product?: Product): void =>
  router.push({
    pathname: '/wardrobe/create',
    params: product ? { productId: product.id, source: 'catalog' } : {},
  });
