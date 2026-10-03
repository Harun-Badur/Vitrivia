import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DiversityMix,
  NegativePreference,
  RecsScoringConfig,
  ScoringWeights,
  StyleProfileSnapshot,
  StyleTagPrior,
  TrendScoringBoost,
  WeightMap,
} from '../types/recommendation';
import { logger } from './logger';
import { getSupabaseClient } from './supabase';
import {
  DEFAULT_RECS_CONFIG,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_TREND_SCORING_BOOST,
  emptyStyleProfile,
} from './scoring';

const CONFIG_CACHE_MS = 5 * 60 * 1000;
const CONFIG_STORAGE_KEY = 'kabin.recs.config.v1';
const PROFILE_STORAGE_PREFIX = 'kabin.recs.profile.v1.';

interface CachedConfig {
  config: RecsScoringConfig;
  fetchedAt: number;
  ttl?: number;
}

interface RecsConfigRow {
  key: string;
  value: unknown;
  updated_at: string;
}

interface StyleTagPriorRow {
  tag: string;
  subcategory_w: unknown;
  fit_w: unknown;
  color_w: unknown;
}

interface StyleProfileRow {
  user_id: string;
  color_w: unknown;
  subcategory_w: unknown;
  brand_w: unknown;
  fit_w: unknown;
  price_band_w: unknown;
  style_tag_weights: unknown;
  negative_preferences: unknown;
}

let memoryConfig: CachedConfig | null = null;
const memoryProfiles = new Map<string, { profile: StyleProfileSnapshot; fetchedAt: number; ttl?: number }>();
let cacheGeneration = 0;
let configRequest: Promise<RecsScoringConfig> | null = null;
const profileRequests = new Map<string, Promise<StyleProfileSnapshot>>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseWeightMap = (value: unknown): WeightMap => {
  if (!isRecord(value)) {
    return {};
  }
  const map: WeightMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      map[key] = raw;
    } else if (typeof raw === 'string' && Number.isFinite(Number(raw))) {
      map[key] = Number(raw);
    }
  }
  return map;
};

const parseScoringWeights = (value: unknown): ScoringWeights => {
  const map = parseWeightMap(value);
  return {
    category_match: map.category_match ?? DEFAULT_SCORING_WEIGHTS.category_match,
    style_match: map.style_match ?? DEFAULT_SCORING_WEIGHTS.style_match,
    color_match: map.color_match ?? DEFAULT_SCORING_WEIGHTS.color_match,
    brand_match: map.brand_match ?? DEFAULT_SCORING_WEIGHTS.brand_match,
    fit_match: map.fit_match ?? DEFAULT_SCORING_WEIGHTS.fit_match,
    price_match: map.price_match ?? DEFAULT_SCORING_WEIGHTS.price_match,
    negative_signal:
      map.negative_signal ?? DEFAULT_SCORING_WEIGHTS.negative_signal,
    novelty: map.novelty ?? DEFAULT_SCORING_WEIGHTS.novelty,
    freshness: map.freshness ?? DEFAULT_SCORING_WEIGHTS.freshness,
    context: map.context ?? DEFAULT_SCORING_WEIGHTS.context,
    try_shop_boost:
      map.try_shop_boost ?? DEFAULT_SCORING_WEIGHTS.try_shop_boost,
    deal_match: map.deal_match ?? DEFAULT_SCORING_WEIGHTS.deal_match,
  };
};

const parseDiversityMix = (value: unknown): DiversityMix => {
  const map = parseWeightMap(value);
  return {
    preferred: map.preferred ?? DEFAULT_RECS_CONFIG.diversityMix.preferred,
    similar: map.similar ?? DEFAULT_RECS_CONFIG.diversityMix.similar,
    complementary:
      map.complementary ?? DEFAULT_RECS_CONFIG.diversityMix.complementary,
    discovery: map.discovery ?? DEFAULT_RECS_CONFIG.diversityMix.discovery,
  };
};

const parseTrendScoringBoost = (value: unknown): TrendScoringBoost => {
  const map = parseWeightMap(value);
  return {
    freshness: map.freshness ?? DEFAULT_TREND_SCORING_BOOST.freshness,
    novelty: map.novelty ?? DEFAULT_TREND_SCORING_BOOST.novelty,
    context: map.context ?? DEFAULT_TREND_SCORING_BOOST.context,
    style_match: map.style_match ?? DEFAULT_TREND_SCORING_BOOST.style_match,
    category_match:
      map.category_match ?? DEFAULT_TREND_SCORING_BOOST.category_match,
    color_match: map.color_match ?? DEFAULT_TREND_SCORING_BOOST.color_match,
    brand_match: map.brand_match ?? DEFAULT_TREND_SCORING_BOOST.brand_match,
    fit_match: map.fit_match ?? DEFAULT_TREND_SCORING_BOOST.fit_match,
    price_match: map.price_match ?? DEFAULT_TREND_SCORING_BOOST.price_match,
    deal_match: map.deal_match ?? DEFAULT_TREND_SCORING_BOOST.deal_match,
    preferred: map.preferred ?? DEFAULT_TREND_SCORING_BOOST.preferred,
    discovery: map.discovery ?? DEFAULT_TREND_SCORING_BOOST.discovery,
  };
};

