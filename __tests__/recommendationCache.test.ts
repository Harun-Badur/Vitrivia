import type { Product } from '../types/product';
import { createRecommendationMemo } from '../lib/recommendationMemo';
import { createRankingCacheKey, createFinalCacheKey, type CacheContext } from '../src/recommendationCache/fingerprint';
import { hydrateFinal, hydrateRanking, serializeFinal, serializeRanking } from '../src/recommendationCache/codec';
import { RecommendationMemoryCache } from '../src/recommendationCache/memoryCache';

const product: Product = { id: 'a', title: 'A', brand: 'Brand', price: 100,
  category: 'upper_body', outfitRole: 'top', imageUrl: 'a.jpg', garmentDescription: 'A' };
const context: CacheContext = { input: { catalogProducts: [product], wardrobeItems: [], firstOnly: true,
  requiredCatalogProductId: product.id } };
const emptyRanking = () => ({ ranked: [], requiredProduct: product, diverse: true,
  firstOnly: true, recommendationMemo: createRecommendationMemo() });

describe('recommendation cache storage and hydration', () => {
  it('distinguishes a miss from a valid empty result and preserves live object identity', () => {
    const cache = new RecommendationMemoryCache();
    const finalKey = createFinalCacheKey(context), rankingKey = createRankingCacheKey(context);
    expect(cache.getFinal(finalKey)).toEqual({ status: 'miss', reason: 'not-found' });
    expect(cache.getRanking(rankingKey).status).toBe('miss');
    const result: [] = [], ranking = emptyRanking();
    cache.setFinal(finalKey, result); cache.setRanking(rankingKey, ranking);
    const final = cache.getFinal(finalKey), prepared = cache.getRanking(rankingKey);
    expect(final.status === 'hit' && final.value).toBe(result);
    expect(prepared.status === 'hit' && prepared.value).toBe(ranking);
    expect(hydrateFinal(serializeFinal([], context), context)).toEqual({ status: 'hit', value: [] });
  });

  it('invalidates final exposure without invalidating the reusable ranking', () => {
    const cache = new RecommendationMemoryCache();
    cache.setRanking(createRankingCacheKey(context), emptyRanking());
    cache.setFinal(createFinalCacheKey(context), []);
    const changed = { input: { ...context.input, recommendationExposure: new Map([['a', 1]]) } };
    expect(cache.getRanking(createRankingCacheKey(changed)).status).toBe('hit');
    expect(cache.getFinal(createFinalCacheKey(changed)).status).toBe('miss');
    const serialized = serializeRanking(emptyRanking(), context);
    expect(hydrateRanking(serialized, changed).status).toBe('hit');
    expect(hydrateFinal(serializeFinal([], context), changed)).toEqual({ status: 'miss', reason: 'context-mismatch' });
  });

  it.each(['engine', 'catalog', 'wardrobe', 'anchor'])('rejects %s context changes during hydration', field => {
    const next: CacheContext = { ...context, input: { ...context.input } };
    if (field === 'engine') next.engineVersion = 'next';
    if (field === 'catalog') next.input.catalogProducts = [{ ...product, currentPrice: 90 }];
    if (field === 'wardrobe') next.input.wardrobeItems = [{ id: 'w', category: 'bottom' }];
    if (field === 'anchor') next.input.requiredCatalogProductId = 'other';
    expect(hydrateFinal(serializeFinal([], context), next)).toEqual({ status: 'miss', reason: 'context-mismatch' });
    expect(hydrateRanking(serializeRanking(emptyRanking(), context), next)).toEqual({ status: 'miss', reason: 'context-mismatch' });
  });

  it('recreates a separate empty calculation memo without persisting it', () => {
    const ranked = emptyRanking(); ranked.recommendationMemo.values.set('private', new Map([['x', 42]]));
    const encoded = serializeRanking(ranked, context);
    expect(encoded).not.toContain('private');
    const first = hydrateRanking(encoded, context), second = hydrateRanking(encoded, context);
    expect(first.status).toBe('hit'); expect(second.status).toBe('hit');
    if (first.status === 'hit' && second.status === 'hit') {
      expect(first.value.requiredProduct).toBe(product);
      expect(first.value.recommendationMemo?.values.size).toBe(0);
      expect(first.value.recommendationMemo).not.toBe(second.value.recommendationMemo);
    }
  });

  it('treats malformed, modified, wrong-kind and incompatible schema payloads as misses', () => {
    const encoded = serializeFinal([], context);
    expect(hydrateFinal('bad JSON', context).status).toBe('miss');
    expect(hydrateFinal('{}', context).status).toBe('miss');
    expect(hydrateRanking(encoded, context).status).toBe('miss');
    const payload = JSON.parse(encoded); payload.envelope.schemaVersion++;
    expect(hydrateFinal(JSON.stringify(payload), context).status).toBe('miss');
    payload.envelope.schemaVersion--; payload.envelope.nodes[0].values.push(['catalog', 'missing']);
    expect(hydrateFinal(JSON.stringify(payload), context).status).toBe('miss');
  });

  it('bounds memory using LRU and supports explicit invalidation and session clearing', () => {
    const cache = new RecommendationMemoryCache(2);
    const keys = ['a', 'b', 'c'].map(catalogVersion => createFinalCacheKey({ ...context, catalogVersion }));
    cache.setFinal(keys[0], []); cache.setFinal(keys[1], []); cache.getFinal(keys[0]); cache.setFinal(keys[2], []);
    expect(cache.getFinal(keys[1]).status).toBe('miss');
    expect(cache.getFinal(keys[0]).status).toBe('hit');
    cache.setRanking(createRankingCacheKey(context), emptyRanking());
    cache.invalidate(key => key.catalogVersion === 'a');
    expect(cache.getFinal(keys[0]).status).toBe('miss');
    expect(cache.getRanking(createRankingCacheKey(context)).status).toBe('hit');
    cache.clear();
    expect(cache.getFinal(keys[2]).status).toBe('miss');
    expect(cache.getRanking(createRankingCacheKey(context)).status).toBe('miss');
    expect(() => new RecommendationMemoryCache(0)).toThrow();
  });
});
