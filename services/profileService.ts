import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import { logger } from '../lib/logger';
import { preparePersonJpegUri } from '../lib/personPhotoPrepare';
import {
  clampHeightCm,
  clampWeightKg,
  isGarmentSize,
  parseStyleTags,
  parseStudioPreferences,
} from '../lib/profileStudio';
import { getRequiredSupabaseClient } from '../lib/supabase';
import type { StudioProfilePatch, UserStudioProfile } from '../types/profile';

export const MODEL_PHOTOS_BUCKET = 'model-photos';
const MODEL_PHOTO_FILENAME = 'model.jpg';
const SIGNED_URL_TTL_SEC = 60 * 60;
const UPLOAD_TIMEOUT_MS = 60_000;

interface ProfileRow {
  id: string;
  height_cm: number | null;
  weight_kg: number | null;
  top_size: string | null;
  bottom_size: string | null;
  style_tags: unknown;
  model_photo_path: string | null;
}

interface UploadProgressParams {
  onProgress: (progress: number) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isProfileRow = (value: unknown): value is ProfileRow => {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return false;
  }
  return (
    (typeof value.height_cm === 'number' || value.height_cm === null) &&
    (typeof value.weight_kg === 'number' || value.weight_kg === null) &&
    (typeof value.top_size === 'string' || value.top_size === null) &&
    (typeof value.bottom_size === 'string' || value.bottom_size === null) &&
    (typeof value.model_photo_path === 'string' ||
      value.model_photo_path === null)
  );
};

const modelPhotoPathFor = (userId: string): string =>
  `${userId}/${MODEL_PHOTO_FILENAME}`;

const emptyProfile = (userId: string): UserStudioProfile => ({
  userId,
  heightCm: null,
  weightKg: null,
  topSize: null,
  bottomSize: null,
  styleTags: [],
  modelPhotoPath: null,
});

const mapRow = (row: ProfileRow): UserStudioProfile => ({
  userId: row.id,
  heightCm: typeof row.height_cm === 'number' ? row.height_cm : null,
  weightKg: typeof row.weight_kg === 'number' ? row.weight_kg : null,
  topSize: isGarmentSize(row.top_size) ? row.top_size : null,
  bottomSize: isGarmentSize(row.bottom_size) ? row.bottom_size : null,
  styleTags: parseStyleTags(row.style_tags),
  modelPhotoPath: row.model_photo_path,
});

const requireAccessToken = async (): Promise<string> => {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    logger.error('Oturum tokenı okunamadı', { detail: error.message });
    throw new Error('Oturum doğrulanamadı. Çıkıp tekrar giriş yapmayı dene.');
  }
  const token = data.session?.access_token?.trim();
  if (!token) {
    throw new Error('Model fotoğrafı için giriş yapmalısın.');
  }
  return token;
};

const uploadBinaryWithProgress = (
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      logger.error('Model fotoğrafı yüklenemedi', { status: xhr.status });
      reject(new Error('Fotoğraf yüklenemedi. Lütfen tekrar dene.'));
    };
    xhr.onerror = () => {
      reject(new Error('Fotoğraf yüklenemedi. Bağlantını kontrol et.'));
    };
    xhr.ontimeout = () => {
      reject(new Error('Yükleme zaman aşımına uğradı. Tekrar dene.'));
    };
    xhr.send(body);
  });

export const fetchStudioProfile = async (
  userId: string,
): Promise<UserStudioProfile> => {
  const client = getRequiredSupabaseClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || auth.user?.id !== userId)
    throw new Error('Profil için geçerli oturum gerekli.');
  const preferences = parseStudioPreferences(
    auth.user.user_metadata.studio_preferences,
  );
  const { data, error } = await client
    .from('profiles')
    .select(
      'id, height_cm, weight_kg, top_size, bottom_size, style_tags, model_photo_path',
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logger.error('Profil okunamadı', { detail: error.message });
    throw new Error('Profil bilgileri yüklenemedi. Lütfen tekrar dene.');
  }

  if (data === null) {
    return { ...emptyProfile(userId), ...preferences };
  }

  if (!isProfileRow(data)) {
    logger.error('Profil satırı beklenen biçimde değil');
    return { ...emptyProfile(userId), ...preferences };
  }

  return { ...mapRow(data), ...preferences };
};

