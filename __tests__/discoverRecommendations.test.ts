import { generateWardrobeCatalogOutfits } from '../src/intelligence/outfits/generateWardrobeCatalogOutfits';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import type { OutfitRole, Product } from '../types/product';

const wardrobe = (id: string, category: string, subcategory?: string) =>
  ({ id, category, subcategory });

const catalog = (id: string, category: Product['category'], role: OutfitRole | null): Product => ({
  id,
  imageUrl: 'https://example.com/item.jpg',
  title: id,
  price: 100,
  brand: 'Test',
  category,
  outfitRole: role,
  garmentDescription: id,
});

describe('Discover recommendation service', () => {
  it('returns ranked outfit recommendations from wardrobe and catalog', () => {
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [wardrobe('tee', 'top'), wardrobe('jeans', 'bottom')],
      catalogProducts: [catalog('shoes', 'shoes', 'shoes')],
    });
    expect(recommendations.map(({ type }) => type)).toEqual(['outfit', 'outfit']);
    expect(recommendations[0].candidate.roles).toEqual(['top', 'bottom', 'shoes']);
    expect(recommendations[0].sources).toEqual(['wardrobe', 'catalog']);
  });

  it('returns a wardrobe-only outfit safely', () => {
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [wardrobe('tee', 'top'), wardrobe('jeans', 'bottom')],
      catalogProducts: [],
    });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].sources).toEqual(['wardrobe']);
  });

  it('returns a catalog-only outfit safely', () => {
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [],
      catalogProducts: [catalog('tee', 'upper_body', 'top'), catalog('jeans', 'lower_body', 'bottom')],
    });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].sources).toEqual(['catalog']);
  });

  it('retains source types and original references for downstream use', () => {
    const tee = wardrobe('tee', 'top');
    const jeans = catalog('jeans', 'lower_body', 'bottom');
    const [recommendation] = getDiscoverRecommendations({
      wardrobeItems: [tee], catalogProducts: [jeans],
    });
    expect(recommendation.candidate.items[0]).toMatchObject({
      sourceType: 'wardrobe', sourceId: 'tee', role: 'top', wardrobeItem: tee,
    });
    expect(recommendation.candidate.items[0].wardrobeItem).toBe(tee);
    expect(recommendation.candidate.items[1]).toMatchObject({
      sourceType: 'catalog', sourceId: 'jeans', role: 'bottom', product: jeans,
    });
    expect(recommendation.candidate.items[1].product).toBe(jeans);
  });

  it('preserves rank, ranking value and reasons from the existing pipeline', () => {
    const input = {
      wardrobeItems: [wardrobe('tee', 'top')],
      catalogProducts: [
        catalog('jeans', 'lower_body', 'bottom'), catalog('shoes', 'shoes', 'shoes'),
      ],
    };
    const recommendations = getDiscoverRecommendations(input);
    const ranked = generateWardrobeCatalogOutfits(input);
    expect(recommendations.map(({ candidate, rank, rankingValue, reasons }) =>
      ({ candidate, rank, rankingValue, reasons }))).toEqual(ranked);
    expect(recommendations.map(({ rank }) => rank)).toEqual([1, 2]);
    expect(recommendations[0].reasons).toContainEqual({ code: 'mixed_sources' });
  });

  it('returns identical ordered recommendations for repeated and reversed input', () => {
    const wardrobeItems = [wardrobe('tee-b', 'top'), wardrobe('tee-a', 'top')];
    const catalogProducts = [
      catalog('shoes', 'shoes', 'shoes'), catalog('jeans', 'lower_body', 'bottom'),
    ];
    const first = getDiscoverRecommendations({ wardrobeItems, catalogProducts });
    const second = getDiscoverRecommendations({
      wardrobeItems: [...wardrobeItems].reverse(),
      catalogProducts: [...catalogProducts].reverse(),
    });
    expect(first).toEqual(second);
  });

  it('returns an empty result for empty input', () => {
    expect(getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [] })).toEqual([]);
  });

  it('does not invent roles from missing or ambiguous metadata', () => {
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [wardrobe('unknown-tee', 'upper_body'), wardrobe('jeans', 'bottom')],
      catalogProducts: [catalog('unknown-top', 'upper_body', null)],
    });
    expect(recommendations).toEqual([]);
  });

  it('uses the existing combination pipeline without changing its result', () => {
    const input = {
      wardrobeItems: [wardrobe('dress', 'dresses')],
      catalogProducts: [catalog('shoes', 'shoes', 'shoes')],
    };
    const recommendations = getDiscoverRecommendations(input);
    const ranked = generateWardrobeCatalogOutfits(input);
    expect(recommendations.map(({ candidate }) => candidate.id)).toEqual(
      ranked.map(({ candidate }) => candidate.id),
    );
    expect(recommendations[0].candidate.roles).toEqual(['one_piece', 'shoes']);
  });

  it('applies existing hard catalog filters without changing source items', () => {
    const tee = wardrobe('tee', 'top');
    const jeans = catalog('jeans', 'lower_body', 'bottom');
    const shoes = catalog('shoes', 'shoes', 'shoes');
    const catalogProducts = [jeans, shoes];
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [tee], catalogProducts,
      catalogFilters: { query: 'jeans' },
    });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].candidate.items.map((item) => item.sourceId)).toEqual(['tee', 'jeans']);
    expect(catalogProducts).toEqual([jeans, shoes]);
    expect(recommendations[0].candidate.items[1].product).toBe(jeans);
  });

  it('emits only outfit recommendations and leaves the current product feed contract alone', () => {
    const products = [catalog('tee', 'upper_body', 'top'), catalog('jeans', 'lower_body', 'bottom')];
    const recommendations = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: products });
    expect(recommendations.every((recommendation) => recommendation.type === 'outfit')).toBe(true);
    expect(products.map((product) => product.id)).toEqual(['tee', 'jeans']);
  });
});
