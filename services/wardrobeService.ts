import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { isGarmentCategory } from '../types/product';
import type { SavedOutfit, WardrobeItem } from '../types/wardrobe';

export interface WardrobeData {
  wardrobeItems: WardrobeItem[];
  savedOutfits: SavedOutfit[];
}
const key = (userId: string): string =>
  `vitrify.wardrobe.v1.${encodeURIComponent(userId)}`;
export async function loadWardrobe(userId: string): Promise<WardrobeData> {
  const value = await AsyncStorage.getItem(key(userId));
  if (!value) return { wardrobeItems: [], savedOutfits: [] };
  const data = JSON.parse(value) as WardrobeData;
  if (
    !Array.isArray(data.wardrobeItems) ||
    !Array.isArray(data.savedOutfits) ||
    !data.wardrobeItems.every(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.imageUrl === 'string' &&
        typeof item.brand === 'string' &&
        typeof item.createdAt === 'string' &&
        isGarmentCategory(item.category),
    ) ||
    !data.savedOutfits.every(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        Array.isArray(item.wardrobeItemIds) &&
        Array.isArray(item.catalogProductIds),
    )
  ) {
    throw new Error('Dolap kayıtları okunamadı.');
  }
  return data;
}
export const saveWardrobe = (
  userId: string,
  data: WardrobeData,
): Promise<void> => AsyncStorage.setItem(key(userId), JSON.stringify(data));

export async function storeWardrobePhoto(
  userId: string,
  id: string,
  uri: string,
): Promise<string> {
  if (!FileSystem.documentDirectory)
    throw new Error('Fotoğraf klasörü kullanılamıyor.');
  const directory = `${FileSystem.documentDirectory}wardrobe/${encodeURIComponent(userId)}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension =
    uri.split(/[?#]/)[0].match(/\.(png|jpe?g|heic|webp)$/i)?.[1] ?? 'jpg';
  const destination = `${directory}${id}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}
