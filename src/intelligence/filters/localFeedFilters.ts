import { applyFilterMaskProgressive } from '../../../lib/feedFilter';
import { hasAnyFilter, type FeedQueryFilters } from '../../../lib/feedQuery';
import type { Product } from '../../../types/product';

export interface LocalFilterResult {
  products: Product[];
  fallback: boolean;
  relaxed: string[];
}

export const applyLocalFilters = (
  products: Product[],
  filters: FeedQueryFilters,
): LocalFilterResult => {
  if (!hasAnyFilter(filters)) {
    return { products, fallback: false, relaxed: [] };
  }
  const masked = applyFilterMaskProgressive(products, filters, (p) => p);
  return {
    products: masked.items,
    fallback: masked.fallback,
    relaxed: masked.relaxed,
  };
};
