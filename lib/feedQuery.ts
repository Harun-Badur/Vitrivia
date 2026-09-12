import type { GarmentCategory } from '../types/product';
import { GARMENT_CATEGORY_LABEL } from '../types/product';

/** Discover search/filter single source of truth (separate from ranking FeedMode). */
export type FeedQueryMode = 'personal' | 'search';

export interface FeedQueryFilters {
  category?: GarmentCategory;
  color?: string;
  priceMin?: number;
  priceMax?: number;
  brand?: string;
  text?: string;
  style?: string;
}

export interface FeedQuery {
  mode: FeedQueryMode;
  filters: FeedQueryFilters;
}

export const EMPTY_FEED_QUERY: FeedQuery = {
  mode: 'personal',
  filters: {},
};

export const COLOR_CHIP_LABELS: Record<string, string> = {
  siyah: 'siyah',
  beyaz: 'beyaz',
  gri: 'gri',
  bej: 'bej',
  kahverengi: 'kahverengi',
  navy: 'lacivert',
  mavi: 'mavi',
  kirmizi: 'kırmızı',
  pembe: 'pembe',
  yesil: 'yeşil',
  sari: 'sarı',
  turuncu: 'turuncu',
  mor: 'mor',
  bordo: 'bordo',
};

export const CATEGORY_CHIP_LABELS: Record<GarmentCategory, string> = {
  dresses: 'elbise',
  upper_body: 'üst',
  lower_body: 'alt',
};

export const hasAnyFilter = (filters: FeedQueryFilters): boolean => {
  if (filters.category) return true;
  if (filters.color) return true;
  if (filters.brand) return true;
  if (filters.style) return true;
  if (filters.text && filters.text.trim().length > 0) return true;
  if (typeof filters.priceMin === 'number') return true;
  if (typeof filters.priceMax === 'number') return true;
  return false;
};

export const isFeedQueryActive = (query: FeedQuery): boolean =>
  query.mode === 'search' || hasAnyFilter(query.filters);

export const countActiveFilters = (filters: FeedQueryFilters): number => {
  let n = 0;
  if (filters.category) n += 1;
  if (filters.color) n += 1;
  if (filters.brand) n += 1;
  if (filters.style) n += 1;
  if (filters.text && filters.text.trim().length > 0) n += 1;
  if (
    typeof filters.priceMin === 'number' ||
    typeof filters.priceMax === 'number'
  ) {
    n += 1;
  }
  return n;
};

export type FeedQueryFacetKey =
  | 'category'
  | 'color'
  | 'price'
  | 'brand'
  | 'text'
  | 'style';

export interface FeedQueryChip {
  key: FeedQueryFacetKey;
  label: string;
}

/** Active facet chips for the search strip (order matches product brief). */
export const facetChipsOnly = (filters: FeedQueryFilters): FeedQueryChip[] => {
  const chips: FeedQueryChip[] = [];
  if (filters.color) {
    chips.push({
      key: 'color',
      label: COLOR_CHIP_LABELS[filters.color] ?? filters.color,
    });
  }
  if (filters.category) {
    chips.push({
      key: 'category',
      label:
        CATEGORY_CHIP_LABELS[filters.category] ??
        GARMENT_CATEGORY_LABEL[filters.category],
    });
  }
  if (filters.style) {
    chips.push({ key: 'style', label: filters.style });
  }
  if (filters.brand) {
    chips.push({ key: 'brand', label: filters.brand });
  }
  if (
    typeof filters.priceMin === 'number' ||
    typeof filters.priceMax === 'number'
  ) {
    let label = '';
    if (
      typeof filters.priceMin === 'number' &&
      typeof filters.priceMax === 'number'
    ) {
      label = `${filters.priceMin}-${filters.priceMax}₺`;
    } else if (typeof filters.priceMax === 'number') {
      label = `<${filters.priceMax}₺`;
    } else if (typeof filters.priceMin === 'number') {
      label = `>${filters.priceMin}₺`;
    }
    chips.push({ key: 'price', label });
  }
  if (filters.text && filters.text.trim().length > 0) {
    chips.push({ key: 'text', label: filters.text.trim() });
  }
  return chips;
};

export const removeFacet = (
  filters: FeedQueryFilters,
  key: FeedQueryFacetKey,
): FeedQueryFilters => {
  const next = { ...filters };
  if (key === 'category') delete next.category;
  if (key === 'color') delete next.color;
  if (key === 'brand') delete next.brand;
  if (key === 'style') delete next.style;
  if (key === 'text') delete next.text;
  if (key === 'price') {
    delete next.priceMin;
    delete next.priceMax;
  }
  return next;
};

export const feedQueryFromFilters = (filters: FeedQueryFilters): FeedQuery => {
  if (hasAnyFilter(filters)) {
    return { mode: 'search', filters };
  }
  return { mode: 'personal', filters: {} };
};

export const SEARCH_HISTORY_KEY = 'kabin.search.history.v1';
export const SEARCH_HISTORY_LIMIT = 5;
