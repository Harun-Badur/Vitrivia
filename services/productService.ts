import { DISCOVER_CATALOG_PAGE_SIZE, isRecord, isFeedProductRow, isAttributeRow, mapFeedRow } from './catalogProductAdapter';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import { getProductRepository, productsById } from './productRepository';
import { track } from '../lib/analytics';
import { hasAnyFilter, type FeedQueryFilters } from '../lib/feedQuery';
import { logger } from '../lib/logger';
import { fetchRecsConfig, fetchStyleProfileSnapshot } from '../lib/recsConfig';
import { setLastFeedMode, setLastRecommendationId } from '../lib/recsFeedState';
import { emptySessionIntent } from '../lib/scoring';
import { buildIntent } from '../lib/sessionIntent';
import { getSupabaseClient } from '../lib/supabase';
import { rankCatalog } from '../src/intelligence/ranking/rankCatalog';
import { runCooperatively } from '../src/intelligence/cooperativeWork';
import {
  ensureNonEmptyFeed,
  selectLocalFeed,
} from '../src/intelligence/recommendations/feedFallback';
import {
  enrichProduct,
  type ProductAttributeRow,
} from '../src/intelligence/style/productStyle';
import {
  isGarmentCategory,
  type Product,
} from '../types/product';
import type {
  FeedMode,
  RecsFeedResponse,
  SessionIntent,
} from '../types/recommendation';
import { DEFAULT_FEED_MODE } from '../types/recommendation';

export { filterProducts } from '../src/intelligence/filters/productFilters';
export type { ProductFilters } from '../src/intelligence/filters/productFilters';
export { toScoringCandidate } from '../src/intelligence/ranking/productCandidate';
export { inferGenderFromTitle } from '../src/intelligence/style/productStyle';
export type { ProductGender } from '../types/product';

export type FeedSource = 'supabase' | 'mock' | 'edge';

