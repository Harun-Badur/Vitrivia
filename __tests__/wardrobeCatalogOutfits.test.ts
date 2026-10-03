import { generateOutfitCandidates } from '../src/intelligence/outfits/generateOutfitCandidates';
import { generateWardrobeCatalogOutfits } from '../src/intelligence/outfits/generateWardrobeCatalogOutfits';
import { rankOutfitCandidates } from '../src/intelligence/outfits/rankOutfitCandidates';
import type { OutfitRole, Product } from '../types/product';

const wardrobe = (id: string, category: string, subcategory?: string) =>
  ({ id, category, subcategory });

const catalog = (id: string, category: Product['category'], outfitRole: OutfitRole | null): Product => ({
  id,
  imageUrl: 'https://example.com/item.jpg',
  title: id,
  price: 100,
  brand: 'Test',
  category,
  outfitRole,
  garmentDescription: id,
});

describe('Wardrobe + Catalog outfit combination layer', () => {
  it('generates wardrobe-only outfits', () => {
    const ranked = generateWardrobeCatalogOutfits({
      wardrobeItems: [wardrobe('top', 'upper_body', 'tisort'), wardrobe('bottom', 'lower_body')],
      catalogProducts: [],
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.roles).toEqual(['top', 'bottom']);
    expect(ranked[0].candidate.sources).toEqual(['wardrobe']);
  });

  it('generates catalog-only outfits', () => {
    const ranked = generateWardrobeCatalogOutfits({
      wardrobeItems: [],
      catalogProducts: [catalog('top', 'upper_body', 'top'), catalog('bottom', 'lower_body', 'bottom')],
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.sources).toEqual(['catalog']);
  });

  it('generates a wardrobe + catalog outfit', () => {
    const ranked = generateWardrobeCatalogOutfits({
      wardrobeItems: [wardrobe('top', 'top')],
      catalogProducts: [catalog('bottom', 'lower_body', 'bottom')],
    });
    expect(ranked[0].candidate.sources).toEqual(['wardrobe', 'catalog']);
    expect(ranked[0].candidate.items.map((item) => item.sourceType)).toEqual(['wardrobe', 'catalog']);
  });

  it('generates wardrobe + wardrobe + catalog', () => {
    const ranked = generateWardrobeCatalogOutfits({
      wardrobeItems: [wardrobe('top', 'top'), wardrobe('bottom', 'bottom')],
      catalogProducts: [catalog('shoes', 'shoes', 'shoes')],
    });
    expect(ranked[0].candidate.roles).toEqual(['top', 'bottom', 'shoes']);
    expect(ranked[0].candidate.items.map((item) => item.sourceType)).toEqual([
      'wardrobe', 'wardrobe', 'catalog',
    ]);
  });

  it('generates wardrobe + catalog + catalog', () => {
    const ranked = generateWardrobeCatalogOutfits({
      wardrobeItems: [wardrobe('top', 'top')],
      catalogProducts: [catalog('bottom', 'lower_body', 'bottom'), catalog('shoes', 'shoes', 'shoes')],
    });
    expect(ranked[0].candidate.roles).toEqual(['top', 'bottom', 'shoes']);
    expect(ranked[0].candidate.items.map((item) => item.sourceType)).toEqual([
      'wardrobe', 'catalog', 'catalog',
    ]);
  });

  it('preserves source types and original wardrobe/product references', () => {
    const top = wardrobe('top', 'top');
    const bottom = catalog('bottom', 'lower_body', 'bottom');
    const [entry] = generateWardrobeCatalogOutfits({
      wardrobeItems: [top], catalogProducts: [bottom],
    });
    expect(entry.candidate.items[0]).toMatchObject({
      sourceType: 'wardrobe', sourceId: 'top', wardrobeItem: top,
    });
    expect(entry.candidate.items[0].wardrobeItem).toBe(top);
    expect(entry.candidate.items[1]).toMatchObject({
      sourceType: 'catalog', sourceId: 'bottom', product: bottom,
    });
    expect(entry.candidate.items[1].product).toBe(bottom);
  });

  it('prevents duplicate items in a candidate', () => {
    const top = wardrobe('top', 'top');
    const bottom = catalog('bottom', 'lower_body', 'bottom');
    const ranked = generateWardrobeCatalogOutfits({
      wardrobeItems: [top, top, { ...top }],
      catalogProducts: [bottom, bottom, { ...bottom }],
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.items).toHaveLength(2);
  });

  it('does not force ambiguous or unsupported roles into candidates', () => {
    const ranked = generateWardrobeCatalogOutfits({
      wardrobeItems: [
        wardrobe('top', 'top'),
        wardrobe('ambiguous', 'upper_body'),
        wardrobe('unsupported', 'unknown'),
      ],
      catalogProducts: [
        catalog('bottom', 'lower_body', 'bottom'),
        catalog('ambiguous-catalog', 'upper_body', null),
      ],
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.items.map((item) => item.sourceId)).toEqual(['top', 'bottom']);
  });

  it('preserves the existing ranking value, reasons, and rank', () => {
    const input = {
      wardrobeItems: [wardrobe('top', 'top'), wardrobe('bottom', 'bottom')],
      catalogProducts: [catalog('shoes', 'shoes', 'shoes')],
    };
    const ranked = generateWardrobeCatalogOutfits(input);
    const direct = rankOutfitCandidates(generateOutfitCandidates(input));
    expect(ranked).toEqual(direct);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(ranked[0].rankingValue).toMatchObject({
      validRoles: true, coreComplete: true, optionalRoleCount: 1,
    });
    expect(ranked[0].reasons).toContainEqual({ code: 'mixed_sources' });
  });

  it('returns the same ranking for repeated and reversed input', () => {
    const wardrobeItems = [wardrobe('top-b', 'top'), wardrobe('top-a', 'top')];
    const catalogProducts = [
      catalog('bottom', 'lower_body', 'bottom'), catalog('shoes', 'shoes', 'shoes'),
    ];
    const first = generateWardrobeCatalogOutfits({ wardrobeItems, catalogProducts });
    const second = generateWardrobeCatalogOutfits({
      wardrobeItems: [...wardrobeItems].reverse(),
      catalogProducts: [...catalogProducts].reverse(),
    });
    expect(first).toEqual(second);
  });

  it('supports wardrobe + wardrobe + catalog + catalog and optional additions', () => {
    const ranked = generateWardrobeCatalogOutfits({
      wardrobeItems: [wardrobe('tee', 'top'), wardrobe('jeans', 'bottom'), wardrobe('sneaker', 'shoes')],
      catalogProducts: [
        catalog('jacket', 'upper_body', 'outerwear'), catalog('bag', 'bags', 'bag'),
      ],
    });
    expect(ranked[0].candidate.roles).toEqual(['top', 'bottom', 'outerwear', 'shoes', 'bag']);
    expect(ranked.some((entry) => entry.candidate.roles.join(',') === 'top,bottom,shoes')).toBe(true);
    expect(ranked.some((entry) =>
      entry.candidate.roles.join(',') === 'top,bottom,outerwear,shoes')).toBe(true);
    expect(ranked.some((entry) => entry.candidate.items.length === 4 &&
      entry.candidate.items.filter((item) => item.sourceType === 'wardrobe').length === 2 &&
      entry.candidate.items.filter((item) => item.sourceType === 'catalog').length === 2)).toBe(true);
  });
});
