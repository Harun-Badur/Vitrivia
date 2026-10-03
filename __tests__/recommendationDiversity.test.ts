import type { OutfitRole, Product } from '../types/product';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { isValidOutfitItems } from '../src/intelligence/outfits/outfitCandidate';
import { catalogCompatibility } from '../src/intelligence/outfits/catalogCompatibility';

const product = (id: string, outfitRole: OutfitRole, extra: Partial<Product> = {}): Product => ({
  id, title: id, brand: 'Example', price: 1000, imageUrl: `https://example.com/${id}.jpg`,
  garmentDescription: id, gender: 'women', outfitRole,
  category: outfitRole === 'bottom' ? 'lower_body' : outfitRole === 'shoes' ? 'shoes'
    : outfitRole === 'accessory' ? 'accessories' : outfitRole === 'one_piece' ? 'dresses' : 'upper_body',
  ...extra,
});
const recommend = (anchor: Product, pool: Product[], exposure?: ReadonlyMap<string, number>): Product[] =>
  complementaryProductsForDisplay(getDiscoverRecommendations({ wardrobeItems: [],
    catalogProducts: [anchor, ...pool], requiredCatalogProductId: anchor.id,
    firstOnly: true, recommendationExposure: exposure }), anchor.id);

describe('Deterministic compatibility and complement diversity', () => {
  it('adds fit/style evidence only when existing metadata supports it', () => {
    const anchor = product('anchor', 'top', { subcategory: 'tisort', fit: 'regular' });
    const casual = product('casual', 'bottom', { subcategory: 'jean', fit: 'regular' });
    const unknown = product('unknown', 'bottom');
    expect(catalogCompatibility(anchor, casual)).toMatchObject({ fit: 1, style: 1 });
    expect(catalogCompatibility(anchor, unknown)).toMatchObject({ fit: 0, style: 0 });
    expect(catalogCompatibility(anchor, casual).score).toBeGreaterThan(catalogCompatibility(anchor, unknown).score);
  });
  it('uses real price, brand and color compatibility instead of ID ordering', () => {
    const anchor = product('anchor', 'top', { colorSlugs: ['siyah'] });
    const bad = product('000', 'bottom', { price: 9000, brand: 'Other', colorSlugs: ['pembe'] });
    const good = product('zzz', 'bottom', { colorSlugs: ['siyah'] });
    expect(recommend(anchor, [bad, good]).map(p => p.id)).toEqual(['zzz']);
  });
  it('reduces prior exposure within the compatibility cohort without mutating history', () => {
    const anchor = product('anchor', 'top');
    const a = product('a', 'bottom', { title: 'Alpha' });
    const b = product('b', 'bottom', { title: 'Bravo' });
    const bad = product('bad', 'bottom', { price: 100000, brand: 'Other' });
    const exposure = new Map([['a', 20]]);
    expect(recommend(anchor, [a, b, bad])[0].id).toBe('a');
    expect(recommend(anchor, [a, b, bad], exposure)[0].id).toBe('b');
    expect(recommend(anchor, [bad, b, a], exposure)[0].id).toBe('b');
    expect([...exposure]).toEqual([['a', 20]]);
  });
  it('projects three distinct roles/categories while preserving an actual complete outfit', () => {
    const anchor = product('anchor', 'top');
    const pool = [product('bottom', 'bottom'), product('coat', 'outerwear'),
      product('shoes', 'shoes'), product('accessory', 'accessory')];
    const result = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [anchor, ...pool],
      requiredCatalogProductId: anchor.id, firstOnly: true });
    const shown = complementaryProductsForDisplay(result, anchor.id);
    expect(shown).toHaveLength(3);
    expect(shown[0].outfitRole).toBe('bottom');
    expect(new Set(shown.map(p => p.category)).size).toBe(3);
    expect(new Set(shown.map(p => p.outfitRole)).size).toBe(3);
    expect(isValidOutfitItems(result[0].candidate.items)).toBe(true);
    shown.forEach(p => expect(result[0].candidate.items.some(i => i.sourceType === 'catalog' && i.product === p)).toBe(true));
  });
  it('keeps gender, role/category and pareo guards with a unisex anchor', () => {
    const anchor = product('anchor', 'shoes', { gender: 'unisex' });
    const result = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [anchor,
      product('top', 'top'), product('bottom', 'bottom'),
      product('men', 'bottom', { gender: 'men' }),
      product('invalid', 'bag', { category: 'lower_body' }),
      product('pareo', 'bottom', { subcategory: 'pareo' })],
    requiredCatalogProductId: anchor.id, firstOnly: true });
    expect(isValidOutfitItems(result[0].candidate.items)).toBe(true);
    expect(result[0].candidate.items.map(i => i.sourceId)).not.toEqual(expect.arrayContaining(['men']));
    const ids = complementaryProductsForDisplay(result, anchor.id).map(p => p.id);
    expect(ids).not.toContain('invalid');
    expect(ids).not.toContain('pareo');
  });
  it('does not invent missing categories or repeat anchor URL aliases', () => {
    const anchor = product('anchor', 'top', { productUrl: 'https://example.com/item?ref=a' });
    const alias = product('alias', 'outerwear', { productUrl: 'https://example.com/item?ref=b' });
    const shown = recommend(anchor, [product('bottom', 'bottom'), alias]);
    expect(shown.map(p => p.id)).toEqual(['bottom']);
  });
});