export interface FetchFeedProductsResult {
  hasMore?: boolean;
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
const CATALOG_PAGE_SIZE = DISCOVER_CATALOG_PAGE_SIZE;
const EDGE_TIMEOUT_MS = 1_200;
let edgeSupportsPagination: boolean | undefined;

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

interface FeedItemReference {
  productId: string;
  score: number;
  reasons: string[];
  position: number;
}
type FeedResponseReferences = Omit<RecsFeedResponse, 'items'> & { items: FeedItemReference[] };

const parseFeedItem = (value: unknown): FeedItemReference | null => {
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
  return {
    productId: value.product.id,
    score,
    reasons,
    position,
  };
};

const parseFeedResponse = (value: unknown): FeedResponseReferences | null => {
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
    .filter((item): item is FeedItemReference => item !== null);
  const relaxed = Array.isArray(value.relaxed)
    ? value.relaxed.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    recommendation_id: value.recommendation_id,
    score_id: value.score_id,
    config_version: value.config_version,
    items,
    has_more: typeof value.has_more === 'boolean' ? value.has_more : undefined,
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
  ensureNonEmptyFeed(products, MOCK_PRODUCTS);

const CATALOG_CACHE_MS = 60_000;
type CatalogQueryResult = { data: unknown[] | null; error: { message: string } | null };
const catalogPages = new Map<string, { at: number; result: Promise<CatalogQueryResult> }>();
const preparedCatalogProducts = new Map<string, { at: number; key: string; product: Product }>();
let catalogCacheClient: ReturnType<typeof getSupabaseClient>;

const queryCatalogPage = async (
  excludeIds: readonly string[] = [],
  offset = 0,
): Promise<{ products: Product[]; hasMore: boolean }> => {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase bağlantısı yok');
  }
  if (catalogCacheClient !== client) {
    catalogPages.clear();
    preparedCatalogProducts.clear();
    catalogCacheClient = client;
  }

  const productSelectWithImages =
    'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, images, product_url, category, affiliate_url, colors, sizes, created_at';
  const productSelectLegacy =
    'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, product_url, category, affiliate_url, colors, sizes, created_at';

  let productsResult: {
    data: unknown[] | null;
    error: { message: string } | null;
  } = await catalogQuery(productSelectWithImages);

  function catalogQuery(columns: string) {
    const serverExclusions = excludeIds.slice(0, CATALOG_PAGE_SIZE);
    const key = JSON.stringify([columns, [...serverExclusions].sort(), offset]);
    const cached = catalogPages.get(key);
    if (cached && Date.now() - cached.at < CATALOG_CACHE_MS) return cached.result;
    let query = client!.from('products').select(columns).order('created_at', { ascending: true }).order('id');
    if (excludeIds.length > 0) {
      // Bound the GET URL: a long session of UUIDs can exceed gateway URL limits.
      query = query.not('id', 'in', `(${excludeIds.slice(0, CATALOG_PAGE_SIZE).map(id => `"${id.replace(/["\\]/g, '')}"`).join(',')})`);
    }
    const entry = { at: Date.now(), result: Promise.resolve(query.range(offset, offset + CATALOG_PAGE_SIZE)) };
    catalogPages.set(key, entry);
    if (catalogPages.size > 12) catalogPages.delete(catalogPages.keys().next().value!);
    void entry.result.then(result => {
      if (result.error && catalogPages.get(key) === entry) catalogPages.delete(key);
    }, () => { if (catalogPages.get(key) === entry) catalogPages.delete(key); });
    return entry.result;
  }

  if (
    productsResult.error &&
    /column .*images.* does not exist/i.test(productsResult.error.message)
  ) {
    logger.warn('products.images yok; legacy select kullanılıyor');
    productsResult = await catalogQuery(productSelectLegacy);
  }

  if (productsResult.error) throw new Error(productsResult.error.message);
  const excluded = new Set(excludeIds);
  const rows = (productsResult.data ?? []).slice(0, CATALOG_PAGE_SIZE)
    .filter(row => !isRecord(row) || typeof row.id !== 'string' || !excluded.has(row.id));
  const validRows = rows.filter(isFeedProductRow);
  const cachedProducts = new Map<string, Product>();
  const ids: string[] = [];
  for (const row of validRows) {
    const cached = preparedCatalogProducts.get(row.id);
    if (cached && Date.now() - cached.at < CATALOG_CACHE_MS && cached.key === JSON.stringify(row)) {
      cachedProducts.set(row.id, cached.product);
    } else ids.push(row.id);
  }
  if (validRows.length === 0) return { products: [], hasMore: (productsResult.data?.length ?? 0) > CATALOG_PAGE_SIZE };

  let attributesResult: { data: unknown[] | null; error: { message: string } | null } = ids.length === 0
    ? { data: [], error: null } : await client
    .from('product_attributes')
    .select(
      'product_id, gender, colors, fit, subcategory, brand_slug, price_band, outfit_role',
    ).in('product_id', ids);

  if (
    attributesResult.error &&
    /column .*outfit_role.* does not exist/i.test(attributesResult.error.message)
  ) {
    attributesResult = await client
      .from('product_attributes')
      .select('product_id, gender, colors, fit, subcategory, brand_slug, price_band')
      .in('product_id', ids);
  }

  const attributesById = new Map<string, ProductAttributeRow>();
  for (const row of attributesResult.data ?? []) {
    if (isAttributeRow(row)) {
      attributesById.set(row.product_id, row);
    }
  }

  const repository = getProductRepository();
  function* prepareProducts(): Generator<void, Product[], void> {
    const products: Product[] = [];
    for (const row of validRows) {
      const cached = cachedProducts.get(row.id);
      if (cached) products.push(cached);
      else {
        const product = mapFeedRow(row);
        if (product) {
          const enriched = repository.register([enrichProduct(product, attributesById.get(product.id))])[0];
          products.push(enriched);
          if (!attributesResult.error) {
            preparedCatalogProducts.set(row.id, { at: Date.now(), key: JSON.stringify(row), product: enriched });
            if (preparedCatalogProducts.size > 400) preparedCatalogProducts.delete(preparedCatalogProducts.keys().next().value!);
          }
        }
      }
      yield;
    }
    return products;
  }
  const prepared = await runCooperatively(prepareProducts());
  const resolved = await repository.productsById(prepared.map(product => product.id));
  const products = prepared.map(product => resolved.get(product.id)!);
  return { products, hasMore: (productsResult.data?.length ?? 0) > CATALOG_PAGE_SIZE };
};

let initialCatalogRequest: Promise<{ products: Product[]; hasMore: boolean }> | null = null;
const fetchCatalogPage = (excludeIds: readonly string[] = [], offset = 0) => {
  if (excludeIds.length > 0 || offset > 0) return queryCatalogPage(excludeIds, offset);
  if (!initialCatalogRequest) {
    initialCatalogRequest = queryCatalogPage().finally(() => { initialCatalogRequest = null; });
  }
  return initialCatalogRequest;
};

// Keep the existing bounded recommendation pool; reuse it on focus without re-ranking.
let recommendationPool: { products: Product[]; at: number } | null = null;
let recommendationRequest: Promise<Product[]> | null = null;
export const fetchRecommendationCatalog = (): Promise<Product[]> => {
  if (recommendationPool && Date.now() - recommendationPool.at < 60_000) {
    return Promise.resolve(recommendationPool.products);
  }
  if (!recommendationRequest) {
    recommendationRequest = fetchCatalogPage().then(({ products }) => {
      recommendationPool = { products, at: Date.now() };
      return products;
    }).finally(() => { recommendationRequest = null; });
  }
  return recommendationRequest;
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
  return neverEmpty(
    rankCatalog(catalog, userId, intent, limit, mode, config, profile),
  );
};

