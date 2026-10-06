import fs from 'fs';
import path from 'path';
import type { Product } from '../types/product';
import { generateOutfitCandidates } from '../src/intelligence/outfits/generateOutfitCandidates';
import { rankDiversityCandidatesAsync, rankOutfitCandidates } from '../src/intelligence/outfits/rankOutfitCandidates';
import { getDiscoverRecommendations, getDiscoverRecommendationsAsync } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import * as generation from '../src/intelligence/outfits/generateOutfitCandidates';
import * as compatibility from '../src/intelligence/outfits/catalogCompatibility';

// Public catalog snapshot, not products added to application/backend state.
const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/recommendation-catalog.snapshot.json'), 'utf8'));
const roles = ['top', 'bottom', 'shoes'] as const;
const owned = roles.map((role, index) => ({ id: `owned-${role}`, category: role,
  color: ['black', 'white', 'beige'][index],
  style_tags: index < 2 ? ['casual', 'minimal', 'CASUAL'] : ['casual'] }));
// Only the algorithm is measured here, without platform timer latency between slices.
const options = { budgetMs: 1_000_000 };

describe('exact diversity-band candidate search', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['top', 'bottom', 'one_piece'] as const)(
    'visits only eligible core bases in original order for a %s anchor', async role => {
      const products = ['top', 'bottom', 'one_piece'].flatMap(role => {
        const original = catalog.find(p => p.outfitRole === role)!;
        return [0, 1, 2].map(index => ({ ...original, id: `core-${role}-${index}`, gender: 'unisex' as const }));
      });
      const anchor = products.find(p => p.outfitRole === role)!;
      const visited: string[][] = [];
      // A fixed clock counts scheduler checkpoints, without timing/profiling.
      const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
      await generation.searchOutfitCandidatesAsync({ catalogProducts: products, wardrobeItems: [],
        requiredCatalogProductId: anchor.id }, {
        canExtend: items => { visited.push(items.map(item => item.sourceId)); return false; },
        accept: () => false,
      }, options);
      const checkpoints = clock.mock.calls.length;
      clock.mockRestore();
      const expected = role === 'one_piece' ? [[anchor.id]] : [0, 1, 2].map(index =>
        role === 'top' ? [anchor.id, `core-bottom-${index}`] : [`core-top-${index}`, anchor.id]);
      expect(visited).toEqual(expected);
      // One slice start + retained pair checkpoints + base-extension checkpoints.
      expect(checkpoints).toBe(role === 'one_piece' ? 2 : 7);
    });

  it.each(roles)('preserves all results for %s, empty/full wardrobe and exposures', async role => {
    const anchor = catalog.find(product => product.outfitRole === role)!;
    for (const wardrobeItems of [[], owned]) {
      const base = { catalogProducts: catalog, wardrobeItems, requiredCatalogProductId: anchor.id, firstOnly: true };
      const originalProducts = getDiscoverRecommendations(base)[0]?.displayProducts ?? [];
      for (const exposure of [0, 1, 10, 100]) {
        const input = { ...base, recommendationExposure: new Map(originalProducts.map(p => [p.id, exposure])) };
        // Full output includes IDs, all item sources, score fields, reasons and order.
        expect(await getDiscoverRecommendationsAsync(input, options)).toEqual(getDiscoverRecommendations(input));
      }
    }
  }, 120_000);

  it.each(roles)('retains the entire exact diversity band for %s, not a fixed K', async role => {
    const anchor = catalog.find(product => product.outfitRole === role)!;
    const input = { catalogProducts: catalog, wardrobeItems: [], requiredCatalogProductId: anchor.id, maximalOnly: true };
    const original = rankOutfitCandidates(generateOutfitCandidates(input), anchor);
    const best = original[0].rankingValue;
    const band = original.filter(entry => entry.rankingValue.optionalRoleCount === best.optionalRoleCount &&
      entry.rankingValue.sharedStyleTags.length === best.sharedStyleTags.length &&
      entry.rankingValue.compatibilityScore! >= best.compatibilityScore! - 0.12);
    const optimized = await rankDiversityCandidatesAsync(input, anchor, options);
    expect(optimized.length).toBeGreaterThan(3);
    expect(optimized.length).toBeLessThan(original.length);
    // Absolute rank gaps are intentionally irrelevant to firstOnly; every comparison key remains exact.
    expect(optimized.map(({ rank: _rank, ...entry }) => entry)).toEqual(band.map(({ rank: _rank, ...entry }) => entry));
  }, 120_000);

  it('preserves equal evidence, ID ties and boundary candidates without truncation', async () => {
    const products = roles.flatMap(role => {
      const product = catalog.find(p => p.outfitRole === role)!;
      return [0, 1, 2, 3].map(index => ({ ...product, id: `${role}-${index}`, gender: 'unisex' as const }));
    });
    const anchor = products[0];
    const input = { catalogProducts: [...products].reverse(), wardrobeItems: [], requiredCatalogProductId: anchor.id, maximalOnly: true };
    const expected = rankOutfitCandidates(generateOutfitCandidates(input), anchor);
    const actual = await rankDiversityCandidatesAsync(input, anchor, options);
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(16);
    expect(await getDiscoverRecommendationsAsync({ ...input, firstOnly: true }, options))
      .toEqual(getDiscoverRecommendations({ ...input, firstOnly: true }));
  });

  it('keeps an exact best-minus-0.12 boundary and rejects only strictly lower scores', async () => {
    const anchor = catalog.find(p => p.outfitRole === 'top')!;
    const bottom = catalog.find(p => p.outfitRole === 'bottom')!;
    const shoe = catalog.find(p => p.outfitRole === 'shoes')!;
    const shoes = [1, 0.76, 0.75999998].map((_, index) => ({ ...shoe, id: `boundary-${index}` }));
    const real = compatibility.catalogCompatibility;
    jest.spyOn(compatibility, 'catalogCompatibility').mockImplementation((anchor, product) => ({
      ...real(anchor, product), score: [1, 0.76, 0.75999998][shoes.findIndex(p => p.id === product.id)] ?? 1,
    }));
    const input = { catalogProducts: [anchor, bottom, ...shoes], wardrobeItems: [], requiredCatalogProductId: anchor.id, maximalOnly: true };
    const original = rankOutfitCandidates(generateOutfitCandidates(input), anchor);
    const actual = await rankDiversityCandidatesAsync(input, anchor, options);
    expect(actual).toEqual(original.slice(0, 2));
    expect(actual[1].rankingValue.compatibilityScore).toBe(actual[0].rankingValue.compatibilityScore! - 0.12);
  });

  it('preserves mixed wardrobe style tiers, optional-role bounds and zero catalog denominators', async () => {
    const sample = [...new Map(catalog.map(p => [p.outfitRole, p])).values()];
    for (let variant = 0; variant < 24; variant++) {
      const wardrobeItems = sample.flatMap((p, index) => (variant + index) % 3 === 0 ? [] : [
        { id: `owned-a-${p.outfitRole}`, category: p.outfitRole!, style_tags: ['casual', `tier-${index % 2}`], color: 'black' },
        { id: `owned-b-${p.outfitRole}`, category: p.outfitRole!, style_tags: [variant % 2 ? 'casual' : 'formal'], color: 'white' },
      ]);
      const products = sample.filter((_, index) => index < 3 || (variant + index) % 3 !== 0);
      const anchor = products[variant % products.length];
      const input = { catalogProducts: products, wardrobeItems, requiredCatalogProductId: anchor.id, firstOnly: true,
        recommendationExposure: new Map(products.map((p, index) => [p.id, (variant + index) % 10])) };
      expect(await getDiscoverRecommendationsAsync(input, options)).toEqual(getDiscoverRecommendations(input));
    }
  }, 120_000);

  it('preserves results across sparse role groups, gender conflicts and one-piece bases', async () => {
    const byRole = new Map<string, Product>();
    for (const product of catalog) if (product.outfitRole && !byRole.has(product.outfitRole)) byRole.set(product.outfitRole, product);
    const small = [...byRole.values()];
    // Actual snapshot products; varied subsets exercise missing roles and optional-role capacity.
    for (let mask = 0; mask < 16; mask++) {
      const products = small.filter((_, index) => index < 3 || (mask & (1 << ((index - 3) % 4))));
      for (const wardrobeItems of [[], owned]) for (const anchor of products.slice(0, 3)) {
        const input = { catalogProducts: products, wardrobeItems, requiredCatalogProductId: anchor.id, firstOnly: true };
        expect(await getDiscoverRecommendationsAsync(input, options)).toEqual(getDiscoverRecommendations(input));
      }
    }
  }, 120_000);

  it('cancels between search passes and leaves the reference behavior intact', async () => {
    const controller = new AbortController();
    const anchor = catalog.find(p => p.outfitRole === 'shoes')!;
    const search = generation.searchOutfitCandidatesAsync;
    const spy = jest.spyOn(generation, 'searchOutfitCandidatesAsync').mockImplementation(async (...args) => {
      const result = await search(...args);
      controller.abort();
      return result;
    });
    const input = { catalogProducts: catalog, wardrobeItems: [], requiredCatalogProductId: anchor.id, firstOnly: true };
    await expect(getDiscoverRecommendationsAsync(input, { ...options, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    expect(await getDiscoverRecommendationsAsync(input, options)).toEqual(getDiscoverRecommendations(input));
  }, 120_000);
});
