import { logger } from '../lib/logger';
import { parseNumeric } from '../lib/price';
import { getRequiredSupabaseClient } from '../lib/supabase';
import type {
  PriceRange,
  UserPreferences,
} from '../types/recommendation';
import { isGarmentCategory, type GarmentCategory } from '../types/product';

interface PreferenceSignal {
  category: GarmentCategory;
  brand: string;
  price: number;
}

const normalizeBrand = (brand: string): string =>
  brand.trim().toLocaleLowerCase('tr');

const createEmptyPreferences = (): UserPreferences => ({
  categoryCounts: {
    upper_body: 0,
    lower_body: 0,
    dresses: 0,
    shoes: 0,
    bags: 0,
    hats: 0,
    accessories: 0,
  },
  brandCounts: {},
  priceRange: null,
  passedProductIds: new Set<string>(),
  likeCount: 0,
});

const toPreferenceSignal = (snapshot: unknown): PreferenceSignal | null => {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return null;
  }

  const record = snapshot as Record<string, unknown>;
  const { category, brand } = record;
  const price = parseNumeric(record.currentPrice) ?? parseNumeric(record.price);

  if (
    !isGarmentCategory(category) ||
    typeof brand !== 'string' ||
    price === null
  ) {
    return null;
  }

  return { category, brand, price };
};

const toPriceRange = (prices: number[]): PriceRange | null => {
  if (prices.length === 0) {
    return null;
  }

  const total = prices.reduce((sum, price) => sum + price, 0);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: total / prices.length,
  };
};

const readPassedProductIds = async (userId: string): Promise<Set<string>> => {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client
    .from('passed_products')
    .select('product_id')
    .eq('user_id', userId);

  if (error) {
    logger.error('Tercihler için geçilen ürünler okunamadı', {
      detail: error.message,
    });
    return new Set<string>();
  }

  const ids = new Set<string>();
  for (const row of data ?? []) {
    const productId = (row as Record<string, unknown>).product_id;
    if (typeof productId === 'string') {
      ids.add(productId);
    }
  }
  return ids;
};

const readLikeSignals = async (
  userId: string,
): Promise<PreferenceSignal[]> => {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client
    .from('liked_products')
    .select('product_snapshot')
    .eq('user_id', userId);

  if (error) {
    logger.error('Tercihler için beğeniler okunamadı', {
      detail: error.message,
    });
    return [];
  }

  return (data ?? []).flatMap((row) => {
    const signal = toPreferenceSignal(
      (row as Record<string, unknown>).product_snapshot,
    );
    return signal ? [signal] : [];
  });
};

/**
 * Beğeni histogramı (eski fallback). Skorlama lib/scoring.ts + user_style_profiles.
 */
export const getUserPreferences = async (
  userId: string,
): Promise<UserPreferences> => {
  const [signals, passedProductIds] = await Promise.all([
    readLikeSignals(userId),
    readPassedProductIds(userId),
  ]);

  const preferences = createEmptyPreferences();
  preferences.passedProductIds = passedProductIds;
  preferences.likeCount = signals.length;

  for (const signal of signals) {
    preferences.categoryCounts[signal.category] += 1;
    const brandKey = normalizeBrand(signal.brand);
    if (brandKey.length > 0) {
      preferences.brandCounts[brandKey] =
        (preferences.brandCounts[brandKey] ?? 0) + 1;
    }
  }

  preferences.priceRange = toPriceRange(signals.map((signal) => signal.price));

  return preferences;
};