const fetchEdgeFeed = async (
  userId: string,
  intent: SessionIntent,
  limit: number,
  mode: FeedMode,
  filters: FeedQueryFilters = {},
  excludeIds: readonly string[] = [],
): Promise<RecsFeedResponse | null> => {
  const url = getRecsFeedUrl();
  const client = getSupabaseClient();
  if (!url || !client || (edgeSupportsPagination === false && excludeIds.length > 0)) {
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
        exclude_ids: excludeIds,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.debug('recs-feed HTTP hata', { status: response.status });
      return null;
    }
    const parsed = parseFeedResponse(await response.json());
    if (!parsed) return null;
    edgeSupportsPagination = typeof parsed.has_more === 'boolean';
    // Preserve the first legacy ranking, but never reuse a finite legacy response as a next page.
    if (!edgeSupportsPagination && (excludeIds.length > 0 || parsed.items.length === 0)) return null;
    const resolved = await productsById(parsed.items.map(item => item.productId));
    // A missing catalog record follows the existing unavailable-edge fallback.
    if (parsed.items.some(item => !resolved.has(item.productId))) return null;
    return { ...parsed, items: parsed.items.map(({ productId, ...metadata }) => {
      const product = resolved.get(productId)!;
      product.reason = metadata.reasons[0]?.trim() || undefined;
      return { ...metadata, product };
    }) };
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
  excludeIds: readonly string[] = [],
): Promise<FetchFeedProductsResult> => {
  const startedAt = Date.now();
  const intent = userId ? buildIntent() : emptySessionIntent();
  if (filters.category && !intent.constraints.category) {
    intent.constraints.category = filters.category;
  }
  setLastRecommendationId(null);
  setLastFeedMode(telemetryMode ?? mode);

  if (userId) {
    const edge = await fetchEdgeFeed(userId, intent, limit, mode, filters, excludeIds);
    const excluded = new Set(excludeIds);
    // An empty/non-progressing batch with hasMore cannot be advanced using ID exclusions.
    if (edge && (edge.has_more === false || edge.items.some(item => !excluded.has(item.product.id)))) {
      setLastRecommendationId(edge.recommendation_id);
      logger.debug('recs-feed timing', {
        ms: Date.now() - startedAt,
        source: 'edge',
        n: edge.items.length,
        fallback: edge.fallback === true,
      });
      const edgeProducts = edge.items.map((item) => item.product).filter(product => {
        if (excluded.has(product.id)) return false;
        excluded.add(product.id);
        return true;
      });
      return {
        hasMore: edge.has_more ?? true,
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

  let offset = 0;
  let page = await fetchCatalogPage(excludeIds, offset);
  const poolRows = [...page.products];
  while (poolRows.length < CATALOG_PAGE_SIZE && page.hasMore) {
    offset += CATALOG_PAGE_SIZE;
    page = await fetchCatalogPage(excludeIds, offset);
    poolRows.push(...page.products);
  }
  // Keep the original bounded ranking workload; later products remain available for future batches.
  const catalog = [...new Map(poolRows.map(product => [product.id, product])).values()].slice(0, CATALOG_PAGE_SIZE);
  const poolHasMore = page.hasMore || poolRows.length > catalog.length;
  if (catalog.length === 0) return { products: [], hasMore: false, source: 'supabase', isPersonalized: false };

  if (!userId) {
    const selected = selectLocalFeed(catalog, filters, limit);
    return {
      products: selected.products,
      hasMore: poolHasMore || catalog.length > selected.products.length,
      source: 'supabase',
      isPersonalized: false,
      fallback: selected.fallback,
      relaxed: selected.relaxed,
    };
  }

  try {
    const ranked = await rankLocally(catalog, userId, intent, limit * 3, mode);
    const selected = selectLocalFeed(ranked, filters, limit);
    logger.debug('recs-feed timing', {
      ms: Date.now() - startedAt,
      source: 'supabase',
      n: selected.selectedCount,
      fallback: selected.fallback,
      relaxed: selected.relaxed,
    });
    return {
      products: selected.products,
      hasMore: poolHasMore || catalog.length > selected.products.length,
      source: 'supabase',
      isPersonalized: true,
      fallback: selected.fallback,
      relaxed: selected.relaxed,
    };
  } catch (error) {
    logger.debug('Yerel skorlama düştü; katalog sırası kullanılıyor', { error });
    track('feed_fallback', null, { reason: 'local_rank_failed' });
    const selected = selectLocalFeed(catalog, filters, limit);
    return {
      products: selected.products,
      hasMore: poolHasMore || catalog.length > selected.products.length,
      source: 'supabase',
      isPersonalized: false,
      fallback: selected.fallback,
      relaxed: selected.relaxed,
    };
  }
};
