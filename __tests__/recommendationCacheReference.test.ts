import fs from 'fs';
import path from 'path';
import type { Product } from '../types/product';
import { prepareDiscoverRankingAsync, completeDiscoverRecommendationsAsync, getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { createFinalCacheKey, createRankingCacheKey } from '../src/recommendationCache/fingerprint';
import { serializeRanking, hydrateRanking, serializeFinal, hydrateFinal } from '../src/recommendationCache/codec';
import { RecommendationMemoryCache } from '../src/recommendationCache/memoryCache';

const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(__dirname,
  'fixtures/recommendation-catalog.snapshot.json'), 'utf8'));
const roles = ['top', 'bottom', 'shoes'];
const owned = roles.map((category, index) => ({ id: `owned-${category}`, category,
  color: ['black', 'white', 'beige'][index], style_tags: ['casual'], secondary_colors: undefined }));

describe('36 full-output cache reference scenarios (3 anchors × 2 wardrobes × 6 exposures)', () => {
  it.each(roles)('preserves the %s engine result, ordering and canonical snapshot references', async role => {
    expect(catalog).toHaveLength(80);
    const anchor = catalog.find(product => product.outfitRole === role)!;
    let scenarios = 0;
    for (const wardrobeItems of [[], owned]) {
      const input = { catalogProducts: catalog, wardrobeItems, requiredCatalogProductId: anchor.id, firstOnly: true };
      const context = { input, catalogVersion: 'fixture-80-v1' };
      const prepared = await prepareDiscoverRankingAsync(input, { budgetMs: 1_000_000 });
      const encodedRanking = serializeRanking(prepared, context);
      // Simulate a separate load: results must bind to these new canonical objects.
      const catalogCopy: Product[] = catalog.map(product => ({ ...product }));
      const wardrobeCopy = wardrobeItems.map(item => ({ ...item }));
      const hydratedContext = { ...context, input: { ...input, catalogProducts: catalogCopy, wardrobeItems: wardrobeCopy } };
      const ranking = hydrateRanking(encodedRanking, hydratedContext);
      expect(ranking.status).toBe('hit');
      if (ranking.status !== 'hit') throw new Error('Ranking hydration failed');
      expect(ranking.value.ranked).toStrictEqual(prepared.ranked);
      expect(ranking.value.requiredProduct).toBe(catalogCopy.find(product => product.id === anchor.id));
      const initial = getDiscoverRecommendations(input)[0]?.displayProducts ?? [];
      for (const count of [0, 1, 2, 5, 10, 100]) {
        const exposure = new Map(initial.map(product => [product.id, count]));
        const finalContext = { ...hydratedContext, input: { ...hydratedContext.input, recommendationExposure: exposure } };
        const expected = getDiscoverRecommendations({ ...input, recommendationExposure: exposure });
        const actual = await completeDiscoverRecommendationsAsync(ranking.value, exposure, { budgetMs: 1_000_000 });
        expect(actual).toStrictEqual(expected);
        const final = hydrateFinal(serializeFinal(actual, finalContext), finalContext);
        expect(final.status).toBe('hit');
        if (final.status !== 'hit') throw new Error('Final hydration failed');
        expect(final.value).toStrictEqual(expected);
        expect(complementaryProductsForDisplay(final.value, anchor.id)).toStrictEqual(complementaryProductsForDisplay(expected, anchor.id));
        for (const entry of final.value) {
          for (const item of entry.candidate.items) {
            if (item.sourceType === 'catalog') expect(item.product).toBe(catalogCopy.find(product => product.id === item.sourceId));
            else expect(item.wardrobeItem).toBe(wardrobeCopy.find(wardrobe => wardrobe.id === item.sourceId));
          }
          for (const product of entry.displayProducts ?? []) {
            expect(product).toBe(catalogCopy.find(candidate => candidate.id === product.id));
            expect(entry.candidate.items.some(item => item.sourceType === 'catalog' && item.product === product)).toBe(true);
          }
        }
        const cache = new RecommendationMemoryCache<(typeof owned)[number]>();
        cache.setRanking(createRankingCacheKey(finalContext), ranking.value);
        cache.setFinal(createFinalCacheKey(finalContext), final.value);
        const hit = cache.getFinal(createFinalCacheKey(finalContext));
        expect(hit.status === 'hit' && hit.value).toBe(final.value);
        scenarios++;
      }
    }
    expect(scenarios).toBe(12);
  }, 120_000);
});
