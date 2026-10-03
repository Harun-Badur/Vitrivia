export const GARMENT_CATEGORIES = [
  'upper_body',
  'lower_body',
  'dresses',
  'shoes',
  'bags',
  'hats',
  'accessories',
] as const;

export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export const isGarmentCategory = (value: unknown): value is GarmentCategory =>
  typeof value === 'string' &&
  (GARMENT_CATEGORIES as readonly string[]).includes(value);

export const OUTFIT_ROLES = [
  'top',
  'bottom',
  'outerwear',
  'one_piece',
  'shoes',
  'bag',
  'hat',
  'accessory',
] as const;

export type OutfitRole = (typeof OUTFIT_ROLES)[number];

export const isOutfitRole = (value: unknown): value is OutfitRole =>
  typeof value === 'string' &&
  (OUTFIT_ROLES as readonly string[]).includes(value);

export const FEED_PROVIDERS = [
  'amazon', 'trendyol', 'hepsiburada', 'mock',
  'boyner', 'mavi', 'lcw', 'defacto', 'flo',
] as const;

export type FeedProvider = (typeof FEED_PROVIDERS)[number];

export const isFeedProvider = (value: unknown): value is FeedProvider =>
  typeof value === 'string' &&
  (FEED_PROVIDERS as readonly string[]).includes(value);

export type ProductGender = 'women' | 'men' | 'unisex';

export interface ProductColor {
  name: string;
  hex: string;
}

export interface Product {
  id: string;
  imageUrl: string;
  /** Ordered gallery URLs from CDN scrape; UI may ignore for now. */
  images?: string[];
  title: string;
  price: number;
  currentPrice?: number;
  previousPrice?: number;
  lastPriceCheckedAt?: string;
  createdAt?: string;
  brand: string;
  category: GarmentCategory;
  outfitRole?: OutfitRole | null;
  garmentDescription: string;
  provider?: FeedProvider;
  productUrl?: string;
  affiliateUrl?: string;
  externalId?: string;
  colors?: ProductColor[];
  sizes?: string[];
  /** Kanonik skorlama alanları; yoksa başlıktan türetilir. */
  gender?: ProductGender;
  colorSlugs?: string[];
  fit?: string;
  subcategory?: string;
  brandSlug?: string;
  priceBand?: string;
  impressionCount?: number;
  /** recs-feed reasons[0]; yoksa chip gösterilmez. UI üretmez. */
  reason?: string;
}

export interface LikedProduct {
  product: Product;
  notifyOnPriceDrop: boolean;
  likedAt: string;
}

export interface FeedProductRow {
  id: string;
  provider: FeedProvider;
  external_id: string;
  title: string;
  brand: string | null;
  price: number | string;
  current_price?: number | string | null;
  previous_price?: number | string | null;
  last_price_checked_at?: string | null;
  currency: string;
  image_url: string;
  images?: string[] | null;
  product_url: string;
  category: string;
  affiliate_url: string | null;
  created_at?: string | null;
}

export const GARMENT_CATEGORY_LABEL: Record<GarmentCategory, string> = {
  upper_body: 'Üst Giyim',
  lower_body: 'Alt Giyim',
  dresses: 'Elbise',
  shoes: 'Ayakkabı',
  bags: 'Çanta',
  hats: 'Şapka',
  accessories: 'Aksesuar',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isOptionalFiniteNumber = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'number' && Number.isFinite(value));

export const isProductSnapshot = (value: unknown): value is Product => {
  if (!isRecord(value)) {
    return false;
  }

  const price = value.price;
  return (
    typeof value.id === 'string' &&
    typeof value.imageUrl === 'string' &&
    typeof value.title === 'string' &&
    typeof price === 'number' &&
    Number.isFinite(price) &&
    typeof value.brand === 'string' &&
    isGarmentCategory(value.category) &&
    (value.outfitRole == null || isOutfitRole(value.outfitRole)) &&
    typeof value.garmentDescription === 'string' &&
    isOptionalFiniteNumber(value.currentPrice) &&
    isOptionalFiniteNumber(value.previousPrice)
  );
};

export const getDisplayPrice = (product: Product): number => {
  if (
    typeof product.currentPrice === 'number' &&
    Number.isFinite(product.currentPrice)
  ) {
    return product.currentPrice;
  }
  return product.price;
};

export const hasCatalogPriceDrop = (product: Product): boolean => {
  const livePrice = getDisplayPrice(product);
  return (
    typeof product.previousPrice === 'number' &&
    product.previousPrice > livePrice
  );
};

export const formatTryPrice = (price: number): string =>
  `₺${price.toFixed(2)}`;

export const getDropPercent = (
  referencePrice: number,
  livePrice: number,
): number => {
  if (referencePrice <= 0 || livePrice >= referencePrice) {
    return 0;
  }
  const percent = Math.round(
    ((referencePrice - livePrice) / referencePrice) * 100,
  );
  return Math.max(1, percent);
};

/** Prefer `images` gallery; fall back to single `imageUrl`. */
export const getProductImages = (product: Product): string[] => {
  if (Array.isArray(product.images) && product.images.length > 0) {
    return product.images.filter(
      (url): url is string => typeof url === 'string' && url.trim().length > 0,
    );
  }
  if (typeof product.imageUrl === 'string' && product.imageUrl.trim().length > 0) {
    return [product.imageUrl];
  }
  return [];
};
