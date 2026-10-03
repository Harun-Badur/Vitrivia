import { complementaryProductsForDisplay } from '../components/DiscoverRecommendations';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { enrichProduct } from '../src/intelligence/style/productStyle';
import type { GarmentCategory, OutfitRole, Product } from '../types/product';

// This test exercises data projection; native icons/animation are not involved.
jest.mock('lucide-react-native', () => ({ Check: () => null, Plus: () => null }));
jest.mock('../components/PressableScale', () => 'PressableScale');

const product = (id: string, outfitRole: OutfitRole): Product => ({
  id, title: id, brand: 'Test', price: 100, imageUrl: 'https://example.com/product.jpg',
  category: ({ top: 'upper_body', bottom: 'lower_body', outerwear: 'upper_body',
    one_piece: 'dresses', shoes: 'shoes', bag: 'bags', hat: 'hats',
    accessory: 'accessories' } as const)[outfitRole],
  garmentDescription: id, outfitRole,
});

const catalogProduct = (id: string, category: GarmentCategory): Product =>
  enrichProduct({
    id, title: id, brand: 'Catalog', price: 100,
    imageUrl: 'https://example.com/product.jpg', category, garmentDescription: id,
  }, undefined);

describe('Discover recommendation presentation', () => {
  it('uses real catalog references from the first ranked matching outfit and caps the row at three', () => {
    const top = product('top', 'top');
    const bottom = product('bottom', 'bottom');
    const shoes = product('shoes', 'shoes');
    const jacket = product('jacket', 'outerwear');
    const bag = product('bag', 'bag');
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [], catalogProducts: [top, bottom, shoes, jacket, bag],
    });
    const before = JSON.stringify(recommendations);
    const displayed = complementaryProductsForDisplay(recommendations, top.id);
    expect(displayed).toHaveLength(3);
    expect(displayed[0]).toBe(bottom);
    expect(displayed[1]).toBe(jacket);
    expect(displayed[2]).toBe(shoes);
    expect(JSON.stringify(recommendations)).toBe(before);
  });

  it('does not turn wardrobe items into catalog cards or fill missing cards with fake data', () => {
    const top = product('top', 'top');
    const shoes = product('shoes', 'shoes');
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [{ id: 'wardrobe-bottom', category: 'bottom' }],
      catalogProducts: [top, shoes],
    });
    const displayed = complementaryProductsForDisplay(recommendations, top.id);
    expect(displayed).toHaveLength(1);
    expect(displayed[0]).toBe(shoes);
  });

  it('shows no products without recommendations for the current catalog product', () => {
    expect(complementaryProductsForDisplay([], 'top')).toEqual([]);
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [], catalogProducts: [product('dress', 'one_piece')],
    });
    expect(complementaryProductsForDisplay(recommendations, 'other')).toEqual([]);
    expect(complementaryProductsForDisplay(recommendations, null)).toEqual([]);
  });

  it('keeps the current product out and deduplicates repeated product references', () => {
    const top = product('top', 'top');
    const bottom = product('bottom', 'bottom');
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [], catalogProducts: [top, bottom],
    });
    const candidate = recommendations[0].candidate;
    candidate.items.push(candidate.items[1]);
    expect(complementaryProductsForDisplay(recommendations, top.id)).toEqual([bottom]);
  });
});

describe('Discover recommendations from catalog categories without stored outfit roles', () => {
  it('shows a bottom for a top', () => {
    const top = catalogProduct('top', 'upper_body');
    const bottom = catalogProduct('bottom', 'lower_body');
    const result = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [top, bottom] });
    expect(complementaryProductsForDisplay(result, top.id)).toEqual([bottom]);
  });

  it('shows a top for a bottom', () => {
    const top = catalogProduct('top', 'upper_body');
    const bottom = catalogProduct('bottom', 'lower_body');
    const result = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [bottom, top] });
    expect(complementaryProductsForDisplay(result, bottom.id)).toEqual([top]);
  });

  it('shows a compatible catalog item for a one-piece', () => {
    const dress = catalogProduct('dress', 'dresses');
    const shoes = catalogProduct('shoes', 'shoes');
    const result = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [dress, shoes] });
    expect(complementaryProductsForDisplay(result, dress.id)).toEqual([shoes]);
  });

  it('keeps the existing empty state when no complementary item exists', () => {
    const top = catalogProduct('top', 'upper_body');
    const result = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [top] });
    expect(result).toEqual([]);
    expect(complementaryProductsForDisplay(result, top.id)).toEqual([]);
  });

  it('preserves wardrobe and catalog sources in a mixed outfit', () => {
    const top = catalogProduct('top', 'upper_body');
    const shoes = catalogProduct('shoes', 'shoes');
    const wardrobeBottom = { id: 'owned-bottom', category: 'bottom' };
    const result = getDiscoverRecommendations({
      wardrobeItems: [wardrobeBottom], catalogProducts: [top, shoes],
    });
    expect(result.some((entry) => entry.candidate.items.some((item) =>
      item.sourceType === 'wardrobe' && item.wardrobeItem === wardrobeBottom))).toBe(true);
    expect(complementaryProductsForDisplay(result, top.id)).toEqual([shoes]);
  });
});
