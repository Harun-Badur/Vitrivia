import type { Product } from '../types/product';
import { normalizeOutfitItems, prepareOutfitItems, generateOutfitCandidates } from '../src/intelligence/outfits/generateOutfitCandidates';

const product = (id: string, role: 'top' | 'bottom'): Product => ({
  id, outfitRole: role, category: role === 'top' ? 'upper_body' : 'lower_body',
  brand: 'Test', title: id, price: 100, imageUrl: 'test', garmentDescription: id,
});

describe('anchor-independent outfit preparation', () => {
  it('skips normalization across new arrays/anchors and isolates returned wrappers/groups', () => {
    const products = [product('prep-top', 'top'), product('prep-bottom', 'bottom')];
    const wardrobeItems = [{ id: 'prep-owned', category: 'shoes' }];
    const input = { catalogProducts: products, wardrobeItems };
    const trim = jest.spyOn(String.prototype, 'trim');
    try {
      const first = prepareOutfitItems({ ...input, requiredCatalogProductId: products[0].id });
      const calls = trim.mock.calls.length;
      const second = prepareOutfitItems({ catalogProducts: [...products], wardrobeItems: [...wardrobeItems],
        requiredCatalogProductId: products[1].id });
      expect(trim).toHaveBeenCalledTimes(calls);
      expect(second).toEqual(first);
      expect(second.normalized[0]).not.toBe(first.normalized[0]);
      first.normalized[0].sourceId = 'corrupted';
      first.byRole.clear();
      expect(prepareOutfitItems(input)).toEqual(second);
    } finally { trim.mockRestore(); }
  });

  it('invalidates in-place role evidence, membership/order and same-ID object replacements', () => {
    const top = product('mutation-top', 'top'), bottom = product('mutation-bottom', 'bottom');
    const owned = { id: 'mutation-owned', category: 'upper_body', subcategory: 'top' };
    const input = { catalogProducts: [top, bottom], wardrobeItems: [owned] };
    const verify = () => expect(prepareOutfitItems(input).normalized).toEqual(normalizeOutfitItems(input));
    verify();
    bottom.subcategory = 'PAREO'; verify();
    bottom.subcategory = ' PAREO '; verify();
    top.outfitRole = 'outerwear'; verify();
    top.category = 'bags'; verify();
    top.id = 'changed-id'; verify();
    top.gender = 'women'; verify();
    owned.category = 'lower_body'; verify();
    owned.id = 'changed-owned'; verify();
    owned.category = 'upper_body'; owned.subcategory = 'mont'; verify();
    const replacement = { ...bottom };
    input.catalogProducts = [replacement]; verify();
    expect(prepareOutfitItems(input).normalized.find(item => item.sourceType === 'catalog')?.product).toBe(replacement);
    input.wardrobeItems = []; verify();
  });

  it('preserves duplicate winners, ambiguous roles and candidate ordering', () => {
    const first = product('duplicate', 'top'), second = { ...first, title: 'Second' };
    const bottom = product('duplicate-bottom', 'bottom');
    const input = { catalogProducts: [first, second, bottom], wardrobeItems: [] };
    expect(prepareOutfitItems(input).normalized).toEqual(normalizeOutfitItems(input));
    expect(prepareOutfitItems(input).normalized[0].product).toBe(first);
    const candidates = generateOutfitCandidates(input);
    expect(generateOutfitCandidates({ ...input, catalogProducts: [...input.catalogProducts] })).toEqual(candidates);
    input.catalogProducts = [second, first, bottom];
    expect(prepareOutfitItems(input).normalized[0].product).toBe(second);
    input.catalogProducts = [first, { ...first, outfitRole: 'outerwear' }, bottom];
    expect(prepareOutfitItems(input).normalized).toEqual(normalizeOutfitItems(input));
    expect(prepareOutfitItems(input).normalized.some(item => item.sourceId === 'duplicate')).toBe(false);
  });
});
