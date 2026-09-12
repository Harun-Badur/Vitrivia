import { COLOR_ALIASES, slugify } from './productAttributes';
import type { FeedQueryFilters } from './feedQuery';
import type { GarmentCategory } from '../types/product';

export interface ParseSearchOptions {
  /** Catalog brand display names for matching (case-insensitive TR). */
  brands?: readonly string[];
}

export interface ParsedSearchQuery {
  filters: FeedQueryFilters;
  /** Tokens consumed by structured facets (for debugging/tests). */
  matchedTokens: string[];
}

const CATEGORY_ALIASES: ReadonlyArray<{
  category: GarmentCategory;
  keys: readonly string[];
}> = [
  { category: 'dresses', keys: ['elbise', 'elbiseler', 'dress', 'dresses'] },
  {
    category: 'upper_body',
    keys: ['üst', 'ust', 'üst giyim', 'ust giyim', 'upper', 'tişört', 'tisort', 'bluz', 'blouse'],
  },
  {
    category: 'lower_body',
    keys: ['alt', 'alt giyim', 'pantolon', 'etek', 'şort', 'sort'],
  },
  // Schema has no outerwear — map jackets/coats onto upper_body.
  {
    category: 'upper_body',
    keys: ['dış', 'dis', 'dış giyim', 'dis giyim', 'mont', 'ceket', 'kaban'],
  },
];

/** Tokens that are category-like but not in DB enum → text remainder. */
const UNSUPPORTED_CATEGORY_KEYS = [
  'ayakkabı',
  'ayakkabi',
  'çanta',
  'canta',
  'shoes',
  'bag',
] as const;

const STYLE_KEYS = [
  'midi',
  'maxi',
  'mini',
  'abiye',
  'triko',
  'saten',
  'satin',
] as const;

const DEFAULT_BRANDS = [
  'Maison Nori',
  'Luna Atelier',
  'Blue Form',
  'Atelier Noir',
  'Tudors',
  'Mango',
  'Zara',
  'H&M',
  'Pull&Bear',
  'Koton',
  'LC Waikiki',
  'Defacto',
  'Mavi',
  'Network',
  'Ipekyol',
  'Twist',
  'Stradivarius',
  'Bershka',
] as const;

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase('tr-TR');

const fold = (value: string): string =>
  normalize(value)
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');

const tokenize = (raw: string): string[] =>
  normalize(raw)
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

const findColorSlug = (token: string): string | null => {
  const n = normalize(token);
  const f = fold(token);
  for (const alias of COLOR_ALIASES) {
    for (const key of alias.keys) {
      if (normalize(key) === n || fold(key) === f) {
        return alias.slug;
      }
    }
    if (alias.slug === f || alias.slug === n) {
      return alias.slug;
    }
  }
  return null;
};

const findCategory = (tokens: string[], index: number): GarmentCategory | null => {
  // Prefer multi-word matches first ("üst giyim").
  if (index + 1 < tokens.length) {
    const pair = `${tokens[index]} ${tokens[index + 1]}`;
    const pairN = normalize(pair);
    const pairF = fold(pair);
    for (const rule of CATEGORY_ALIASES) {
      for (const key of rule.keys) {
        if (normalize(key) === pairN || fold(key) === pairF) {
          return rule.category;
        }
      }
    }
  }
  const token = tokens[index] ?? '';
  const n = normalize(token);
  const f = fold(token);
  for (const rule of CATEGORY_ALIASES) {
    for (const key of rule.keys) {
      if (key.includes(' ')) continue;
      if (normalize(key) === n || fold(key) === f) {
        return rule.category;
      }
    }
  }
  return null;
};

const isUnsupportedCategory = (token: string): boolean => {
  const n = normalize(token);
  const f = fold(token);
  return UNSUPPORTED_CATEGORY_KEYS.some(
    (key) => normalize(key) === n || fold(key) === f,
  );
};

const findStyle = (token: string): string | null => {
  const n = normalize(token);
  const f = fold(token);
  for (const key of STYLE_KEYS) {
    if (key === n || key === f) {
      return key === 'satin' ? 'saten' : key;
    }
  }
  return null;
};

