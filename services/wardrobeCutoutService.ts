import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getRequiredSupabaseClient } from '../lib/supabase';
import type { WardrobeItem } from '../types/wardrobe';

const BUCKET = 'wardrobe-cutouts';
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;
const endpoint = (): string | undefined =>
  process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL?.trim();

export const wardrobeCutoutConfigured = (): boolean => Boolean(endpoint());

// React Native Storage uploads require bytes, rather than Blob/FormData.
export function decodeCutoutPng(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value) ||
    value.slice(0, -2).includes('=') ||
    (value.endsWith('=') &&
      value[value.length - 2] === '=' &&
      value[value.length - 3] === '=') ||
    (value[value.length - 2] === '=' && !value.endsWith('=='))
  )
    throw new Error('Geçersiz cutout yanıtı.');
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const block =
      (alphabet.indexOf(value[i]) << 18) |
      (alphabet.indexOf(value[i + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(value[i + 2])) << 6) |
      Math.max(0, alphabet.indexOf(value[i + 3]));
    for (const shift of [16, 8, 0])
      if (offset < bytes.length) bytes[offset++] = (block >> shift) & 255;
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  // The local processor always exports an RGBA PNG (IHDR color type 6).
  if (
    bytes.length < 33 ||
    signature.some((byte, index) => bytes[index] !== byte) ||
    bytes[25] !== 6
  )
    throw new Error('Cutout şeffaf PNG formatında değil.');
  return bytes;
}

async function ownerSession(userId: string) {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId)
    throw new Error('Cutout işlemi için geçerli oturum gerekli.');
  return { client, token: data.session.access_token };
}

export async function createWardrobeCutout(
  userId: string,
  item: WardrobeItem,
): Promise<string> {
  const url = endpoint();
  if (!url) throw new Error('Yerel arka plan silme servisi yapılandırılmamış.');
  if (!/^https:\/\//i.test(url) && !(__DEV__ && /^http:\/\//i.test(url)))
    throw new Error('Arka plan silme servisi HTTPS kullanmalı.');
  const { token } = await ownerSession(userId);
  if (!FileSystem.documentDirectory)
    throw new Error('Fotoğraf klasörü kullanılamıyor.');

  // Normalize HEIC/orientation on a separate temporary copy; never alter the original.
  const input = await manipulateAsync(item.imageUrl, [], {
    format: SaveFormat.JPEG,
    compress: 0.9,
  });
  const task = FileSystem.createUploadTask(url, input.uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
  });
  const timer = setTimeout(() => {
    void task.cancelAsync().catch(() => {});
  }, 90_000);
  try {
    const response = await task.uploadAsync();
    if (!response || response.status !== 200)
      throw new Error(
        'Arka plan silinemedi; sonraki yüklemede yeniden denenecek.',
      );
    const body = JSON.parse(response.body) as { pngBase64?: unknown };
    decodeCutoutPng(body.pngBase64);
    const directory = `${FileSystem.documentDirectory}wardrobe/${encodeURIComponent(userId)}/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const uri = `${directory}${encodeURIComponent(item.id)}-cutout.png`;
    await FileSystem.writeAsStringAsync(uri, body.pngBase64 as string, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return uri;
  } finally {
    clearTimeout(timer);
    await FileSystem.deleteAsync(input.uri, { idempotent: true }).catch(
      () => {},
    );
  }
}

export async function uploadWardrobeCutout(
  userId: string,
  item: WardrobeItem,
): Promise<
  Pick<WardrobeItem, 'cutoutUrl' | 'cutoutStoragePath' | 'cutoutUrlExpiresAt'>
> {
  const { client } = await ownerSession(userId);
  const path = `${userId}/${encodeURIComponent(item.id)}/cutout.png`;
  if (item.cutoutStoragePath && item.cutoutStoragePath !== path)
    throw new Error('Cutout dosyasının sahibi eşleşmiyor.');
  const bucket = client.storage.from(BUCKET);
  if (!item.cutoutStoragePath) {
    if (!item.cutoutLocalUri)
      throw new Error('Cutout dosyası henüz hazır değil.');
    const value = await FileSystem.readAsStringAsync(item.cutoutLocalUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = decodeCutoutPng(value);
    const { error } = await bucket.upload(path, bytes.buffer as ArrayBuffer, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) throw new Error('Cutout Storage’a kaydedilemedi.');
  }
  const { data, error } = await bucket.createSignedUrl(
    path,
    SIGNED_URL_SECONDS,
  );
  if (error || !data?.signedUrl)
    throw new Error('Cutout adresi oluşturulamadı.');
  return {
    cutoutUrl: data.signedUrl,
    cutoutStoragePath: path,
    cutoutUrlExpiresAt: Date.now() + SIGNED_URL_SECONDS * 1000,
  };
}
