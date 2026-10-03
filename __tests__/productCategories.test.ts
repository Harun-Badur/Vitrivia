import {
  GARMENT_CATEGORIES,
  OUTFIT_ROLES,
  isGarmentCategory,
  isOutfitRole,
  isProductSnapshot,
  type Product,
} from '../types/product';
import { enrichProduct, resolveCatalogOutfitRole } from '../src/intelligence/style/productStyle';
import { filterProducts } from '../src/intelligence/filters/productFilters';

const baseProduct: Product = {
  id: 'product-1',
  imageUrl: 'https://example.com/image.jpg',
  title: 'Örnek Ürün',
  price: 100,
  brand: 'Örnek',
  category: 'upper_body',
  garmentDescription: 'Örnek ürün',
};

describe('product category and outfit role compatibility', () => {
  it.each(GARMENT_CATEGORIES)('accepts %s without changing existing product fields', (category) => {
    const product: Product = { ...baseProduct, category };
    expect(isGarmentCategory(category)).toBe(true);
    expect(isProductSnapshot(product)).toBe(true);
    expect(filterProducts([product], { category })).toEqual([product]);
  });

  it('derives only recognized catalog category roles and validates supplied values', () => {
    expect(isProductSnapshot(baseProduct)).toBe(true);
    expect(enrichProduct(baseProduct, undefined).outfitRole).toBe('top');
    expect(resolveCatalogOutfitRole('upper_body', null)).toBe('top');
    expect(resolveCatalogOutfitRole('lower_body', null)).toBe('bottom');
    expect(resolveCatalogOutfitRole('dresses', null)).toBe('one_piece');
    expect(resolveCatalogOutfitRole('shoes', null)).toBe('shoes');
    expect(resolveCatalogOutfitRole('bags', null)).toBe('bag');
    expect(resolveCatalogOutfitRole('hats', null)).toBe('hat');
    expect(resolveCatalogOutfitRole('accessories', null)).toBe('accessory');
    expect(resolveCatalogOutfitRole('unknown' as Product['category'], null)).toBeNull();
    for (const role of OUTFIT_ROLES) {
      expect(isOutfitRole(role)).toBe(true);
    }
    expect(isOutfitRole('invalid')).toBe(false);
    expect(isProductSnapshot({ ...baseProduct, outfitRole: 'invalid' })).toBe(false);

    const enriched = enrichProduct(baseProduct, {
      product_id: baseProduct.id,
      gender: null,
      colors: [],
      fit: null,
      subcategory: null,
      brand_slug: null,
      price_band: null,
      outfit_role: 'outerwear',
    });
    expect(enriched.outfitRole).toBe('outerwear');
  });
});
