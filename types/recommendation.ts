import type { GarmentCategory, Product } from './product';

export interface PriceRange {
  min: number;
  max: number;
  average: number;
}

export interface UserPreferences {
  /** Beğenilerin kategori dağılımı, örn. { upper_body: 5, lower_body: 2, dresses: 1 }. */
  categoryCounts: Record<GarmentCategory, number>;
  /**
   * Beğenilerin marka dağılımı. Anahtarlar normalize edilmiştir (kırpılmış +
   * Türkçe küçük harf), çünkü katalogda aynı marka farklı yazımla gelebiliyor.
   */
  brandCounts: Record<string, number>;
  /** Beğenilerden türetilen fiyat aralığı; hiç beğeni yoksa null. */
  priceRange: PriceRange | null;
  /** Geçilen ürünler; skorlamada ceza uygulanır. */
  passedProductIds: ReadonlySet<string>;
  likeCount: number;
}

export interface ScoredProduct {
  product: Product;
  score: number;
}

export type WeightMap = Record<string, number>;

export interface NegativePreference {
  productId: string | null;
  at: string | null;
  colors: string[];
  subcategory: string | null;
  fit: string | null;
  brandSlug: string | null;
  priceBand: string | null;
}

export interface StyleTagPrior {
  subcategoryW: WeightMap;
  fitW: WeightMap;
  colorW: WeightMap;
}

export interface StyleProfileSnapshot {
  userId: string;
  colorW: WeightMap;
  subcategoryW: WeightMap;
  brandW: WeightMap;
  fitW: WeightMap;
  priceBandW: WeightMap;
  styleTagWeights: WeightMap;
  negativePreferences: NegativePreference[];
}

export interface SessionIntentWeights {
  colorW: WeightMap;
  subcategoryW: WeightMap;
  brandW: WeightMap;
  fitW: WeightMap;
  priceBandW: WeightMap;
  categoryW: WeightMap;
}

export interface SessionIntentConstraints {
  category: string | null;
  gender: string | null;
  size: string | null;
}

export interface SessionIntent {
  weights: SessionIntentWeights;
  constraints: SessionIntentConstraints;
  query: string;
  lastCategory: string | null;
  lastSubcategory: string | null;
  lastTryShopSubcategory: string | null;
}

export type FeedMode = 'personal' | 'trend';

export const DEFAULT_FEED_MODE: FeedMode = 'personal';

export const isFeedMode = (value: unknown): value is FeedMode =>
  value === 'personal' || value === 'trend';

export interface ScoringWeights {
  category_match: number;
  style_match: number;
  color_match: number;
  brand_match: number;
  fit_match: number;
  price_match: number;
  negative_signal: number;
  novelty: number;
  freshness: number;
  context: number;
  try_shop_boost: number;
  /** Personal default 0: V1 skorunu değiştirmez. Trend’de config boost’u yazar. */
  deal_match: number;
}

/** Trend, personal ağırlıklarının çarpanı. deal_match mutlak (personal 0). */
export interface TrendScoringBoost {
  freshness: number;
  novelty: number;
  context: number;
  style_match: number;
  category_match: number;
  color_match: number;
  brand_match: number;
  fit_match: number;
  price_match: number;
  deal_match: number;
  preferred: number;
  discovery: number;
}

export interface DiversityMix {
  preferred: number;
  similar: number;
  complementary: number;
  discovery: number;
}

export interface RecsScoringConfig {
  scoringWeights: ScoringWeights;
  reasonsThresholds: WeightMap;
  diversityMix: DiversityMix;
  noiseAmplitude: number;
  declaredStyleShare: number;
  behavioralStyleShare: number;
  productNegativeHours: number;
  featureNegativeScale: number;
  styleTagPriors: Record<string, StyleTagPrior>;
  configVersion: string;
  trendScoringBoost: TrendScoringBoost;
}

export interface ScoringCandidate {
  id: string;
  brand: string;
  brandSlug: string;
  category: string;
  subcategory: string;
  fit: string;
  colors: string[];
  priceBand: string;
  price: number;
  gender: 'women' | 'men' | 'unisex';
  createdAtMs: number;
  impressionCount: number;
  /** 1: katalog fiyat düşüşü, 0: yok. */
  deal: number;
}

export interface ScoreBreakdown {
  weighted_base: number;
  long_term_affinity: number;
  session_affinity: number;
  style_affinity: number;
  color_affinity: number;
  fit_affinity: number;
  category_affinity: number;
  brand_affinity: number;
  price_fit: number;
  freshness: number;
  novelty: number;
  try_shop_boost: number;
  deal: number;
  soft_negative: number;
  controlled_noise: number;
  total: number;
  dominant_color: string | null;
}

export type RecsSlot =
  | 'preferred'
  | 'similar'
  | 'complementary'
  | 'discovery'
  | 'exploration';

export interface ScoredCandidate {
  candidate: ScoringCandidate;
  breakdown: ScoreBreakdown;
}

export interface RankedCandidate extends ScoredCandidate {
  slot: RecsSlot;
  reasons: string[];
  position: number;
}

export interface RecsFeedItem {
  product: Product;
  score: number;
  reasons: string[];
  position: number;
}

export interface RecsFeedResponse {
  recommendation_id: string;
  score_id: string;
  config_version: string;
  items: RecsFeedItem[];
  /** True when search mask emptied and personal recs were substituted. */
  fallback?: boolean;
  /** Soft facets dropped during progressive relax (e.g. ['color']). */
  relaxed?: string[];
}
