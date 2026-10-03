import type { DiscoverRecommendationInput } from '../intelligence/recommendations/getDiscoverRecommendations';
import type { WardrobeItemForCandidate } from '../intelligence/outfits/outfitCandidate';

export const RECOMMENDATION_CACHE_SCHEMA_VERSION = 1;
/** Bump when engine rules, constants or normalization change. */
export const RECOMMENDATION_ENGINE_VERSION = 'discover-engine-v1';

/** Exact canonical keys, not a lossy hash. Array order and missing vs undefined survive. */
export function fingerprint(value: unknown): string {
  const ancestors = new Set<object>();
  const visit = (item: unknown): unknown => {
    if (item === undefined) return ['undefined'];
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return [typeof item, item];
    if (typeof item === 'number') return ['number', Object.is(item, -0) ? '-0' : String(item)];
    if (typeof item !== 'object') throw new TypeError('Unsupported recommendation snapshot value');
    if (ancestors.has(item)) throw new TypeError('Cyclic recommendation snapshot');
    ancestors.add(item);
    let result: unknown;
    if (Array.isArray(item)) {
      result = ['array', Array.from(item, visit)];
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Expected a plain snapshot');
      result = ['object', Object.keys(item).sort().map(key => [key, visit((item as Record<string, unknown>)[key])])];
    }
    ancestors.delete(item);
    return result;
  };
  return JSON.stringify(visit(value));
}

export interface CacheContext<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> {
  input: DiscoverRecommendationInput<T>;
  engineVersion?: string;
  catalogVersion?: string;
}

interface BaseCacheKey {
  schemaVersion: number;
  engineVersion: string;
  catalogVersion: string;
  catalogFingerprint: string;
  wardrobeFingerprint: string;
  anchorProductId: string | null;
  anchorFingerprint: string;
  contextFingerprint: string;
  fingerprint: string;
}

export interface RankingCacheKey extends BaseCacheKey { kind: 'ranking' }
export interface FinalCacheKey extends BaseCacheKey {
  kind: 'final';
  rankingFingerprint: string;
  exposureFingerprint: string;
}
export type RecommendationCacheKey = RankingCacheKey | FinalCacheKey;

export function createRankingCacheKey<T extends WardrobeItemForCandidate>(context: CacheContext<T>): RankingCacheKey {
  const { input } = context;
  const anchorProductId = input.requiredCatalogProductId ?? null;
  // Snapshot the supplied engine input verbatim. Never expand, truncate or reorder
  // Discover's existing 80-product pool (plus the anchor when it is outside it).
  const base = {
    schemaVersion: RECOMMENDATION_CACHE_SCHEMA_VERSION,
    engineVersion: context.engineVersion ?? RECOMMENDATION_ENGINE_VERSION,
    catalogVersion: context.catalogVersion ?? '',
    catalogFingerprint: fingerprint(input.catalogProducts),
    wardrobeFingerprint: fingerprint(input.wardrobeItems),
    anchorProductId,
    anchorFingerprint: fingerprint(input.catalogProducts.find(product => product.id === anchorProductId)),
    contextFingerprint: fingerprint({ wardrobe: input.wardrobeItems,
      firstOnly: input.firstOnly, catalogFilters: input.catalogFilters }),
  };
  return { ...base, kind: 'ranking', fingerprint: fingerprint(['ranking', base]) };
}

export function createFinalCacheKey<T extends WardrobeItemForCandidate>(context: CacheContext<T>): FinalCacheKey {
  const ranking = createRankingCacheKey(context);
  const exposureFingerprint = fingerprint([...context.input.recommendationExposure ?? []]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const contextFingerprint = fingerprint([ranking.contextFingerprint, exposureFingerprint]);
  return { ...ranking, kind: 'final', contextFingerprint,
    rankingFingerprint: ranking.fingerprint, exposureFingerprint,
    fingerprint: fingerprint(['final', ranking.fingerprint, exposureFingerprint]) };
}
