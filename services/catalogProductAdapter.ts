// Shared, unchanged Discover row mapping. No fetching, ranking or feed selection.
import { buildAffiliateUrl } from '../lib/deeplink';
import { parseOptionalNumeric } from '../lib/price';
import type { ProductAttributeRow } from '../src/intelligence/style/productStyle';
import { isGarmentCategory, isFeedProvider, type FeedProductRow, type Product, type ProductColor } from '../types/product';

export const DISCOVER_CATALOG_PAGE_SIZE = 80;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isFeedProductRow = (value: unknown): value is FeedProductRow => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.external_id === 'string' &&
    typeof value.title === 'string' &&
    (typeof value.brand === 'string' || value.brand === null) &&
    (typeof value.price === 'number' || typeof value.price === 'string') &&
    typeof value.currency === 'string' &&
    typeof value.image_url === 'string' &&
    typeof value.product_url === 'string' &&
    typeof value.category === 'string' &&
    (typeof value.affiliate_url === 'string' || value.affiliate_url === null)
  );
};

const isProductColor = (value: unknown): value is ProductColor => {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.name === 'string' && typeof value.hex === 'string';
};

const parseColors = (value: unknown): ProductColor[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed = value.filter(isProductColor);
  return parsed.length > 0 ? parsed : undefined;
};

const parseSizes = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return parsed.length > 0 ? parsed : undefined;
};

export const parseImages = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
};

const toPrice = (value: number | string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(String(value).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const readRowField = (row: FeedProductRow, key: 'colors' | 'sizes'): unknown => {
  if (!isRecord(row)) {
    return undefined;
  }
  return row[key];
};

export const isAttributeRow = (value: unknown): value is ProductAttributeRow =>
  isRecord(value) && typeof value.product_id === 'string';

export const mapFeedRow = (row: FeedProductRow): Product | null => {
  if (!isGarmentCategory(row.category) || !isFeedProvider(row.provider)) {
    return null;
  }

  const brand = row.brand?.trim() || 'Kabin';
  const productUrl = row.product_url;
  const affiliateUrl =
    row.affiliate_url?.trim() ||
    buildAffiliateUrl(row.provider, productUrl);
  const garmentDescription = `${brand} ${row.title}`.trim();

  const listPrice = toPrice(row.price);
  const currentPrice = parseOptionalNumeric(row.current_price);
  const images = parseImages(row.images);
  const imageUrl = images[0] ?? row.image_url;

  return {
    id: row.id,
    imageUrl,
    images: images.length > 0 ? images : undefined,
    title: row.title,
    price: listPrice,
    currentPrice,
    previousPrice: parseOptionalNumeric(row.previous_price),
    lastPriceCheckedAt:
      typeof row.last_price_checked_at === 'string'
        ? row.last_price_checked_at
        : undefined,
    createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    brand,
    category: row.category,
    garmentDescription,
    provider: row.provider,
    productUrl,
    affiliateUrl,
    externalId: row.external_id,
    colors: parseColors(readRowField(row, 'colors')),
    sizes: parseSizes(readRowField(row, 'sizes')),
  };
};
