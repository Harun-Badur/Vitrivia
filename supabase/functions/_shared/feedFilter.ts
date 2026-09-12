export interface StructuredFilters {
  category?: string;
  color?: string;
  priceMin?: number;
  priceMax?: number;
  brand?: string;
  text?: string;
  style?: string;
}

export type SoftFilterKey = 'color' | 'style' | 'text';

export interface FilterableCandidate {
  id: string;
  brand: string;
  category: string;
  colors: string[];
  price: number;
  title: string;
  garmentDescription: string;
  subcategory: string;
}

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase('tr-TR');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const parseStructuredFilters = (value: unknown): StructuredFilters => {
  if (!isRecord(value)) {
    return {};
  }
  const filters: StructuredFilters = {};
  if (typeof value.category === 'string' && value.category.trim()) {
    filters.category = value.category.trim();
  }
  if (typeof value.color === 'string' && value.color.trim()) {
    filters.color = value.color.trim().toLocaleLowerCase('tr-TR');
  }
  if (typeof value.brand === 'string' && value.brand.trim()) {
    filters.brand = value.brand.trim();
  }
  if (typeof value.text === 'string' && value.text.trim()) {
    filters.text = value.text.trim();
  }
  if (typeof value.style === 'string' && value.style.trim()) {
    filters.style = value.style.trim().toLocaleLowerCase('tr-TR');
  }
  if (typeof value.priceMin === 'number' && Number.isFinite(value.priceMin)) {
    filters.priceMin = value.priceMin;
  }
  if (typeof value.priceMax === 'number' && Number.isFinite(value.priceMax)) {
    filters.priceMax = value.priceMax;
  }
  return filters;
};

export const hasStructuredFilters = (filters: StructuredFilters): boolean =>
  Boolean(
    filters.category ||
      filters.color ||
      filters.brand ||
      filters.style ||
      (filters.text && filters.text.length > 0) ||
      typeof filters.priceMin === 'number' ||
      typeof filters.priceMax === 'number',
  );

const matchesHard = (
  item: FilterableCandidate,
  filters: StructuredFilters,
): boolean => {
  if (filters.category && item.category !== filters.category) return false;
  if (typeof filters.priceMin === 'number' && item.price < filters.priceMin) {
    return false;
  }
  if (typeof filters.priceMax === 'number' && item.price > filters.priceMax) {
    return false;
  }
  if (filters.brand && normalize(item.brand) !== normalize(filters.brand)) {
    return false;
  }
  return true;
};

const matchesSoft = (
  item: FilterableCandidate,
  filters: StructuredFilters,
  drop: ReadonlySet<SoftFilterKey>,
): boolean => {
  if (!drop.has('color') && filters.color) {
    const hay = normalize(`${item.title} ${item.garmentDescription}`);
    const inSlugs = item.colors.includes(filters.color);
    if (!inSlugs && !hay.includes(normalize(filters.color))) {
      return false;
    }
  }
  if (!drop.has('style') && filters.style) {
    const hay = normalize(
      `${item.title} ${item.garmentDescription} ${item.subcategory}`,
    );
    if (!hay.includes(normalize(filters.style))) {
      return false;
    }
  }
  if (!drop.has('text') && filters.text) {
    const hay = normalize(
      `${item.brand} ${item.title} ${item.garmentDescription}`,
    );
    if (!hay.includes(normalize(filters.text))) {
      return false;
    }
  }
  return true;
};

export const matchesStructuredFilters = (
  item: FilterableCandidate,
  filters: StructuredFilters,
  drop: ReadonlySet<SoftFilterKey> = new Set(),
): boolean => matchesHard(item, filters) && matchesSoft(item, filters, drop);

export const applyFilterMaskProgressive = <T>(
  items: T[],
  filters: StructuredFilters,
  toCandidate: (item: T) => FilterableCandidate,
): { items: T[]; fallback: boolean; dropped: SoftFilterKey[] } => {
  if (!hasStructuredFilters(filters)) {
    return { items, fallback: false, dropped: [] };
  }

  const softOrder: SoftFilterKey[] = ['color', 'style', 'text'];
  const drop = new Set<SoftFilterKey>();
  const run = (): T[] =>
    items.filter((item) =>
      matchesStructuredFilters(toCandidate(item), filters, drop),
    );

  let matched = run();
  if (matched.length > 0) {
    return { items: matched, fallback: false, dropped: [] };
  }

  const hasSoft =
    Boolean(filters.color) ||
    Boolean(filters.style) ||
    Boolean(filters.text);

  if (!hasSoft) {
    return { items: [], fallback: false, dropped: [] };
  }

  const dropped: SoftFilterKey[] = [];
  for (const key of softOrder) {
    const present =
      (key === 'color' && Boolean(filters.color)) ||
      (key === 'style' && Boolean(filters.style)) ||
      (key === 'text' && Boolean(filters.text));
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
