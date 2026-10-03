import { logger } from '../lib/logger';
import { parseNumeric, parseOptionalNumeric } from '../lib/price';
import { getRequiredSupabaseClient } from '../lib/supabase';
import type { AuthUser } from '../types/auth';
import {
  isProductSnapshot,
  isFeedProvider,
  type LikedProduct,
  type Product,
} from '../types/product';

interface LikedProductRow {
  product_id: string;
  product_snapshot: unknown;
  liked_at: string;
  notify_on_price_drop?: boolean | null;
}

interface PassedProductRow {
  product_id: string;
}

interface CatalogPriceRow {
  id: string;
  price: number | string;
  current_price?: number | string | null;
  previous_price?: number | string | null;
  last_price_checked_at?: string | null;
}

export interface UpdateLikeAlertParams {
  userId: string;
  productId: string;
  notifyOnPriceDrop: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toSnapshot = (product: Product): Product => ({
  id: product.id,
  imageUrl: product.imageUrl,
  title: product.title,
  price: product.price,
  currentPrice: product.currentPrice,
  previousPrice: product.previousPrice,
  lastPriceCheckedAt: product.lastPriceCheckedAt,
  brand: product.brand,
  category: product.category,
  outfitRole: product.outfitRole,
  garmentDescription: product.garmentDescription,
  provider: isFeedProvider(product.provider) ? product.provider : undefined,
  productUrl: product.productUrl,
  affiliateUrl: product.affiliateUrl,
  externalId: product.externalId,
});

const isLikedProductRow = (value: unknown): value is LikedProductRow => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.product_id === 'string' && typeof value.liked_at === 'string'
  );
};

const isPassedProductRow = (value: unknown): value is PassedProductRow => {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.product_id === 'string';
};

const isCatalogPriceRow = (value: unknown): value is CatalogPriceRow => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    (typeof value.price === 'number' || typeof value.price === 'string')
  );
};

const applyCatalogPrices = (
  product: Product,
  catalog: CatalogPriceRow | undefined,
): Product => {
  if (!catalog) {
    return product;
  }
  const listPrice = parseNumeric(catalog.price) ?? product.price;
  return {
    ...product,
    price: listPrice,
    currentPrice: parseOptionalNumeric(catalog.current_price),
    previousPrice: parseOptionalNumeric(catalog.previous_price),
    lastPriceCheckedAt:
      typeof catalog.last_price_checked_at === 'string'
        ? catalog.last_price_checked_at
        : product.lastPriceCheckedAt,
  };
};

export const ensureUserProfile = async (user: AuthUser): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const { error } = await client.from('users').upsert(
    {
      id: user.id,
      email: user.email ?? '',
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(`Profil kaydedilemedi: ${error.message}`);
  }
};

const fetchCatalogPrices = async (
  productIds: string[],
): Promise<Map<string, CatalogPriceRow>> => {
  if (productIds.length === 0) {
    return new Map();
  }

  const client = getRequiredSupabaseClient();
  const { data, error } = await client
    .from('products')
    .select('id, price, current_price, previous_price, last_price_checked_at')
    .in('id', productIds);

  if (error) {
    logger.error('Katalog fiyatları okunamadı', { detail: error.message });
    return new Map();
  }

  const map = new Map<string, CatalogPriceRow>();
  (data ?? []).filter(isCatalogPriceRow).forEach((row) => {
    map.set(row.id, row);
  });
  return map;
};

export const fetchLikedProducts = async (
  userId: string,
): Promise<LikedProduct[]> => {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client
    .from('liked_products')
    .select('product_id, product_snapshot, liked_at, notify_on_price_drop')
    .eq('user_id', userId)
    .order('liked_at', { ascending: false });

  if (error) {
    throw new Error(`Beğeniler yüklenemedi: ${error.message}`);
  }

  const rows = (data ?? []).filter(isLikedProductRow);
  const catalog = await fetchCatalogPrices(rows.map((row) => row.product_id));

  return rows.flatMap((row) => {
    if (!isProductSnapshot(row.product_snapshot)) {
      return [];
    }
    return [
      {
        product: applyCatalogPrices(
          row.product_snapshot,
          catalog.get(row.product_id),
        ),
        notifyOnPriceDrop: row.notify_on_price_drop !== false,
        likedAt: row.liked_at,
      },
    ];
  });
};

export const fetchPassedProductIds = async (
  userId: string,
): Promise<string[]> => {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client
    .from('passed_products')
    .select('product_id')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Geçilen ürünler yüklenemedi: ${error.message}`);
  }

  return (data ?? [])
    .filter(isPassedProductRow)
    .map((row) => row.product_id);
};

export const insertLikedProduct = async (
  userId: string,
  product: Product,
): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const { error: likeError } = await client.from('liked_products').upsert(
    {
      user_id: userId,
      product_id: product.id,
      product_snapshot: toSnapshot(product),
      // Fiyat alarmı kullanıcı ayarı değil sistem davranışı: her beğeni
      // takibe girer, arayüzde anahtar yoktur.
      notify_on_price_drop: true,
    },
    { onConflict: 'user_id,product_id', ignoreDuplicates: true },
  );

  if (likeError) {
    throw new Error(`Beğeni kaydedilemedi: ${likeError.message}`);
  }

  const { error: passError } = await client
    .from('passed_products')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', product.id);

  if (passError) {
    logger.error('Geçilen ürün beğenide temizlenemedi', {
      detail: passError.message,
      productId: product.id,
    });
  }

  logger.debug('Beğeni Supabase\'e yazıldı', { productId: product.id });
};

export const insertPassedProduct = async (
  userId: string,
  product: Product,
): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const { error } = await client.from('passed_products').upsert(
    {
      user_id: userId,
      product_id: product.id,
    },
    { onConflict: 'user_id,product_id' },
  );

  if (error) {
    throw new Error(`Geçme kaydedilemedi: ${error.message}`);
  }
};

export const deletePassedProduct = async (
  userId: string,
  productId: string,
): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const { error } = await client
    .from('passed_products')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId);

  if (error) {
    throw new Error(`Geçme geri alınamadı: ${error.message}`);
  }
};

export const deleteLikedProduct = async (
  userId: string,
  productId: string,
): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const { error } = await client
    .from('liked_products')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId);

  if (error) {
    throw new Error(`Beğeni silinemedi: ${error.message}`);
  }
};

export const updateLikedProductAlert = async ({
  userId,
  productId,
  notifyOnPriceDrop,
}: UpdateLikeAlertParams): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const { error } = await client
    .from('liked_products')
    .update({ notify_on_price_drop: notifyOnPriceDrop })
    .eq('user_id', userId)
    .eq('product_id', productId);

  if (error) {
    throw new Error(`Fiyat alarmı güncellenemedi: ${error.message}`);
  }
};