const parseNegativePreferences = (value: unknown): NegativePreference[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const colors = Array.isArray(item.colors)
      ? item.colors.filter((color): color is string => typeof color === 'string')
      : [];
    const subcategory =
      typeof item.subcategory === 'string' ? item.subcategory : null;
    const fit = typeof item.fit === 'string' ? item.fit : null;
    const brandSlug =
      typeof item.brand_slug === 'string'
        ? item.brand_slug
        : typeof item.brandSlug === 'string'
          ? item.brandSlug
          : null;
    const priceBand =
      typeof item.price_band === 'string'
        ? item.price_band
        : typeof item.priceBand === 'string'
          ? item.priceBand
          : null;
    const productId =
      typeof item.product_id === 'string'
        ? item.product_id
        : typeof item.productId === 'string'
          ? item.productId
          : null;
    const at = typeof item.at === 'string' ? item.at : null;
    return [
      {
        productId,
        at,
        colors,
        subcategory,
        fit,
        brandSlug,
        priceBand,
      },
    ];
  });
};

const parseStyleTagPrior = (value: StyleTagPriorRow): StyleTagPrior => ({
  subcategoryW: parseWeightMap(value.subcategory_w),
  fitW: parseWeightMap(value.fit_w),
  colorW: parseWeightMap(value.color_w),
});

const isConfigRow = (value: unknown): value is RecsConfigRow =>
  isRecord(value) &&
  typeof value.key === 'string' &&
  typeof value.updated_at === 'string';

const isPriorRow = (value: unknown): value is StyleTagPriorRow =>
  isRecord(value) && typeof value.tag === 'string';

const isProfileRow = (value: unknown): value is StyleProfileRow =>
  isRecord(value) && typeof value.user_id === 'string';

const readNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
};

export const assembleRecsConfig = (
  rows: RecsConfigRow[],
  priors: StyleTagPriorRow[],
): RecsScoringConfig => {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const scoringWeights = parseScoringWeights(byKey.get('scoring_weights')?.value);
  const diversityMix = parseDiversityMix(byKey.get('diversity_mix')?.value);
  const reasonsThresholds = parseWeightMap(
    byKey.get('reasons_thresholds')?.value,
  );
  const mix = parseWeightMap(byKey.get('scoring_mix')?.value);
  const softNegative = parseWeightMap(byKey.get('soft_negative')?.value);
  const noiseAmplitude = readNumber(
    byKey.get('noise_amplitude')?.value,
    DEFAULT_RECS_CONFIG.noiseAmplitude,
  );

  const styleTagPriors: Record<string, StyleTagPrior> = {
    ...DEFAULT_RECS_CONFIG.styleTagPriors,
  };
  for (const row of priors) {
    styleTagPriors[row.tag] = parseStyleTagPrior(row);
  }

  const latest = rows.reduce(
    (max, row) => (row.updated_at > max ? row.updated_at : max),
    'default',
  );

  return {
    scoringWeights,
    reasonsThresholds:
      Object.keys(reasonsThresholds).length > 0
        ? reasonsThresholds
        : DEFAULT_RECS_CONFIG.reasonsThresholds,
    diversityMix,
    noiseAmplitude,
    declaredStyleShare:
      mix.declared_style ?? DEFAULT_RECS_CONFIG.declaredStyleShare,
    behavioralStyleShare:
      mix.behavioral_style ?? DEFAULT_RECS_CONFIG.behavioralStyleShare,
    productNegativeHours:
      softNegative.product_hours ?? DEFAULT_RECS_CONFIG.productNegativeHours,
    featureNegativeScale:
      softNegative.feature_scale ?? DEFAULT_RECS_CONFIG.featureNegativeScale,
    styleTagPriors,
    configVersion: latest,
    trendScoringBoost: parseTrendScoringBoost(
      byKey.get('trend_scoring_boost')?.value,
    ),
  };
};

export const mapStyleProfileRow = (
  row: StyleProfileRow,
): StyleProfileSnapshot => ({
  userId: row.user_id,
  colorW: parseWeightMap(row.color_w),
  subcategoryW: parseWeightMap(row.subcategory_w),
  brandW: parseWeightMap(row.brand_w),
  fitW: parseWeightMap(row.fit_w),
  priceBandW: parseWeightMap(row.price_band_w),
  styleTagWeights: parseWeightMap(row.style_tag_weights),
  negativePreferences: parseNegativePreferences(row.negative_preferences),
});

