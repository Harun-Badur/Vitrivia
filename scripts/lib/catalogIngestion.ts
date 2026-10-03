import type { FeedProvider, GarmentCategory, ProductGender } from '../../types/product';
import { detectCatalogProvider, extractCatalogExternalId } from './retailProviders';
import {
  canonicalizeCatalogUrl,
  duplicateReason,
  mapExpansionCategory,
  metadataSkipReason,
} from './seedExpansionRules';

export interface CatalogLink {
  url: string;
  categoryRaw: string;
  gender: ProductGender | null;
  brandHint: string;
}

export interface CatalogMetadata {
  httpStatus: number;
  softBlocked: boolean;
  title: string;
  brand: string | null;
  price: number | null;
  imageUrls: string[];
  imageSource: string;
}

export interface CatalogProduct {
  id: string;
  provider: FeedProvider;
  external_id: string;
  title: string;
  brand: string | null;
  price: number;
  currency: 'TRY';
  image_url: string;
  images: string[];
  product_url: string;
  category: GarmentCategory;
  affiliate_url: null;
  garment_description: string;
  gender: ProductGender | null;
  imageSource: string;
}

export type IngestionResult =
  | { status: 'ready'; provider: FeedProvider; url: string; product: CatalogProduct }
  | { status: 'duplicate' | 'skipped' | 'failed'; provider: FeedProvider | null; url: string; reason: string };

export type ImportResult = IngestionResult | {
  status: 'inserted'; provider: FeedProvider; url: string;
};

/** A dry run cannot reach a write callback, even for fully validated products. */
export const persistIngestionResult = async (
  result: IngestionResult,
  dryRun: boolean,
  insert: (product: CatalogProduct) => Promise<ImportResult>,
): Promise<ImportResult> => {
  if (result.status !== 'ready' || dryRun) return result;
  try {
    return await insert(result.product);
  } catch (error) {
    return {
      status: 'failed', provider: result.provider, url: result.url,
      reason: error instanceof Error ? `insert_error:${error.message}` : 'insert_error',
    };
  }
};

export interface CatalogIdentitySets {
  ids: Set<string>;
  urls: Set<string>;
}

export const ingestCatalogLink = async (
  link: CatalogLink,
  existing: CatalogIdentitySets,
  seen: CatalogIdentitySets,
  extractMetadata: (url: string, provider: FeedProvider) => Promise<CatalogMetadata>,
): Promise<IngestionResult> => {
  let url: string;
  try {
    url = canonicalizeCatalogUrl(link.url);
  } catch {
    return { status: 'skipped', provider: null, url: link.url, reason: 'invalid_url' };
  }
  const provider = detectCatalogProvider(url);
  if (!provider) return { status: 'skipped', provider: null, url, reason: 'unknown_provider' };

  const externalId = extractCatalogExternalId(url, provider);
  if (!externalId) return { status: 'skipped', provider, url, reason: 'external_id_parse_failed' };
  const id = `${provider}-${externalId}`;
  const duplicate = duplicateReason(id, url, seen.ids, seen.urls, existing.ids, existing.urls);
  if (duplicate) return { status: 'duplicate', provider, url, reason: duplicate };
  seen.ids.add(id);
  seen.urls.add(url);

  const category = mapExpansionCategory(link.categoryRaw);
  if (!category) return { status: 'skipped', provider, url, reason: 'unknown_category' };

  let meta: CatalogMetadata;
  try {
    meta = await extractMetadata(url, provider);
  } catch (error) {
    return {
      status: 'failed', provider, url,
      reason: error instanceof Error ? `metadata_fetch_error:${error.message}` : 'metadata_fetch_error',
    };
  }
  const issue = metadataSkipReason(meta);
  if (issue) return { status: 'skipped', provider, url, reason: issue };

  const images = [...new Set(meta.imageUrls)];
  const price = meta.price;
  if (price === null || images.length === 0) {
    return { status: 'skipped', provider, url, reason: 'incomplete_metadata' };
  }
  const brand = meta.brand?.trim() || link.brandHint.trim() || null;
  const title = meta.title.trim();
  return {
    status: 'ready', provider, url,
    product: {
      id, provider, external_id: externalId, title, brand, price, currency: 'TRY',
      image_url: images[0], images, product_url: url, category,
      affiliate_url: null, garment_description: brand ? `${brand} ${title}` : title,
      gender: link.gender, imageSource: meta.imageSource,
    },
  };
};
