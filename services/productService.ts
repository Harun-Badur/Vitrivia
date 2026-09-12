import { MOCK_PRODUCTS } from '../data/mockProducts';
import { track } from '../lib/analytics';
import { buildAffiliateUrl } from '../lib/deeplink';
import { rerankForDiversity } from '../lib/diversity';
import { applyFilterMaskProgressive } from '../lib/feedFilter';
import type { FeedQueryFilters } from '../lib/feedQuery';
import { hasAnyFilter } from '../lib/feedQuery';
import { logger } from '../lib/logger';
import { parseOptionalNumeric } from '../lib/price';
import { inferProductAttributes } from '../lib/productAttributes';
import { fetchRecsConfig, fetchStyleProfileSnapshot } from '../lib/recsConfig';
import { setLastFeedMode, setLastRecommendationId } from '../lib/recsFeedState';
import { applyFeedMode, emptySessionIntent, rankCandidates } from '../lib/scoring';
import { buildIntent } from '../lib/sessionIntent';
import { getSupabaseClient } from '../lib/supabase';
import type {
  FeedProductRow,
  FeedProvider,
  Product,
  ProductColor,
  ProductGender,
} from '../types/product';
import { getDisplayPrice, hasCatalogPriceDrop } from '../types/product';
import type {
  FeedMode,
  RecsFeedItem,
  RecsFeedResponse,
  ScoringCandidate,
  SessionIntent,
} from '../types/recommendation';
import { DEFAULT_FEED_MODE } from '../types/recommendation';
import type { GarmentCategory } from '../types/product';

export type { ProductGender } from '../types/product';

export type FeedSource = 'supabase' | 'mock' | 'edge';

export interface FetchFeedProductsResult {
  products: Product[];
  source: FeedSource;
  isPersonalized: boolean;
  recommendationId?: string;
  /** True when personal recs substituted after empty search mask. */
  fallback?: boolean;
  /** Soft facets dropped during progressive relax. */
  relaxed?: string[];
}

const DEFAULT_FEED_LIMIT = 20;
const FETCH_POOL_MULTIPLIER = 4;
const EDGE_TIMEOUT_MS = 1_200;

interface ProductAttributeRow {
  product_id: string;
  gender: string | null;
  colors: unknown;
  fit: string | null;
  subcategory: string | null;
  brand_slug: string | null;
  price_band: string | null;
}

const isGarmentCategory = (value: string): value is GarmentCategory =>
  value === 'upper_body' || value === 'lower_body' || value === 'dresses';

const isFeedProvider = (value: string): value is FeedProvider =>
  value === 'amazon' ||
  value === 'trendyol' ||
  value === 'hepsiburada' ||
  value === 'mock';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFeedProductRow = (value: unknown): value is FeedProductRow => {
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

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
};

const parseImages = (value: unknown): string[] => {
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

const isAttributeRow = (value: unknown): value is ProductAttributeRow =>
  isRecord(value) && typeof value.product_id === 'string';

const mapFeedRow = (row: FeedProductRow): Product | null => {
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

const isProductGender = (value: string): value is ProductGender =>
  value === 'women' || value === 'men' || value === 'unisex';

const enrichProduct = (
  product: Product,
  attr: ProductAttributeRow | undefined,
): Product => {
  const inferred = inferProductAttributes({
    title: product.title,
    brand: product.brand,
    price: getDisplayPrice(product),
    category: product.category,
    existingColorNames: product.colors?.map((color) => color.name),
  });
  const colorSlugs =
    attr !== undefined && parseStringArray(attr.colors).length > 0
      ? parseStringArray(attr.colors)
      : inferred.colors;
  const genderRaw = attr?.gender ?? inferred.gender;
  return {
    ...product,
    gender: isProductGender(genderRaw) ? genderRaw : inferred.gender,
    colorSlugs,
    fit: attr?.fit ?? inferred.fit,
    subcategory: attr?.subcategory ?? inferred.subcategory,
    brandSlug: attr?.brand_slug ?? inferred.brand_slug,
    priceBand: attr?.price_band ?? inferred.price_band,
  };
};

export const toScoringCandidate = (product: Product): ScoringCandidate => {
  const inferred = inferProductAttributes({
    title: product.title,
    brand: product.brand,
    price: getDisplayPrice(product),
    category: product.category,
    existingColorNames: product.colors?.map((color) => color.name),
  });
  const createdAtMs = product.createdAt ? Date.parse(product.createdAt) : 0;
  return {
    id: product.id,
    brand: product.brand,
    brandSlug: product.brandSlug ?? inferred.brand_slug,
    category: product.category,
    subcategory: product.subcategory ?? inferred.subcategory,
    fit: product.fit ?? inferred.fit,
    colors:
      product.colorSlugs && product.colorSlugs.length > 0
        ? product.colorSlugs
        : inferred.colors,
    priceBand: product.priceBand ?? inferred.price_band,
    price: getDisplayPrice(product),
    gender: product.gender ?? inferred.gender,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
    impressionCount: product.impressionCount ?? 0,
    deal: hasCatalogPriceDrop(product) ? 1 : 0,
  };
};

const isProductSnapshotLite = (value: unknown): value is Product => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.imageUrl === 'string' &&
    typeof value.title === 'string' &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    typeof value.brand === 'string' &&
    typeof value.category === 'string' &&
    isGarmentCategory(value.category)
  );
};

