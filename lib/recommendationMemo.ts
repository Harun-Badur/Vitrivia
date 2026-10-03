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

export function normalizedRecommendationToken(value: string, trim: boolean, calculate: () => string): string {
  return recommendationMemoValue('normalizationMemo', JSON.stringify(['tr-TR', trim, value]), calculate);
}