export const upsertStudioProfile = async (
  userId: string,
  patch: StudioProfilePatch,
): Promise<UserStudioProfile> => {
  const client = getRequiredSupabaseClient();
  const hasPreferences =
    patch.favoriteBrands !== undefined ||
    patch.preferredColors !== undefined ||
    patch.priceRange !== undefined;
  if (hasPreferences) {
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || auth.user?.id !== userId)
      throw new Error('Profil için geçerli oturum gerekli.');
    if (
      patch.priceRange !== undefined &&
      patch.priceRange !== null &&
      !parseStudioPreferences({ priceRange: patch.priceRange }).priceRange
    )
      throw new Error('Geçerli bir minimum ve maksimum fiyat seç.');
    const preferences = parseStudioPreferences({
      ...parseStudioPreferences(auth.user.user_metadata.studio_preferences),
      ...(patch.favoriteBrands !== undefined && {
        favoriteBrands: patch.favoriteBrands,
      }),
      ...(patch.preferredColors !== undefined && {
        preferredColors: patch.preferredColors,
      }),
      ...(patch.priceRange !== undefined && { priceRange: patch.priceRange }),
    });
    const { error } = await client.auth.updateUser({
      data: { studio_preferences: preferences },
    });
    if (error) throw new Error('Değişiklik kaydedilemedi. Lütfen tekrar dene.');
    if (
      Object.keys(patch).every((key) =>
        ['favoriteBrands', 'preferredColors', 'priceRange'].includes(key),
      )
    )
      return fetchStudioProfile(userId);
  }
  const payload: Record<string, unknown> = {
    id: userId,
    updated_at: new Date().toISOString(),
  };

  if (patch.heightCm !== undefined) {
    payload.height_cm =
      patch.heightCm === null ? null : clampHeightCm(patch.heightCm);
  }
  if (patch.weightKg !== undefined) {
    payload.weight_kg =
      patch.weightKg === null ? null : clampWeightKg(patch.weightKg);
  }
  if (patch.topSize !== undefined) {
    payload.top_size = patch.topSize;
  }
  if (patch.bottomSize !== undefined) {
    payload.bottom_size = patch.bottomSize;
  }
  if (patch.styleTags !== undefined) {
    payload.style_tags = patch.styleTags;
  }
  if (patch.modelPhotoPath !== undefined) {
    payload.model_photo_path = patch.modelPhotoPath;
  }

  const { data, error } = await client
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select(
      'id, height_cm, weight_kg, top_size, bottom_size, style_tags, model_photo_path',
    )
    .single();

  if (error || !isProfileRow(data)) {
    logger.error('Profil kaydedilemedi', { detail: error?.message });
    throw new Error('Değişiklik kaydedilemedi. Lütfen tekrar dene.');
  }

  if (patch.styleTags !== undefined) {
    void syncDeclaredStyleTags(patch.styleTags);
  }

  return mapRow(data);
};

export const syncDeclaredStyleTags = async (tags: string[]): Promise<void> => {
  try {
    const client = getRequiredSupabaseClient();
    const { error } = await client.rpc('sync_declared_style_tags', {
      p_tags: tags,
    });
    if (error) {
      logger.debug('Declared style sync başarısız', { detail: error.message });
    }
  } catch (error) {
    logger.debug('Declared style sync başarısız', { error });
  }
};

export const uploadModelPhoto = async (
  userId: string,
  localUri: string,
  { onProgress }: UploadProgressParams,
): Promise<UserStudioProfile> => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(
    /\/+$/,
    '',
  );
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase yapılandırması eksik.');
  }

  onProgress(0.08);
  const jpegUri = await preparePersonJpegUri(localUri);
  onProgress(0.18);
  const fileResponse = await fetch(jpegUri);
  const blob = await fileResponse.blob();
  const path = modelPhotoPathFor(userId);
  const token = await requireAccessToken();
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${MODEL_PHOTOS_BUCKET}/${path}`;

  await uploadBinaryWithProgress(
    uploadUrl,
    blob,
    {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
      'cache-control': '3600',
    },
    (progress) => {
      onProgress(0.18 + progress * 0.8);
    },
  );
  onProgress(1);

  return upsertStudioProfile(userId, { modelPhotoPath: path });
};

export const removeModelPhoto = async (
  userId: string,
): Promise<UserStudioProfile> => {
  const client = getRequiredSupabaseClient();
  const path = modelPhotoPathFor(userId);
  const { error } = await client.storage
    .from(MODEL_PHOTOS_BUCKET)
    .remove([path]);

  if (error) {
    logger.error('Model fotoğrafı silinemedi', { detail: error.message });
    throw new Error('Fotoğraf kaldırılamadı. Lütfen tekrar dene.');
  }

  return upsertStudioProfile(userId, { modelPhotoPath: null });
};

export const createModelPhotoSignedUrl = async (
  path: string,
): Promise<string | null> => {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client.storage
    .from(MODEL_PHOTOS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);

  if (error || !data?.signedUrl) {
    logger.error('Model fotoğrafı adresi alınamadı', {
      detail: error?.message,
    });
    return null;
  }

  return data.signedUrl;
};

/**
 * VTON yerel dosya bekler; imzalı HTTPS URI File API ile okunmaz.
 * Kayıtlı fotoğrafı cache'e indirip file:// döner.
 */
export const resolveSavedModelPhotoUri = async (
  userId: string,
): Promise<string | null> => {
  const profile = await fetchStudioProfile(userId);
  if (!profile.modelPhotoPath) {
    return null;
  }

  const signedUrl = await createModelPhotoSignedUrl(profile.modelPhotoPath);
  const directory = cacheDirectory;
  if (!signedUrl || !directory) {
    return null;
  }

  const localUri = `${directory}kabin-model-${userId}.jpg`;
  const result = await downloadAsync(signedUrl, localUri);
  return result.uri;
};