const parseFeedItem = (value: unknown): RecsFeedItem | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (!isProductSnapshotLite(value.product)) {
    return null;
  }
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.filter((item): item is string => typeof item === 'string')
    : [];
  const score =
    typeof value.score === 'number' && Number.isFinite(value.score)
      ? value.score
      : 0;
  const position =
    typeof value.position === 'number' && Number.isFinite(value.position)
      ? value.position
      : 0;
  const firstReason = reasons[0]?.trim();
  const edgeImages = parseImages(
    isRecord(value.product) ? value.product.images : undefined,
  );
  const edgeImageUrl =
    edgeImages[0] ??
    (typeof value.product.imageUrl === 'string' ? value.product.imageUrl : '');
  const product: Product = {
    ...value.product,
    imageUrl: edgeImageUrl,
    images: edgeImages.length > 0 ? edgeImages : undefined,
    garmentDescription:
      typeof value.product.garmentDescription === 'string' &&
      value.product.garmentDescription.trim().length > 0
        ? value.product.garmentDescription
        : `${value.product.brand} ${value.product.title}`,
    reason: firstReason && firstReason.length > 0 ? firstReason : undefined,
  };
  return {
    product,
    score,
    reasons,
    position,
  };
};

const parseFeedResponse = (value: unknown): RecsFeedResponse | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.recommendation_id !== 'string' ||
    typeof value.score_id !== 'string' ||
    typeof value.config_version !== 'string' ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  const items = value.items
    .map(parseFeedItem)
    .filter((item): item is RecsFeedItem => item !== null);
  const relaxed = Array.isArray(value.relaxed)
    ? value.relaxed.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    recommendation_id: value.recommendation_id,
    score_id: value.score_id,
    config_version: value.config_version,
    items,
    fallback: value.fallback === true,
    relaxed,
  };
};

