import type { GarmentCategory, Product, ProductGender } from '../../../types/product';
import { matchesProductQuery, normalizeSearch } from '../search/productSearch';
import { inferGenderFromTitle } from '../style/productStyle';

export interface ProductFilters {
  query?: string;
  category?: GarmentCategory | null;
  gender?: ProductGender | null;
  size?: string | null;
  color?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  brand?: string | null;
  style?: string | null;
  text?: string | null;
}

export const filterProducts = (
  products: Product[],
  filters: ProductFilters,
): Product[] => {
  const query = filters.query ? normalizeSearch(filters.query) : '';
  const category = filters.category ?? null;
  const gender = filters.gender ?? null;
  const size = filters.size?.trim() ?? null;

  return products.filter((product) => {
    if (query.length > 0 && !matchesProductQuery(product, query)) {
      return false;
    }

    if (category !== null && product.category !== category) {
      return false;
    }

    if (gender !== null) {
      const productGender = product.gender ?? inferGenderFromTitle(product.title);
      if (productGender !== gender && productGender !== 'unisex') {
        return false;
      }
    }

    if (size !== null) {
      const sizes = product.sizes ?? [];
      if (!sizes.includes(size)) {
        return false;
      }
    }

    return true;
  });
};
