import { MOCK_PRODUCTS } from '../data/mockProducts';
import { cooperativeSort, runCooperatively, runSynchronously } from '../src/intelligence/cooperativeWork';
import { getDiscoverRecommendations, getDiscoverRecommendationsAsync } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { enrichProduct, preparedProductAttributes } from '../src/intelligence/style/productStyle';
import { toScoringCandidate } from '../src/intelligence/ranking/productCandidate';
import * as attributes from '../lib/productAttributes';
import type { OutfitRole, Product } from '../types/product';

const roles: OutfitRole[] = ['top', 'bottom', 'shoes', 'outerwear', 'bag', 'hat', 'accessory'];
const categories: Record<OutfitRole, Product['category']> = {
  top: 'upper_body', bottom: 'lower_body', shoes: 'shoes', outerwear: 'upper_body',
  bag: 'bags', hat: 'hats', accessory: 'accessories', one_piece: 'dresses',
};
// Existing test products only; no application catalog or backend data is created.
const catalog = roles.map((role, index): Product => ({ ...MOCK_PRODUCTS[index % MOCK_PRODUCTS.length],
  id: `test-${role}`, category: categories[role], outfitRole: role, gender: 'unisex' }));

describe('cooperative recommendation work', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([true, false])('preserves complete results, order and exposure with firstOnly=%s', async firstOnly => {
    for (const anchor of catalog) {
      const input = { wardrobeItems: [{ id: 'test-wardrobe-bottom', category: 'bottom' }],
        catalogProducts: catalog, requiredCatalogProductId: anchor.id, firstOnly,
        recommendationExposure: new Map([[catalog[2].id, 9]]) };
      expect(await getDiscoverRecommendationsAsync(input)).toEqual(getDiscoverRecommendations(input));
    }
  });

  it('preserves the unanchored path and hard filters', async () => {
    const input = { wardrobeItems: [], catalogProducts: catalog, catalogFilters: { gender: 'men' as const } };
    expect(await getDiscoverRecommendationsAsync(input)).toEqual(getDiscoverRecommendations(input));
    expect(await getDiscoverRecommendationsAsync({ ...input, requiredCatalogProductId: 'missing', firstOnly: true })).toEqual([]);
  });

  it('keeps native stable-sort ordering for comparator ties', async () => {
    const entries = catalog.map((product, index) => ({ product, score: index % 3 }));
    const compare = (a: typeof entries[number], b: typeof entries[number]): number => a.score - b.score;
    expect(await runCooperatively(cooperativeSort([...entries], compare))).toEqual([...entries].sort(compare));
  });

  it('allows a queued navigation callback between work slices before completion', async () => {
    let clock = 0, completed = false, visited = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => ++clock);
    function* work(): Generator<void, number, void> {
      for (; visited < 100; visited++) yield;
      completed = true;
      return visited;
    }
    const result = runCooperatively(work(), { budgetMs: 4 });
    await new Promise<void>(resolve => setTimeout(() => {
      expect(visited).toBeGreaterThan(0);
      expect(visited).toBeLessThan(100);
      expect(completed).toBe(false);
      resolve();
    }, 0));
    expect(await result).toBe(100);
  });

  it('cancels queued and partially completed work without visiting the remainder', async () => {
    let visited = 0, clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => ++clock);
    const controller = new AbortController();
    function* work(): Generator<void, number, void> {
      for (; visited < 100; visited++) yield;
      return visited;
    }
    const result = runCooperatively(work(), { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise<void>(resolve => setTimeout(() => { controller.abort(); resolve(); }, 0));
    await rejected;
    expect(visited).toBeGreaterThan(0);
    expect(visited).toBeLessThan(100);
    expect(runSynchronously(work())).toBe(100);
    await expect(getDiscoverRecommendationsAsync({ wardrobeItems: [], catalogProducts: catalog },
      { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reuses inferred attributes across enrichment and ranking while invalidating changed inputs', () => {
    const infer = jest.spyOn(attributes, 'inferProductAttributes');
    const product = { ...MOCK_PRODUCTS[0] };
    const prepared = preparedProductAttributes(product);
    const enriched = enrichProduct(product, undefined);
    expect(preparedProductAttributes(enriched)).toBe(prepared);
    const score = toScoringCandidate(enriched);
    expect(infer).toHaveBeenCalledTimes(1);
    expect(score.colors).toEqual(prepared.colors);
    product.title = 'Siyah Slim Erkek Gömlek';
    expect(preparedProductAttributes(product)).not.toBe(prepared);
    expect(infer).toHaveBeenCalledTimes(2);
    expect(toScoringCandidate(product).gender).toBe('men');
  });
});
