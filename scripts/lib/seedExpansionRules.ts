import { isGarmentCategory, type GarmentCategory, type OutfitRole } from '../../types/product';

const CATEGORY_FROM_INPUT: Record<string, GarmentCategory> = {
  ELBİSE: 'dresses',
  ELBISE: 'dresses',
  DRESSES: 'dresses',
  'ÜST GİYİM': 'upper_body',
  'UST GIYIM': 'upper_body',
  UPPER_BODY: 'upper_body',
  'ALT GİYİM': 'lower_body',
  'ALT GIYIM': 'lower_body',
  LOWER_BODY: 'lower_body',
  AYAKKABI: 'shoes',
  SHOES: 'shoes',
  ÇANTA: 'bags',
  CANTA: 'bags',
  BAGS: 'bags',
  ŞAPKA: 'hats',
  SAPKA: 'hats',
  HATS: 'hats',
  AKSESUAR: 'accessories',
  ACCESSORIES: 'accessories',
};

export const mapExpansionCategory = (raw: string): GarmentCategory | null => {
  const canonical = raw.trim().toLowerCase();
  if (isGarmentCategory(canonical)) return canonical;
  const key = raw.trim().toLocaleUpperCase('tr-TR');
  return CATEGORY_FROM_INPUT[key] ?? null;
};

export const canonicalizeCatalogUrl = (raw: string): string => {
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('invalid_url');
  }
  parsed.search = '';
  parsed.hash = '';
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
};

export type DuplicateReason = 'duplicate_in_input' | 'already_in_catalog';

export const duplicateReason = (
  id: string,
  canonicalUrl: string,
  seenIds: ReadonlySet<string>,
  seenUrls: ReadonlySet<string>,
  existingIds: ReadonlySet<string>,
  existingUrls: ReadonlySet<string>,
): DuplicateReason | null => {
  if (seenIds.has(id) || seenUrls.has(canonicalUrl)) {
    return 'duplicate_in_input';
  }
  if (existingIds.has(id) || existingUrls.has(canonicalUrl)) {
    return 'already_in_catalog';
  }
  return null;
};

export const isGenericTitle = (title: string): boolean => {
  const normalized = title.trim().toLocaleLowerCase('tr-TR');
  return (
    normalized.length < 8 ||
    normalized.includes("türkiye'nin trend yolu") ||
    normalized.includes('online alışveriş sitesi') ||
    normalized === 'trendyol' ||
    normalized === 'hepsiburada'
  );
};

export interface ProductMetadataGate {
  httpStatus: number;
  softBlocked: boolean;
  title: string;
  price: number | null;
  imageUrls?: readonly string[];
}

export const metadataSkipReason = (meta: ProductMetadataGate): string | null => {
  if (meta.httpStatus !== 200) return `http_${meta.httpStatus || 'error'}`;
  if (meta.softBlocked) return 'soft_blocked_shell';
  if (isGenericTitle(meta.title)) return 'no_usable_title';
  if (meta.price === null || !Number.isFinite(meta.price) || meta.price <= 0) {
    return 'no_usable_price';
  }
  if (meta.imageUrls !== undefined && meta.imageUrls.length === 0) {
    return 'no_usable_image';
  }
  return null;
};

const hasAny = (value: string, words: readonly string[]): boolean =>
  words.some((word) => value.includes(word));

/** Only classify upper-body items when title/subcategory has a clear signal. */
export const inferExpansionOutfitRole = (
  category: GarmentCategory,
  title: string,
  subcategory: string | null,
): OutfitRole | null => {
  if (category === 'lower_body') return 'bottom';
  if (category === 'dresses') return 'one_piece';
  if (category === 'shoes') return 'shoes';
  if (category === 'bags') return 'bag';
  if (category === 'hats') return 'hat';
  if (category === 'accessories') return 'accessory';

  const titleText = title.toLocaleLowerCase('tr-TR');
  const subcategoryText = subcategory?.toLocaleLowerCase('tr-TR') ?? '';
  if (hasAny(titleText, ['takım elbise', 'takim elbise', 'ikili takım', 'ikili takim'])) {
    return null;
  }
  const outerwear = hasAny(titleText, [
    'ceket', 'blazer', 'mont', 'kaban', 'palto', 'trençkot', 'trenc', 'hırka',
  ]) || hasAny(subcategoryText, ['ceket', 'blazer']);
  const top = hasAny(titleText, [
    'tişört', 'tisort', 't-shirt', 'gömlek', 'gomlek', 'bluz', 'kazak',
    'sweatshirt', 'hoodie', 'polo', 'atlet', 'tunik', 'body',
  ]) || hasAny(subcategoryText, ['gomlek', 'polo', 'sweatshirt', 'hoodie']);
  if (outerwear === top) return null;
  return outerwear ? 'outerwear' : 'top';
};