export const getRecsFeedUrl = (): string | null => {
  const explicit = process.env.EXPO_PUBLIC_RECS_FEED_URL?.trim().replace(
    /\/+$/,
    '',
  );
  if (explicit) {
    return explicit;
  }

  const proxyUrl = process.env.EXPO_PUBLIC_VTON_PROXY_URL?.trim().replace(
    /\/+$/,
    '',
  );
  if (proxyUrl) {
    return proxyUrl.replace(/\/vton-proxy$/, '/recs-feed');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(
    /\/+$/,
    '',
  );
  if (!supabaseUrl) {
    return null;
  }
  return `${supabaseUrl}/functions/v1/recs-feed`;
};

const neverEmpty = (products: Product[]): Product[] =>
  products.length > 0 ? products : MOCK_PRODUCTS;

const fetchCatalog = async (): Promise<Product[]> => {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const poolLimit = Math.max(DEFAULT_FEED_LIMIT * FETCH_POOL_MULTIPLIER, DEFAULT_FEED_LIMIT);
  const productSelectWithImages =
    'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, images, product_url, category, affiliate_url, colors, sizes, created_at';
  const productSelectLegacy =
    'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, product_url, category, affiliate_url, colors, sizes, created_at';

  let productsResult: {
    data: unknown[] | null;
    error: { message: string } | null;
  } = await client
    .from('products')
    .select(productSelectWithImages)
    .limit(poolLimit);

  if (
    productsResult.error &&
    /column .*images.* does not exist/i.test(productsResult.error.message)
  ) {
    logger.warn('products.images yok; legacy select kullanılıyor');
    productsResult = await client
      .from('products')
      .select(productSelectLegacy)
      .limit(poolLimit);
  }

  const attributesResult = await client
    .from('product_attributes')
    .select(
      'product_id, gender, colors, fit, subcategory, brand_slug, price_band',
    );

  if (productsResult.error) {
    logger.error('Supabase ürün feedi alınamadı', {
      detail: productsResult.error.message,
    });
    return [];
  }

  const attributesById = new Map<string, ProductAttributeRow>();
  for (const row of attributesResult.data ?? []) {
    if (isAttributeRow(row)) {
      attributesById.set(row.product_id, row);
    }
  }

  return (productsResult.data ?? [])
    .filter(isFeedProductRow)
    .map(mapFeedRow)
    .filter((product): product is Product => product !== null)
    .map((product) => enrichProduct(product, attributesById.get(product.id)));
};

const rankLocally = async (
  catalog: Product[],
  userId: string,
  intent: SessionIntent,
  limit: number,
  mode: FeedMode,
): Promise<Product[]> => {
  const [config, profile] = await Promise.all([
    fetchRecsConfig(),
    fetchStyleProfileSnapshot(userId),
  ]);
  const rankedConfig = applyFeedMode(config, mode);
  const candidates = catalog
    .map(toScoringCandidate)
    .filter((candidate) => {
      if (
        intent.constraints.category !== null &&
        candidate.category !== intent.constraints.category
      ) {
        return false;
      }
      if (intent.constraints.gender !== null) {
        if (
          candidate.gender !== intent.constraints.gender &&
          candidate.gender !== 'unisex'
        ) {
          return false;
        }
      }
      return true;
    });

  const nowMs = Date.now();
  const scored = rankCandidates(
    candidates,
    profile,
    intent,
    rankedConfig,
    nowMs,
    userId,
  );
  const ranked = rerankForDiversity(
    scored,
    intent,
    rankedConfig,
    profile,
    limit,
    nowMs,
  );
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const ordered = ranked.flatMap((item) => {
    const product = byId.get(item.candidate.id);
    return product ? [product] : [];
  });
  return neverEmpty(ordered.length > 0 ? ordered : catalog.slice(0, limit));
};

const fetchEdgeFeed = async (
  userId: string,
  intent: SessionIntent,
  limit: number,
  mode: FeedMode,
  filters: FeedQueryFilters = {},
): Promise<RecsFeedResponse | null> => {
  const url = getRecsFeedUrl();
  const client = getSupabaseClient();
  if (!url || !client) {
    return null;
  }

  const { data, error } = await client.auth.getSession();
  const accessToken = data.session?.access_token?.trim();
  if (error || !accessToken) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, EDGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        limit,
        intent,
        mode,
        filters: hasAnyFilter(filters) ? filters : undefined,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.debug('recs-feed HTTP hata', { status: response.status });
      return null;
    }
    const parsed = parseFeedResponse(await response.json());
    if (!parsed || parsed.items.length === 0) {
      return null;
    }
    return parsed;
  } catch (error) {
    logger.debug('recs-feed çağrısı düştü', { error });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchFeedProducts = async (
  limit = DEFAULT_FEED_LIMIT,
  userId: string | null = null,
  mode: FeedMode = DEFAULT_FEED_MODE,
  filters: FeedQueryFilters = {},
  telemetryMode?: 'personal' | 'trend' | 'search',
): Promise<FetchFeedProductsResult> => {
  const startedAt = Date.now();
  const intent = userId ? buildIntent() : emptySessionIntent();
  if (filters.category && !intent.constraints.category) {
    intent.constraints.category = filters.category;
  }
  setLastRecommendationId(null);
  setLastFeedMode(telemetryMode ?? mode);

  if (userId) {
    const edge = await fetchEdgeFeed(userId, intent, limit, mode, filters);
    if (edge) {
      setLastRecommendationId(edge.recommendation_id);
      logger.debug('recs-feed timing', {
        ms: Date.now() - startedAt,
        source: 'edge',
        n: edge.items.length,
        fallback: edge.fallback === true,
      });
      const edgeProducts = neverEmpty(edge.items.map((item) => item.product));
      return {
        products: edgeProducts,
        source: 'edge',
        isPersonalized: true,
        recommendationId: edge.recommendation_id,
        fallback: edge.fallback === true,
        relaxed: edge.relaxed ?? [],
      };
    }

    logger.debug('feed_fallback', { reason: 'edge_unavailable' });
    track('feed_fallback', null, { reason: 'edge_unavailable' });
  }

  const catalog = await fetchCatalog();
  if (catalog.length === 0) {
    logger.warn('Katalog boş; mock ürünlere düşülüyor.');
    return {
      products: MOCK_PRODUCTS,
      source: 'mock',
      isPersonalized: false,
    };
  }

  const applyLocalFilters = (
    products: Product[],
  ): { products: Product[]; fallback: boolean; relaxed: string[] } => {
    if (!hasAnyFilter(filters)) {
      return { products, fallback: false, relaxed: [] };
    }
    const masked = applyFilterMaskProgressive(products, filters, (p) => p);
    return {
      products: masked.items,
      fallback: masked.fallback,
      relaxed: masked.relaxed,
    };
  };

  if (!userId) {
    const filtered = applyLocalFilters(catalog);
    const usedPersonal = filtered.products.length === 0 && hasAnyFilter(filters);
    const catalogSlice = (filtered.products.length > 0
      ? filtered.products
      : catalog
    ).slice(0, limit);
    return {
      products: catalogSlice,
      source: 'supabase',
      isPersonalized: false,
      fallback: filtered.fallback || usedPersonal,
      relaxed: filtered.relaxed,
    };
  }

  try {
    const ranked = await rankLocally(catalog, userId, intent, limit * 3, mode);
    const filtered = applyLocalFilters(ranked);
    const usedPersonal = filtered.products.length === 0 && hasAnyFilter(filters);
    const sliced = (filtered.products.length > 0
      ? filtered.products
      : ranked
    ).slice(0, limit);
    logger.debug('recs-feed timing', {
      ms: Date.now() - startedAt,
      source: 'supabase',
      n: sliced.length,
      fallback: filtered.fallback || usedPersonal,
      relaxed: filtered.relaxed,
    });
    return {
      products: neverEmpty(sliced),
      source: 'supabase',
      isPersonalized: true,
      fallback: filtered.fallback || usedPersonal,
      relaxed: filtered.relaxed,
    };
  } catch (error) {
    logger.debug('Yerel skorlama düştü; katalog sırası kullanılıyor', { error });
    track('feed_fallback', null, { reason: 'local_rank_failed' });
    const filtered = applyLocalFilters(catalog);
    const usedPersonal = filtered.products.length === 0 && hasAnyFilter(filters);
    const fallbackProducts = neverEmpty(
      (filtered.products.length > 0 ? filtered.products : catalog).slice(0, limit),
    );
    return {
      products: fallbackProducts,
      source: 'supabase',
      isPersonalized: false,
      fallback: filtered.fallback || usedPersonal,
      relaxed: filtered.relaxed,
    };
  }
};

export interface ProductFilters {
  query?: string;
  category?: GarmentCategory | null;
  gender?: ProductGender | null;
  size?: string | null;
  color?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  brand?: string | null;
  style?: string | null;
  text?: string | null;
}

const GENDER_MEN_TOKENS = ['erkek', 'oğlan', 'oglan'] as const;
const GENDER_WOMEN_TOKENS = ['kadın', 'kadin', 'kız', 'kiz'] as const;

const titleHasToken = (title: string, token: string): boolean => {
  const haystack = title.toLocaleLowerCase('tr-TR');
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
  if (GENDER_MEN_TOKENS.some((token) => titleHasToken(title, token))) {
    return 'men';
  }
  if (GENDER_WOMEN_TOKENS.some((token) => titleHasToken(title, token))) {
    return 'women';
  }
  return 'unisex';
};

const normalizeSearch = (value: string): string =>
  value.trim().toLocaleLowerCase('tr-TR');

export const filterProducts = (
  products: Product[],
  filters: ProductFilters,
): Product[] => {
  const query = filters.query ? normalizeSearch(filters.query) : '';
  const category = filters.category ?? null;
  const gender = filters.gender ?? null;
  const size = filters.size?.trim() ?? null;

  return products.filter((product) => {
    if (query.length > 0) {
      const haystack = `${product.brand} ${product.title}`;
      if (!normalizeSearch(haystack).includes(query)) {
        return false;
      }
    }

    if (category !== null && product.category !== category) {
      return false;
    }

    if (gender !== null) {
      const productGender = product.gender ?? inferGenderFromTitle(product.title);
      if (productGender !== gender && productGender !== 'unisex') {
        return false;
      }
    }

    if (size !== null) {
      const sizes = product.sizes ?? [];
      if (!sizes.includes(size)) {
        return false;
      }
    }

    return true;
  });
};