const parsePricePatterns = (
  tokens: string[],
): {
  priceMin?: number;
  priceMax?: number;
  consumed: Set<number>;
} => {
  const consumed = new Set<number>();
  let priceMin: number | undefined;
  let priceMax: number | undefined;

  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const t = tokens[i] ?? '';

    // "200-400" or "200–400"
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(t);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        priceMin = Math.min(a, b);
        priceMax = Math.max(a, b);
        consumed.add(i);
        continue;
      }
    }

    // "500 altı" / "500alti" / "500'den az"
    const numOnly = /^(\d+)$/.exec(t);
    if (numOnly && i + 1 < tokens.length) {
      const next = fold(tokens[i + 1] ?? '');
      const amount = Number(numOnly[1]);
      if (Number.isFinite(amount)) {
        if (
          next === 'alti' ||
          next === 'altinda' ||
          next === 'altındaki' ||
          next === 'altindaki' ||
          next === 'kadar' ||
          next.startsWith('alti')
        ) {
          priceMax = amount;
          consumed.add(i);
          consumed.add(i + 1);
          continue;
        }
        if (
          next === 'ustu' ||
          next === 'ustunde' ||
          next === 'uzeri' ||
          next === 'uzerinde' ||
          next.startsWith('ustu') ||
          next.startsWith('uzer')
        ) {
          priceMin = amount;
          consumed.add(i);
          consumed.add(i + 1);
          continue;
        }
      }
    }

    // "<500" ">1000"
    const lt = /^[<≤]\s*(\d+)$/.exec(t);
    if (lt) {
      priceMax = Number(lt[1]);
      consumed.add(i);
      continue;
    }
    const gt = /^[>≥]\s*(\d+)$/.exec(t);
    if (gt) {
      priceMin = Number(gt[1]);
      consumed.add(i);
      continue;
    }
  }

  return { priceMin, priceMax, consumed };
};

const matchBrand = (
  tokens: string[],
  brands: readonly string[],
): { brand?: string; consumed: Set<number> } => {
  const consumed = new Set<number>();
  const catalog = brands.length > 0 ? brands : DEFAULT_BRANDS;

  // Longest brand name first so "LC Waikiki" beats "LC".
  const sorted = [...catalog].sort((a, b) => b.length - a.length);

  for (const brand of sorted) {
    const brandTokens = tokenize(brand);
    if (brandTokens.length === 0) continue;
    for (let i = 0; i <= tokens.length - brandTokens.length; i += 1) {
      let ok = true;
      for (let j = 0; j < brandTokens.length; j += 1) {
        if (fold(tokens[i + j] ?? '') !== fold(brandTokens[j] ?? '')) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (let j = 0; j < brandTokens.length; j += 1) {
          consumed.add(i + j);
        }
        return { brand, consumed };
      }
    }
    // Also match slugified single-token brands against slugify(token)
    if (brandTokens.length === 1) {
      const brandSlug = slugify(brand);
      for (let i = 0; i < tokens.length; i += 1) {
        if (slugify(tokens[i] ?? '') === brandSlug) {
          consumed.add(i);
          return { brand, consumed };
        }
      }
    }
  }
  return { consumed };
};

/**
 * Client-side Turkish NL → structured FeedQueryFilters. No LLM.
 * Remainder tokens become filters.text.
 */
export const parseSearchQuery = (
  raw: string,
  options: ParseSearchOptions = {},
): ParsedSearchQuery => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { filters: {}, matchedTokens: [] };
  }

  const tokens = tokenize(trimmed);
  const matchedTokens: string[] = [];
  const filters: FeedQueryFilters = {};
  const consumed = new Set<number>();

  const price = parsePricePatterns(tokens);
  for (const idx of price.consumed) consumed.add(idx);
  if (typeof price.priceMin === 'number') filters.priceMin = price.priceMin;
  if (typeof price.priceMax === 'number') filters.priceMax = price.priceMax;
  for (const idx of price.consumed) {
    matchedTokens.push(tokens[idx] ?? '');
  }

  const brandHit = matchBrand(tokens, options.brands ?? DEFAULT_BRANDS);
  for (const idx of brandHit.consumed) {
    if (!consumed.has(idx)) {
      consumed.add(idx);
      matchedTokens.push(tokens[idx] ?? '');
    }
  }
  if (brandHit.brand) filters.brand = brandHit.brand;

  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const token = tokens[i] ?? '';

    // Multi-word category
    if (i + 1 < tokens.length && !consumed.has(i + 1)) {
      const pairCat = findCategory(tokens, i);
      const pair = `${tokens[i]} ${tokens[i + 1]}`;
      const isMulti = CATEGORY_ALIASES.some((rule) =>
        rule.keys.some((k) => k.includes(' ') && fold(k) === fold(pair)),
      );
      if (pairCat && isMulti) {
        filters.category = pairCat;
        consumed.add(i);
        consumed.add(i + 1);
        matchedTokens.push(pair);
        continue;
      }
    }

    const color = findColorSlug(token);
    if (color && !filters.color) {
      filters.color = color;
      consumed.add(i);
      matchedTokens.push(token);
      continue;
    }

    const category = findCategory(tokens, i);
    if (category && !filters.category) {
      filters.category = category;
      consumed.add(i);
      matchedTokens.push(token);
      continue;
    }

    if (isUnsupportedCategory(token)) {
      // Keep as text remainder so user still gets some match signal.
      continue;
    }

    const style = findStyle(token);
    if (style && !filters.style) {
      filters.style = style;
      consumed.add(i);
      matchedTokens.push(token);
      continue;
    }
  }

  const remainder = tokens
    .filter((_, idx) => !consumed.has(idx))
    .join(' ')
    .trim();
  if (remainder.length > 0) {
    filters.text = remainder;
  }

  return { filters, matchedTokens };
};

export const DEFAULT_SEARCH_BRANDS: readonly string[] = DEFAULT_BRANDS;
