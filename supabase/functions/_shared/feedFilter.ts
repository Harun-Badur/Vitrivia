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

/** Mirrors lib/productAttributes COLOR_ALIASES slug → keys (edge copy). */
const COLOR_KEYS: ReadonlyArray<{ slug: string; keys: readonly string[] }> = [
  { slug: 'siyah', keys: ['siyah', 'black'] },
  { slug: 'beyaz', keys: ['beyaz', 'white'] },
  { slug: 'gri', keys: ['gri', 'grey', 'gray', 'antrasit', 'anthracite'] },
  { slug: 'bej', keys: ['bej', 'beige', 'krem', 'ekru', 'ivory'] },
  { slug: 'kahverengi', keys: ['kahverengi', 'kahve', 'brown'] },
  { slug: 'navy', keys: ['navy', 'lacivert', 'indigo'] },
  { slug: 'mavi', keys: ['mavi', 'blue'] },
  { slug: 'kirmizi', keys: ['kırmızı', 'kirmizi', 'red'] },
  { slug: 'pembe', keys: ['pembe', 'pink', 'fuşya', 'fusya'] },
  { slug: 'yesil', keys: ['yeşil', 'yesil', 'green', 'haki', 'olive'] },
  { slug: 'sari', keys: ['sarı', 'sari', 'yellow', 'hardal'] },
  { slug: 'turuncu', keys: ['turuncu', 'orange'] },
  { slug: 'mor', keys: ['mor', 'purple', 'lila', 'violet'] },
  { slug: 'bordo', keys: ['bordo', 'burgundy', 'maroon'] },
  { slug: 'camel', keys: ['camel', 'camel rengi'] },
  { slug: 'altin', keys: ['altın', 'altin', 'gold'] },
  { slug: 'gumus', keys: ['gümüş', 'gumus', 'silver'] },
  { slug: 'turkuaz', keys: ['turkuaz', 'teal'] },
  { slug: 'krem', keys: ['cream'] },
  {
    slug: 'desenli',
    keys: ['desenli', 'çiçek', 'cicek', 'floral', 'çizgili', 'cizgili'],
  },
];

const normalizeTr = (value: string): string =>
  value.trim().toLocaleLowerCase('tr-TR');

const foldTr = (value: string): string =>
  normalizeTr(value)
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');

const colorKeysForSlug = (slug: string): string[] => {
  const alias = COLOR_KEYS.find((item) => item.slug === slug);
  if (!alias) {
    return [slug];
  }
  return [alias.slug, ...alias.keys];
};

const facetHaystack = (item: FilterableCandidate): string =>
  foldTr(
    `${item.colors.join(' ')} ${item.title} ${item.brand} ${item.subcategory}`,
  );

const termInHaystack = (term: string, hayFolded: string): boolean => {
  const needle = foldTr(term);
  if (needle.length === 0) {
    return true;
  }
  return hayFolded.includes(needle);
};

const matchesColorFacet = (
  item: FilterableCandidate,
  colorSlug: string,
): boolean => {
  if (item.colors.includes(colorSlug)) {
    return true;
  }
  const hay = facetHaystack(item);
  return colorKeysForSlug(colorSlug).some((key) => termInHaystack(key, hay));
};

const matchesStyleFacet = (
  item: FilterableCandidate,
  style: string,
): boolean => termInHaystack(style, facetHaystack(item));

const matchesBrandFacet = (
  item: FilterableCandidate,
  brand: string,
): boolean => termInHaystack(brand, facetHaystack(item));

const matchesTextTitle = (title: string, text: string): boolean => {
  const needle = foldTr(text);
  if (needle.length === 0) {
    return true;
  }
  return foldTr(title).includes(needle);
};

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
  return true;
};

const matchesSoft = (
  item: FilterableCandidate,
  filters: StructuredFilters,
  drop: ReadonlySet<SoftFilterKey>,
): boolean => {
  if (filters.brand && !matchesBrandFacet(item, filters.brand)) {
    return false;
  }
  if (!drop.has('color') && filters.color) {
    if (!matchesColorFacet(item, filters.color)) {
      return false;
    }
  }
  if (!drop.has('style') && filters.style) {
    if (!matchesStyleFacet(item, filters.style)) {
      return false;
    }
  }
  if (!drop.has('text') && filters.text) {
    if (!matchesTextTitle(item.title, filters.text)) {
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
): { items: T[]; fallback: boolean; relaxed: SoftFilterKey[] } => {
  if (!hasStructuredFilters(filters)) {
    return { items, fallback: false, relaxed: [] };
  }

  const softOrder: SoftFilterKey[] = ['color', 'style', 'text'];
  const drop = new Set<SoftFilterKey>();
  const run = (): T[] =>
    items.filter((item) =>
      matchesStructuredFilters(toCandidate(item), filters, drop),
    );

  let matched = run();
  if (matched.length > 0) {
    return { items: matched, fallback: false, relaxed: [] };
  }

  const hasSoft =
    Boolean(filters.color) ||
    Boolean(filters.style) ||
    Boolean(filters.text);

  if (!hasSoft) {
    return { items: [], fallback: false, relaxed: [] };
  }

  const relaxed: SoftFilterKey[] = [];
  for (const key of softOrder) {
    const present =
      (key === 'color' && Boolean(filters.color)) ||
      (key === 'style' && Boolean(filters.style)) ||
      (key === 'text' && Boolean(filters.text));
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
