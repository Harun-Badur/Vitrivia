import type { FeedQueryFilters } from './feedQuery';
import {
  matchesBrandFacet,
  matchesColorFacet,
  matchesStyleFacet,
  matchesTextTitle,
} from './searchMatch';
import { getDisplayPrice, type Product } from '../types/product';

export type SoftFilterKey = 'color' | 'style' | 'text';

export interface FilterMaskResult<T> {
  items: T[];
  /** True only when soft ladder exhausted and items still empty (caller fills personal). */
  fallback: boolean;
  /** Soft fields dropped during progressive relax. */
  relaxed: SoftFilterKey[];
}

const productFields = (product: Product) => ({
  title: product.title,
  brand: product.brand,
  colorSlugs: product.colorSlugs,
  colorNames: (product.colors ?? []).map((c) => c.name),
  subcategory: product.subcategory,
});

const productMatchesHard = (
  product: Product,
  filters: FeedQueryFilters,
): boolean => {
  if (filters.category && product.category !== filters.category) {
    return false;
  }
  const price = getDisplayPrice(product);
  if (typeof filters.priceMin === 'number' && price < filters.priceMin) {
    return false;
  }
  if (typeof filters.priceMax === 'number' && price > filters.priceMax) {
    return false;
  }
  return true;
};

const productMatchesSoft = (
  product: Product,
  filters: FeedQueryFilters,
  drop: ReadonlySet<SoftFilterKey>,
): boolean => {
  const fields = productFields(product);

  // Brand is a facet term (color/title/brand haystack) but not in soft relax ladder.
  if (filters.brand && !matchesBrandFacet(fields, filters.brand)) {
    return false;
  }

  if (!drop.has('color') && filters.color) {
    if (!matchesColorFacet(fields, filters.color)) {
      return false;
    }
  }
  if (!drop.has('style') && filters.style) {
    if (!matchesStyleFacet(fields, filters.style)) {
      return false;
    }
  }
  if (!drop.has('text') && filters.text && filters.text.trim().length > 0) {
    if (!matchesTextTitle(product.title, filters.text)) {
      return false;
    }
  }
  return true;
};

export const productMatchesFilters = (
  product: Product,
  filters: FeedQueryFilters,
  drop: ReadonlySet<SoftFilterKey> = new Set(),
): boolean =>
  productMatchesHard(product, filters) &&
  productMatchesSoft(product, filters, drop);

/**
 * Score order preserved. Soft facets (color → style → text) relax if empty.
 * `fallback` is true only when the ladder is exhausted and the set is still empty.
 */
export const applyFilterMaskProgressive = <T>(
  items: T[],
  filters: FeedQueryFilters,
  getProduct: (item: T) => Product,
): FilterMaskResult<T> => {
  const softOrder: SoftFilterKey[] = ['color', 'style', 'text'];
  const drop = new Set<SoftFilterKey>();

  const run = (): T[] =>
    items.filter((item) =>
      productMatchesFilters(getProduct(item), filters, drop),
    );

  let matched = run();
  if (matched.length > 0) {
    return { items: matched, fallback: false, relaxed: [] };
  }

  const hasSoft =
    Boolean(filters.color) ||
    Boolean(filters.style) ||
    Boolean(filters.text && filters.text.trim().length > 0);

  if (!hasSoft) {
    return { items: [], fallback: false, relaxed: [] };
  }

  const relaxed: SoftFilterKey[] = [];
  for (const key of softOrder) {
    const present =
      (key === 'color' && Boolean(filters.color)) ||
      (key === 'style' && Boolean(filters.style)) ||
      (key === 'text' &&
        Boolean(filters.text && filters.text.trim().length > 0));
    if (!present) continue;
    drop.add(key);
    relaxed.push(key);
    matched = run();
    if (matched.length > 0) {
      return { items: matched, fallback: false, relaxed };
    }
  }

  return { items: [], fallback: true, relaxed };
};
