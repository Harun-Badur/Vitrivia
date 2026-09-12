import type { FeedQueryFilters } from './feedQuery';
import { COLOR_ALIASES } from './productAttributes';
import { getDisplayPrice, type Product } from '../types/product';

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase('tr-TR');

export type SoftFilterKey = 'color' | 'style' | 'text';

export interface FilterMaskResult<T> {
  items: T[];
  fallback: boolean;
  dropped: SoftFilterKey[];
}

const colorKeysForSlug = (slug: string): string[] => {
  const alias = COLOR_ALIASES.find((item) => item.slug === slug);
  if (!alias) {
    return [slug];
  }
  return [alias.slug, ...alias.keys];
};

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
  if (filters.brand) {
    if (normalize(product.brand) !== normalize(filters.brand)) {
      return false;
    }
  }
  return true;
};

const productMatchesSoft = (
  product: Product,
  filters: FeedQueryFilters,
  drop: ReadonlySet<SoftFilterKey>,
): boolean => {
  if (!drop.has('color') && filters.color) {
    const slugs = product.colorSlugs ?? [];
    if (!slugs.includes(filters.color)) {
      const keys = colorKeysForSlug(filters.color).map(normalize);
      const names = (product.colors ?? []).map((c) => normalize(c.name));
      const hay = normalize(`${product.title} ${product.garmentDescription}`);
      const hit =
        names.some((n) => keys.some((k) => n.includes(k) || k.includes(n))) ||
        keys.some((k) => hay.includes(k));
      if (!hit) {
        return false;
      }
    }
  }
  if (!drop.has('style') && filters.style) {
    const hay = normalize(
      `${product.title} ${product.garmentDescription} ${product.subcategory ?? ''}`,
    );
    if (!hay.includes(normalize(filters.style))) {
      return false;
    }
  }
  if (!drop.has('text') && filters.text && filters.text.trim().length > 0) {
    const hay = normalize(
      `${product.brand} ${product.title} ${product.garmentDescription}`,
    );
    if (!hay.includes(normalize(filters.text))) {
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
    return { items: matched, fallback: false, dropped: [] };
  }

  const hasSoft =
    Boolean(filters.color) ||
    Boolean(filters.style) ||
    Boolean(filters.text && filters.text.trim().length > 0);

  if (!hasSoft) {
    return { items: [], fallback: false, dropped: [] };
  }

  const dropped: SoftFilterKey[] = [];
  for (const key of softOrder) {
    const present =
      (key === 'color' && Boolean(filters.color)) ||
      (key === 'style' && Boolean(filters.style)) ||
      (key === 'text' &&
        Boolean(filters.text && filters.text.trim().length > 0));
    if (!present) continue;
    drop.add(key);
    dropped.push(key);
    matched = run();
    if (matched.length > 0) {
      return { items: matched, fallback: true, dropped };
    }
  }

  return { items: [], fallback: dropped.length > 0, dropped };
};
