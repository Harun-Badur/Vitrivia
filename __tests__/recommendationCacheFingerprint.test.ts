import type { Product } from '../types/product';
import { createFinalCacheKey, createRankingCacheKey, fingerprint, type CacheContext } from '../src/recommendationCache/fingerprint';

const anchor: Product = { id: 'a', title: 'Anchor', imageUrl: 'a.jpg', brand: 'Brand',
  price: 100, category: 'upper_body', outfitRole: 'top', garmentDescription: 'Anchor' };
const context: CacheContext = { input: { catalogProducts: [anchor], wardrobeItems: [],
  requiredCatalogProductId: anchor.id, firstOnly: true } };

describe('versioned recommendation fingerprints', () => {
  it('canonicalizes object/map insertion order without losing array order or optional values', () => {
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
    expect(fingerprint({ a: undefined })).not.toBe(fingerprint({}));
    expect(fingerprint({ a: undefined })).not.toBe(fingerprint({ a: null }));
    expect(fingerprint(-0)).not.toBe(fingerprint(0));
    const left = { input: { ...context.input, recommendationExposure: new Map([['a', 1], ['b', 2]]) } };
    const right = { input: { ...context.input, recommendationExposure: new Map([['b', 2], ['a', 1]]) } };
    expect(createFinalCacheKey(left)).toEqual(createFinalCacheKey(right));
  });

  it.each(['engine', 'catalog-version', 'anchor', 'wardrobe', 'filters', 'firstOnly'])(
    'invalidates ranking and final when %s changes', change => {
      const altered: CacheContext = { input: { ...context.input } };
      if (change === 'engine') altered.engineVersion = 'next';
      if (change === 'catalog-version') altered.catalogVersion = 'next';
      if (change === 'anchor') altered.input.requiredCatalogProductId = 'other';
      if (change === 'wardrobe') altered.input.wardrobeItems = [{ id: 'w', category: 'bottom' }];
      if (change === 'filters') altered.input.catalogFilters = { gender: 'women' };
      if (change === 'firstOnly') altered.input.firstOnly = false;
      expect(createRankingCacheKey(altered).fingerprint).not.toBe(createRankingCacheKey(context).fingerprint);
      expect(createFinalCacheKey(altered).fingerprint).not.toBe(createFinalCacheKey(context).fingerprint);
    });

  it.each(['currentPrice', 'outfitRole', 'gender', 'subcategory', 'brand', 'title', 'colorSlugs', 'colors', 'fit', 'productUrl', 'imageUrl'])(
    'invalidates product snapshot changes: %s', field => {
      const changed = { ...anchor, [field]: field === 'currentPrice' ? 99 : field === 'colors' || field === 'colorSlugs' ? [] : 'changed' };
      expect(createRankingCacheKey({ input: { ...context.input, catalogProducts: [changed] } }).fingerprint)
        .not.toBe(createRankingCacheKey(context).fingerprint);
    });

  it.each(['category', 'subcategory', 'color', 'secondary_colors', 'style_tags'])(
    'invalidates wardrobe metadata: %s', field => {
      const base = { input: { ...context.input, wardrobeItems: [{ id: 'w', category: 'top' }] } };
      const changed = { input: { ...context.input, wardrobeItems: [{ id: 'w', category: 'top', [field]: 'changed' }] } };
      expect(createRankingCacheKey(changed).fingerprint).not.toBe(createRankingCacheKey(base).fingerprint);
    });

  it('keeps ranking exposure-independent, but retains exact exposure counts for final', () => {
    const keys = [0, 1, 2, 5, 10, 100].map(count => ({ input: { ...context.input,
      recommendationExposure: new Map([['a', count]]) } }));
    expect(new Set(keys.map(input => createRankingCacheKey(input).fingerprint)).size).toBe(1);
    expect(new Set(keys.map(input => createFinalCacheKey(input).fingerprint)).size).toBe(6);
    expect(createFinalCacheKey(context).fingerprint).not.toBe(createFinalCacheKey(keys[0]).fingerprint);
  });

  it('does not truncate/reorder the caller pool or silently discard an outside anchor', () => {
    const products = Array.from({ length: 80 }, (_, index) => ({ ...anchor, id: String(index) }));
    const input = { ...context.input, catalogProducts: [anchor, ...products] };
    const key = createRankingCacheKey({ input });
    expect(input.catalogProducts).toHaveLength(81);
    expect(key.catalogFingerprint).toBe(fingerprint(input.catalogProducts));
    expect(key.fingerprint).not.toBe(createRankingCacheKey({ input: { ...input, catalogProducts: input.catalogProducts.slice(0, 80) } }).fingerprint);
  });

  it('rejects unsupported or cyclic snapshots rather than producing ambiguous keys', () => {
    expect(() => fingerprint(new Map())).toThrow();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => fingerprint(cycle)).toThrow();
  });
});
