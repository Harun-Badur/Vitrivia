import {
  isValidOutfitItems,
  resolveWardrobeRole,
  type WardrobeItemForCandidate,
} from '../src/intelligence/outfits/outfitCandidate';
import { generateOutfitCandidates } from '../src/intelligence/outfits/generateOutfitCandidates';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import type { OutfitRole, Product } from '../types/product';

const wardrobe = (
  id: string,
  category: string,
  subcategory: string | null = null,
): WardrobeItemForCandidate => ({ id, category, subcategory });

const catalog = (
  id: string,
  category: Product['category'],
  outfitRole: OutfitRole | null,
): Product => ({
  id,
  imageUrl: 'https://example.com/item.jpg',
  title: id,
  price: 100,
  brand: 'Test',
  category,
  outfitRole,
  garmentDescription: id,
});

const roles = (items: { role: OutfitRole }[]): OutfitRole[] =>
  items.map((item) => item.role);

describe('Outfit Candidate Engine', () => {
  it.each(['top', 'bottom', 'one_piece', 'shoes', 'bag', 'accessory'] as const)(
    'generates only the existing valid candidates containing a required %s', (requiredRole) => {
      const products = [
        catalog('top-a', 'upper_body', 'top'), catalog('top-b', 'upper_body', 'top'),
        catalog('bottom-a', 'lower_body', 'bottom'), catalog('bottom-b', 'lower_body', 'bottom'),
        catalog('dress', 'dresses', 'one_piece'), catalog('shoes', 'shoes', 'shoes'),
        catalog('bag', 'bags', 'bag'), catalog('accessory', 'accessories', 'accessory'),
      ];
      const required = products.find((product) => product.outfitRole === requiredRole)!;
      const input = { wardrobeItems: [], catalogProducts: products };
      const all = generateOutfitCandidates(input);
      const focused = generateOutfitCandidates({
        ...input, requiredCatalogProductId: required.id,
      });
      expect(focused.map((candidate) => candidate.id)).toEqual(all
        .filter((candidate) => candidate.items.some((item) =>
          item.sourceType === 'catalog' && item.sourceId === required.id))
        .map((candidate) => candidate.id));
      expect(focused.length).toBeGreaterThan(0);
      expect(focused.length).toBeLessThan(all.length);
      const ranked = getDiscoverRecommendations({
        ...input, requiredCatalogProductId: required.id,
      });
      const firstOnly = getDiscoverRecommendations({
        ...input, requiredCatalogProductId: required.id, firstOnly: true,
      });
      expect(firstOnly).toHaveLength(1);
      const selected = ranked.find(entry => entry.candidate.id === firstOnly[0].candidate.id);
      expect(selected).toBeDefined();
      expect(firstOnly[0].rankingValue).toEqual(selected?.rankingValue);
      expect(firstOnly[0].reasons).toEqual(selected?.reasons);
      expect(isValidOutfitItems(firstOnly[0].candidate.items)).toBe(true);
    },
  );

  it('returns no candidates when the required catalog item is absent or incompatible', () => {
    const input = {
      wardrobeItems: [],
      catalogProducts: [catalog('top', 'upper_body', 'top'), catalog('bottom', 'lower_body', 'bottom')],
    };
    expect(generateOutfitCandidates({ ...input, requiredCatalogProductId: 'missing' })).toEqual([]);
    expect(generateOutfitCandidates({
      ...input,
      catalogProducts: [...input.catalogProducts, catalog('wrong', 'shoes', 'top')],
      requiredCatalogProductId: 'wrong',
    })).toEqual([]);
  });
  it.each([
    ['women', 'bottom', 'lower_body', 'top', 'upper_body'],
    ['women', 'top', 'upper_body', 'bottom', 'lower_body'],
    ['men', 'bottom', 'lower_body', 'top', 'upper_body'],
    ['men', 'top', 'upper_body', 'bottom', 'lower_body'],
    ['women', 'shoes', 'shoes', 'top', 'upper_body'],
    ['women', 'bag', 'bags', 'top', 'upper_body'],
  ] as const)('excludes opposite-gender products for %s %s', (
    gender, anchorRole, anchorCategory, complementRole, complementCategory,
  ) => {
    const opposite = gender === 'women' ? 'men' : 'women';
    const anchor = { ...catalog('anchor', anchorCategory, anchorRole), gender };
    const same = { ...catalog('same', complementCategory, complementRole), gender };
    const other = { ...catalog('other', complementCategory, complementRole), gender: opposite as Product['gender'] };
    const unisex = { ...catalog('unisex', complementCategory, complementRole), gender: 'unisex' as const };
    const core = anchorRole === 'top' || anchorRole === 'bottom'
      ? []
      : [{ ...catalog('core-bottom', 'lower_body', 'bottom'), gender: 'unisex' as const }];
    const candidates = generateOutfitCandidates({
      wardrobeItems: [], catalogProducts: [anchor, same, other, unisex, ...core],
    }).filter((candidate) => candidate.items.some((item) => item.sourceId === 'anchor'));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((candidate) => candidate.items.some((item) => item.sourceId === 'same'))).toBe(true);
    expect(candidates.some((candidate) => candidate.items.some((item) => item.sourceId === 'unisex'))).toBe(true);
    expect(candidates.every((candidate) =>
      candidate.items.every((item) => item.sourceId !== 'other'))).toBe(true);
    expect(candidates.every((candidate) =>
      new Set(candidate.items.map((item) => item.sourceId)).size === candidate.items.length)).toBe(true);
  });

  it('keeps unknown gender unclassified and does not restrict unisex anchors', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [],
      catalogProducts: [
        { ...catalog('unisex-top', 'upper_body', 'top'), gender: 'unisex' },
        { ...catalog('women-bottom', 'lower_body', 'bottom'), gender: 'women' },
        catalog('unknown-bottom', 'lower_body', 'bottom'),
      ],
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.some((candidate) => candidate.items.some((item) =>
      item.sourceId === 'unknown-bottom'))).toBe(true);
  });

  it('rejects an explicitly incompatible role/category and a pareo as a bottom', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [],
      catalogProducts: [
        catalog('top', 'upper_body', 'top'),
        catalog('jeans', 'lower_body', 'bottom'),
        { ...catalog('pareo', 'lower_body', 'bottom'), subcategory: 'pareo' },
        catalog('wrong-shoes', 'shoes', 'bottom'),
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].items.map((item) => item.sourceId)).toEqual(['top', 'jeans']);
  });
  it('generates top + bottom', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [wardrobe('w-top', 'upper_body', 'tisort'), wardrobe('w-bottom', 'lower_body')],
      catalogProducts: [],
    });
    expect(candidates).toHaveLength(1);
    expect(roles(candidates[0].items)).toEqual(['top', 'bottom']);
  });

  it('generates top + bottom + shoes', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [wardrobe('w-top', 'top')],
      catalogProducts: [catalog('c-bottom', 'lower_body', 'bottom'), catalog('c-shoes', 'shoes', 'shoes')],
    });
    expect(candidates.some((candidate) =>
      roles(candidate.items).join(',') === 'top,bottom,shoes')).toBe(true);
  });

  it('generates top + bottom + outerwear', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [wardrobe('w-top', 'top'), wardrobe('w-coat', 'upper_body', 'ceket')],
      catalogProducts: [catalog('c-bottom', 'lower_body', 'bottom')],
    });
    expect(candidates.some((candidate) =>
      roles(candidate.items).join(',') === 'top,bottom,outerwear')).toBe(true);
  });

  it('uses one_piece in place of top + bottom and permits shoes', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [wardrobe('w-dress', 'dresses')],
      catalogProducts: [catalog('c-shoes', 'shoes', 'shoes')],
    });
    expect(candidates.some((candidate) =>
      roles(candidate.items).join(',') === 'one_piece,shoes')).toBe(true);
    expect(candidates.some((candidate) =>
      roles(candidate.items).join(',') === 'one_piece')).toBe(true);
    expect(candidates.every((candidate) =>
      !candidate.roles.includes('top') && !candidate.roles.includes('bottom'))).toBe(true);
  });

  it('preserves wardrobe and catalog references in a mixed candidate', () => {
    const top = wardrobe('w-top', 'top');
    const bottom = catalog('c-bottom', 'lower_body', 'bottom');
    const [candidate] = generateOutfitCandidates({
      wardrobeItems: [top],
      catalogProducts: [bottom],
    });
    expect(candidate.sources).toEqual(['wardrobe', 'catalog']);
    expect(candidate.items[0]).toMatchObject({
      sourceType: 'wardrobe', sourceId: 'w-top', role: 'top', wardrobeItem: top,
    });
    expect(candidate.items[1]).toMatchObject({
      sourceType: 'catalog', sourceId: 'c-bottom', role: 'bottom', product: bottom,
    });
  });

  it('generates catalog + catalog', () => {
    const [candidate] = generateOutfitCandidates({
      wardrobeItems: [],
      catalogProducts: [catalog('c-top', 'upper_body', 'top'), catalog('c-bottom', 'lower_body', 'bottom')],
    });
    expect(candidate.sources).toEqual(['catalog']);
    expect(roles(candidate.items)).toEqual(['top', 'bottom']);
  });

  it('deduplicates repeated source items and never combines two of one role', () => {
    const top = catalog('c-top', 'upper_body', 'top');
    const candidates = generateOutfitCandidates({
      wardrobeItems: [],
      catalogProducts: [top, top, catalog('c-top', 'upper_body', 'top'), catalog('c-bottom', 'lower_body', 'bottom')],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].items).toHaveLength(2);
  });

  it('drops an item whose duplicate records disagree on its role', () => {
    expect(generateOutfitCandidates({
      wardrobeItems: [
        wardrobe('w-conflict', 'top'),
        wardrobe('w-conflict', 'outerwear'),
        wardrobe('w-bottom', 'bottom'),
      ],
      catalogProducts: [],
    })).toEqual([]);
  });

  it('does not infer an ambiguous missing role from a broad category', () => {
    expect(resolveWardrobeRole(wardrobe('w-unknown', 'upper_body'))).toBeNull();
    expect(generateOutfitCandidates({
      wardrobeItems: [wardrobe('w-unknown', 'upper_body'), wardrobe('w-bottom', 'lower_body')],
      catalogProducts: [catalog('c-unknown', 'upper_body', null)],
    })).toEqual([]);
  });

  it('never combines one_piece with top or bottom in one candidate', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [wardrobe('w-dress', 'one_piece'), wardrobe('w-top', 'top')],
      catalogProducts: [catalog('c-bottom', 'lower_body', 'bottom')],
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => isValidOutfitItems(candidate.items))).toBe(true);
    expect(candidates.some((candidate) =>
      candidate.roles.includes('one_piece') &&
      (candidate.roles.includes('top') || candidate.roles.includes('bottom')))).toBe(false);
  });

  it('can include all distinct optional roles without merging duplicate roles', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [
        wardrobe('w-top', 'top'),
        wardrobe('w-bottom', 'bottom'),
        wardrobe('w-coat', 'outerwear'),
        wardrobe('w-bag', 'bag'),
      ],
      catalogProducts: [
        catalog('c-shoes', 'shoes', 'shoes'),
        catalog('c-hat', 'hats', 'hat'),
        catalog('c-accessory', 'accessories', 'accessory'),
      ],
    });
    expect(candidates.some((candidate) => candidate.items.length === 7)).toBe(true);
    expect(candidates.every((candidate) =>
      new Set(candidate.roles).size === candidate.roles.length)).toBe(true);
  });

  it('returns the same candidate IDs regardless of input order', () => {
    const tops = [wardrobe('w-top-2', 'top'), wardrobe('w-top-1', 'top')];
    const products = [catalog('c-shoes', 'shoes', 'shoes'), catalog('c-bottom', 'lower_body', 'bottom')];
    const first = generateOutfitCandidates({ wardrobeItems: tops, catalogProducts: products });
    const reversed = generateOutfitCandidates({
      wardrobeItems: [...tops].reverse(),
      catalogProducts: [...products].reverse(),
    });
    expect(first.map((candidate) => candidate.id)).toEqual(reversed.map((candidate) => candidate.id));
  });
});