const persistJson = async (key: string, value: unknown): Promise<void> => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    logger.debug('Recs cache yazılamadı', { error });
  }
};

const readRecsConfig = async (): Promise<RecsScoringConfig> => {
  const generation = cacheGeneration;
  const now = Date.now();
  if (memoryConfig && now - memoryConfig.fetchedAt < (memoryConfig.ttl ?? CONFIG_CACHE_MS)) {
    return memoryConfig.config;
  }

  const client = getSupabaseClient();
  if (!client) {
    return memoryConfig?.config ?? DEFAULT_RECS_CONFIG;
  }

  try {
    const [configResult, priorResult] = await Promise.all([
      client.from('recs_config').select('key, value, updated_at'),
      client.from('style_tag_priors').select('tag, subcategory_w, fit_w, color_w'),
    ]);

    if (configResult.error) {
      logger.debug('recs_config okunamadı', { detail: configResult.error.message });
      const config = memoryConfig?.config ?? DEFAULT_RECS_CONFIG;
      if (generation === cacheGeneration) memoryConfig = { config, fetchedAt: now, ttl: 10_000 };
      return config;
    }

    const rows = (configResult.data ?? []).filter(isConfigRow);
    const priorRows = (priorResult.data ?? []).filter(isPriorRow);
    const config = assembleRecsConfig(rows, priorRows);
    if (generation === cacheGeneration) {
      memoryConfig = { config, fetchedAt: now };
      void persistJson(CONFIG_STORAGE_KEY, { config, fetchedAt: now });
    }
    return config;
  } catch (error) {
    logger.debug('recs_config beklenmeyen hata', { error });
    const config = memoryConfig?.config ?? DEFAULT_RECS_CONFIG;
    if (generation === cacheGeneration) memoryConfig = { config, fetchedAt: now, ttl: 10_000 };
    return config;
  }
};

const readStyleProfileSnapshot = async (
  userId: string,
): Promise<StyleProfileSnapshot> => {
  const generation = cacheGeneration;
  const now = Date.now();
  const cached = memoryProfiles.get(userId);
  if (cached && now - cached.fetchedAt < (cached.ttl ?? CONFIG_CACHE_MS)) {
    return cached.profile;
  }

  const fallback = emptyStyleProfile(userId);
  const client = getSupabaseClient();
  if (!client) {
    return cached?.profile ?? fallback;
  }

  try {
    const { data, error } = await client
      .from('user_style_profiles')
      .select(
        'user_id, color_w, subcategory_w, brand_w, fit_w, price_band_w, style_tag_weights, negative_preferences',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.debug('user_style_profiles okunamadı', { detail: error.message });
      const profile = cached?.profile ?? fallback;
      if (generation === cacheGeneration) memoryProfiles.set(userId, { profile, fetchedAt: now, ttl: 10_000 });
      return profile;
    }

    if (data === null || !isProfileRow(data)) {
      const profile = cached?.profile ?? fallback;
      if (generation === cacheGeneration) memoryProfiles.set(userId, { profile, fetchedAt: now, ttl: 60_000 });
      return profile;
    }

    const profile = mapStyleProfileRow(data);
    if (generation === cacheGeneration) {
      memoryProfiles.set(userId, { profile, fetchedAt: now });
      void persistJson(`${PROFILE_STORAGE_PREFIX}${userId}`, profile);
    }
    return profile;
  } catch (error) {
    logger.debug('user_style_profiles beklenmeyen hata', { error });
    const profile = cached?.profile ?? fallback;
    if (generation === cacheGeneration) memoryProfiles.set(userId, { profile, fetchedAt: now, ttl: 10_000 });
    return profile;
  }
};

export const fetchRecsConfig = (): Promise<RecsScoringConfig> => {
  if (!configRequest) {
    const request = readRecsConfig().finally(() => { if (configRequest === request) configRequest = null; });
    configRequest = request;
  }
  return configRequest;
};

export const fetchStyleProfileSnapshot = (userId: string): Promise<StyleProfileSnapshot> => {
  const pending = profileRequests.get(userId);
  if (pending) return pending;
  const request = readStyleProfileSnapshot(userId).finally(() => {
    if (profileRequests.get(userId) === request) profileRequests.delete(userId);
  });
  profileRequests.set(userId, request);
  return request;
};

export const clearRecsCaches = async (): Promise<void> => {
  cacheGeneration++;
  configRequest = null;
  profileRequests.clear();
  memoryConfig = null;
  const userIds = [...memoryProfiles.keys()];
  memoryProfiles.clear();
  try {
    await AsyncStorage.removeItem(CONFIG_STORAGE_KEY);
    await Promise.all(
      userIds.map((userId) =>
        AsyncStorage.removeItem(`${PROFILE_STORAGE_PREFIX}${userId}`),
      ),
    );
  } catch (error) {
    logger.debug('Recs cache temizlenemedi', { error });
  }
};
