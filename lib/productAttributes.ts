export const FIT_VOCAB = ['oversized', 'relaxed', 'regular', 'slim'] as const;

export type FitSlug = (typeof FIT_VOCAB)[number];

export const PRICE_BANDS = ['low', 'mid', 'high', 'luxury'] as const;

export type PriceBand = (typeof PRICE_BANDS)[number];

export type ProductGender = 'women' | 'men' | 'unisex';

export interface InferredProductAttributes {
  gender: ProductGender;
  colors: string[];
  fit: FitSlug;
  subcategory: string;
  brand_slug: string;
  price_band: PriceBand;
}

export interface ProductAttributeSeedInput {
  title: string;
  brand: string | null;
  price: number;
  category: string;
  existingColorNames?: string[];
}

export interface ColorAlias {
  slug: string;
  keys: readonly string[];
}

/** Kanonik renk sözlüğü (~20). Skorlama bu slug'ları bekler. */
export const COLOR_ALIASES: readonly ColorAlias[] = [
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
  { slug: 'desenli', keys: ['desenli', 'çiçek', 'cicek', 'floral', 'çizgili', 'cizgili'] },
];

interface SubcategoryRule {
  slug: string;
  keys: readonly string[];
}

const SUBCATEGORY_RULES: readonly SubcategoryRule[] = [
  { slug: 'elbise', keys: ['elbise', 'dress', 'midi elbise'] },
  { slug: 'blazer', keys: ['blazer', 'kruvaze', 'takım elbise', 'takim elbise'] },
  { slug: 'ceket', keys: ['ceket', 'jacket', 'mont', 'kaban'] },
  { slug: 'hoodie', keys: ['hoodie', 'kapüşon', 'kapuson'] },
  { slug: 'sweatshirt', keys: ['sweatshirt', 'sweat'] },
  { slug: 'gomlek', keys: ['gömlek', 'gomlek', 'shirt'] },
  { slug: 'polo', keys: ['polo'] },
  { slug: 'tisort', keys: ['tişört', 'tisort', 't-shirt', 'tshirt', 't shirt'] },
  { slug: 'jean', keys: ['jean', 'kot', 'denim'] },
  { slug: 'kargo', keys: ['kargo', 'cargo'] },
  { slug: 'esofman', keys: ['eşofman', 'esofman', 'jogger'] },
  { slug: 'sort', keys: ['şort', 'sort', 'short'] },
  { slug: 'etek', keys: ['etek', 'skirt'] },
  { slug: 'pantolon', keys: ['pantolon', 'pants', 'trousers'] },
  { slug: 'pareo', keys: ['pareo'] },
];

const GENDER_MEN_TOKENS = ['erkek', 'oğlan', 'oglan'] as const;
const GENDER_WOMEN_TOKENS = ['kadın', 'kadin', 'kız', 'kiz'] as const;

const PRICE_BAND_LOW_MAX = 499.99;
const PRICE_BAND_MID_MAX = 1499.99;
const PRICE_BAND_HIGH_MAX = 2999.99;

export const slugify = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const normalizeTitleKey = (title: string): string =>
  title.trim().toLocaleLowerCase('tr-TR');

const haystackOf = (title: string): string => title.toLocaleLowerCase('tr-TR');

const titleHasToken = (haystack: string, token: string): boolean => {
  const needle = token.toLocaleLowerCase('tr-TR');
  const start = haystack.indexOf(needle);
  if (start < 0) {
    return false;
  }
  const before = start === 0 ? '' : haystack[start - 1];
  const afterIndex = start + needle.length;
  const after = afterIndex >= haystack.length ? '' : haystack[afterIndex];
  const isBoundary = (char: string): boolean =>
    char.length === 0 || /[^a-z0-9ğüşöçı]/i.test(char);
  return isBoundary(before ?? '') && isBoundary(after ?? '');
};

export const inferGenderFromTitle = (title: string): ProductGender => {
  const haystack = haystackOf(title);
  if (GENDER_MEN_TOKENS.some((token) => titleHasToken(haystack, token))) {
    return 'men';
  }
  if (GENDER_WOMEN_TOKENS.some((token) => titleHasToken(haystack, token))) {
    return 'women';
  }
  return 'unisex';
};

export const inferColorsFromText = (text: string): string[] => {
  const haystack = haystackOf(text);
  const slugs: string[] = [];
  for (const alias of COLOR_ALIASES) {
    if (alias.keys.some((key) => haystack.includes(key.toLocaleLowerCase('tr-TR')))) {
      slugs.push(alias.slug);
    }
  }
  return slugs;
};

