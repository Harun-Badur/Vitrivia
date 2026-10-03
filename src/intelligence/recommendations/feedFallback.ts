import { hasAnyFilter, type FeedQueryFilters } from '../../../lib/feedQuery';
import type { Product } from '../../../types/product';
import { applyLocalFilters } from '../filters/localFeedFilters';

export const ensureNonEmptyFeed = (
  products: Product[],
  fallbackProducts: Product[],
): Product[] => (products.length > 0 ? products : fallbackProducts);

const usesPersonalFallback = (
  filteredProducts: Product[],
  filters: FeedQueryFilters,
): boolean => filteredProducts.length === 0 && hasAnyFilter(filters);

export interface LocalFeedSelection {
  products: Product[];
  fallback: boolean;
  relaxed: string[];
  /** Count before the final mock fallback, used by existing telemetry. */
  selectedCount: number;
}

export const selectLocalFeed = (
  products: Product[],
  filters: FeedQueryFilters,
  limit: number,
  fallbackProducts?: Product[],
): LocalFeedSelection => {
  const filtered = applyLocalFilters(products, filters);
  const usedPersonal = usesPersonalFallback(filtered.products, filters);
  const selected = (filtered.products.length > 0
    ? filtered.products
    : products
  ).slice(0, limit);
  return {
    products: fallbackProducts
      ? ensureNonEmptyFeed(selected, fallbackProducts)
      : selected,
    fallback: filtered.fallback || usedPersonal,
    relaxed: filtered.relaxed,
    selectedCount: selected.length,
  };
};
