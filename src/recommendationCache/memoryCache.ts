import type { WardrobeItemForCandidate } from '../intelligence/outfits/outfitCandidate';
import type { OutfitDiscoverRecommendation } from '../intelligence/recommendations/discoverRecommendation';
import type { PreparedDiscoverRanking } from '../intelligence/recommendations/getDiscoverRecommendations';
import type { FinalCacheKey, RankingCacheKey, RecommendationCacheKey } from './fingerprint';

export type CacheLookup<T> = { status: 'hit'; value: T } |
  { status: 'miss'; reason: 'not-found' | 'context-mismatch' | 'invalid-payload' };

/** Explicit reads/writes only: no engine, network, preparation jobs or fallback. */
export class RecommendationMemoryCache<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> {
  private readonly rankings = new Map<string, { key: RankingCacheKey; value: PreparedDiscoverRanking<T> }>();
  private readonly finals = new Map<string, { key: FinalCacheKey; value: readonly OutfitDiscoverRecommendation<T>[] }>();

  constructor(private readonly capacityPerKind = 128) {
    if (!Number.isInteger(capacityPerKind) || capacityPerKind < 1) throw new RangeError('Cache capacity must be positive');
  }

  private read<K, V>(entries: Map<string, { key: K; value: V }>, key: string): CacheLookup<V> {
    const entry = entries.get(key);
    if (!entry) return { status: 'miss', reason: 'not-found' };
    entries.delete(key);
    entries.set(key, entry);
    return { status: 'hit', value: entry.value };
  }

  private write<K, V>(entries: Map<string, { key: K; value: V }>, key: string, entry: { key: K; value: V }): void {
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > this.capacityPerKind) entries.delete(entries.keys().next().value!);
  }

  getRanking(key: RankingCacheKey): CacheLookup<PreparedDiscoverRanking<T>> {
    return this.read(this.rankings, key.fingerprint);
  }
  setRanking(key: RankingCacheKey, value: PreparedDiscoverRanking<T>): void {
    this.write(this.rankings, key.fingerprint, { key, value });
  }
  getFinal(key: FinalCacheKey): CacheLookup<readonly OutfitDiscoverRecommendation<T>[]> {
    return this.read(this.finals, key.fingerprint);
  }
  setFinal(key: FinalCacheKey, value: readonly OutfitDiscoverRecommendation<T>[]): void {
    this.write(this.finals, key.fingerprint, { key, value });
  }
  invalidate(matches: (key: RecommendationCacheKey) => boolean): void {
    for (const [id, entry] of this.rankings) if (matches(entry.key)) this.rankings.delete(id);
    for (const [id, entry] of this.finals) if (matches(entry.key)) this.finals.delete(id);
  }
  clear(): void { this.rankings.clear(); this.finals.clear(); }
}