export const inferFitFromTitle = (title: string): FitSlug => {
  const haystack = haystackOf(title);
  if (
    haystack.includes('oversize') ||
    haystack.includes('bol kesim') ||
    haystack.includes('over-size')
  ) {
    return 'oversized';
  }
  if (
    haystack.includes('slim') ||
    haystack.includes('dar kesim') ||
    haystack.includes('skinny')
  ) {
    return 'slim';
  }
  if (
    haystack.includes('relaxed') ||
    haystack.includes('comfort') ||
    haystack.includes('rahat kalıp') ||
    haystack.includes('rahat kalip')
  ) {
    return 'relaxed';
  }
  if (haystack.includes('regular')) {
    return 'regular';
  }
  return 'regular';
};

export const inferSubcategory = (title: string, category: string): string => {
  const haystack = haystackOf(title);
  for (const rule of SUBCATEGORY_RULES) {
    if (rule.keys.some((key) => haystack.includes(key.toLocaleLowerCase('tr-TR')))) {
      return rule.slug;
    }
  }
  if (category === 'dresses') {
    return 'elbise';
  }
  if (category === 'lower_body') {
    return 'pantolon';
  }
  if (category === 'shoes') {
    return 'ayakkabi';
  }
  if (category === 'bags') {
    return 'canta';
  }
  if (category === 'hats') {
    return 'sapka';
  }
  if (category === 'accessories') {
    return 'aksesuar';
  }
  return 'tisort';
};

export const inferPriceBand = (price: number): PriceBand => {
  if (price <= PRICE_BAND_LOW_MAX) {
    return 'low';
  }
  if (price <= PRICE_BAND_MID_MAX) {
    return 'mid';
  }
  if (price <= PRICE_BAND_HIGH_MAX) {
    return 'high';
  }
  return 'luxury';
};

export const uniqueSlugs = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const slug = slugify(value);
    if (slug.length === 0 || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    result.push(slug);
  }
  return result;
};

/**
 * seedRealCatalog.ts CATALOG başlıkları — heuristic'i net vakalarda ezer.
 * Yeni ürünler title heuristic ile düşer.
 */
export const CURATED_ATTRIBUTE_OVERRIDES: Record<
  string,
  Partial<Pick<InferredProductAttributes, 'colors' | 'fit' | 'subcategory' | 'gender'>>
> = {
  [normalizeTitleKey('Keten Karışımlı Bol Kesim Pantolon')]: {
    fit: 'oversized',
    subcategory: 'pantolon',
  },
  [normalizeTitleKey('Kare Yaka Askılı Tişört')]: {
    subcategory: 'tisort',
    fit: 'regular',
  },
  [normalizeTitleKey('Kahverengi Drapeli Çiçek Aksesuarlı Midi Elbise')]: {
    colors: ['kahverengi'],
    subcategory: 'elbise',
    gender: 'women',
  },
  [normalizeTitleKey('Erkek Kahverengi Polo Yaka Tişört')]: {
    colors: ['kahverengi'],
    subcategory: 'polo',
    fit: 'slim',
    gender: 'men',
  },
  [normalizeTitleKey('Erkek Gri Keten Relaxed Fit Pantolon')]: {
    colors: ['gri'],
    subcategory: 'pantolon',
    fit: 'relaxed',
    gender: 'men',
  },
  [normalizeTitleKey('Gri Çizgili Kruvaze Takım Elbise')]: {
    colors: ['gri'],
    subcategory: 'blazer',
    fit: 'regular',
    gender: 'men',
  },
  [normalizeTitleKey('Slogan Baskılı Basic Beyaz T-Shirt')]: {
    colors: ['beyaz'],
    subcategory: 'tisort',
    fit: 'regular',
  },
  [normalizeTitleKey('Erkek İndigo Comfort Fit Bisiklet Yaka Tişört')]: {
    colors: ['navy'],
    subcategory: 'tisort',
    fit: 'relaxed',
    gender: 'men',
  },
  [normalizeTitleKey("Kahverengi ve Siyah Tül Pareo 2'li Set")]: {
    colors: ['kahverengi', 'siyah'],
    subcategory: 'pareo',
    gender: 'women',
  },
  [normalizeTitleKey('Firfirlı Transparan Şifon Pareo')]: {
    subcategory: 'pareo',
    gender: 'women',
  },
};

export const inferProductAttributes = (
  input: ProductAttributeSeedInput,
): InferredProductAttributes => {
  const titleKey = normalizeTitleKey(input.title);
  const curated = CURATED_ATTRIBUTE_OVERRIDES[titleKey];
  const fromTitle = inferColorsFromText(input.title);
  const fromExisting = (input.existingColorNames ?? []).flatMap((name) =>
    inferColorsFromText(name),
  );

  return {
    gender: curated?.gender ?? inferGenderFromTitle(input.title),
    colors: uniqueSlugs(curated?.colors ?? [...fromExisting, ...fromTitle]),
    fit: curated?.fit ?? inferFitFromTitle(input.title),
    subcategory: curated?.subcategory ?? inferSubcategory(input.title, input.category),
    brand_slug: slugify(input.brand?.trim() || 'kabin'),
    price_band: inferPriceBand(input.price),
  };
};
