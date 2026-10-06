/** Owned by one recommendation call; retained across its phases, never across requests. */
export interface RecommendationMemo {
  values: Map<string, Map<string, unknown>>;
}
export const createRecommendationMemo = (): RecommendationMemo => ({ values: new Map() });
let activeMemo: RecommendationMemo | undefined;

/** Install only while a generator step runs, so concurrent jobs cannot mix caches. */
export function withRecommendationMemo<T>(memo: RecommendationMemo | undefined, work: () => T): T {
  const previous = activeMemo;
  activeMemo = memo;
  try { return work(); } finally { activeMemo = previous; }
}

export function recommendationMemoValue<T>(name: string, key: string, calculate: () => T): T {
  if (!activeMemo) return calculate();
  let values = activeMemo.values.get(name);
  if (!values) { values = new Map(); activeMemo.values.set(name, values); }
  if (values.has(key)) {
    return values.get(key) as T;
  }
  const value = calculate();
  values.set(key, value);
  return value;
}

// All callers use tr-TR normalization; partition by trim without serializing keys.
// Bound raw strings retained across recommendation calls.
const normalizationCaches = [new Map<string, string>(), new Map<string, string>()];
export function normalizedRecommendationToken(value: string, trim: boolean, calculate: () => string): string {
  const cache = normalizationCaches[Number(trim)];
  const cached = cache.get(value);
  if (cached !== undefined) return cached;
  const normalized = calculate();
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
  cache.set(value, normalized);
  return normalized;
}
