import { MOCK_PRODUCTS } from '../data/mockProducts';
import { fetchFeedProducts, fetchRecommendationCatalog, getRecsFeedUrl } from '../services/productService';
import { useAppStore } from '../store/useAppStore';
import { getSupabaseClient } from '../lib/supabase';
import { emptySessionIntent } from '../lib/scoring';
import { buildIntent } from '../lib/sessionIntent';
import { productsById } from '../services/productRepository';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn(), setLastRecommendationId: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ buildIntent: jest.fn(), recordSessionProductAction: jest.fn(), resetSessionIntent: jest.fn() }));
jest.mock('../services/likeService', () => ({ insertPassedProduct: jest.fn(), insertLikedProduct: jest.fn() }));
jest.mock('../lib/recsConfig', () => {
  const scoring = jest.requireActual<typeof import('../lib/scoring')>('../lib/scoring');
  return { fetchRecsConfig: jest.fn(async () => scoring.DEFAULT_RECS_CONFIG),
    fetchStyleProfileSnapshot: jest.fn(async (userId: string) => scoring.emptyStyleProfile(userId)) };
});
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

// Test-only backend fixture; never inserted into the application's catalog.
const rows = Array.from({ length: 278 }, (_, index) => ({
  id: `product-${String(index).padStart(3, '0')}`,
  provider: 'defacto', external_id: String(index), title: `Ürün ${index}`,
  brand: 'DeFacto', price: 100, currency: 'TRY',
  image_url: MOCK_PRODUCTS[0].imageUrl, images: [MOCK_PRODUCTS[0].imageUrl],
  product_url: 'https://example.com/product', affiliate_url: null,
  category: 'upper_body', created_at: '2026-01-01',
}));

let mockFailQuery = false;
const mockRanges: [number, number][] = [];
const mockAttributeIds: string[][] = [];
const mockBackend = {
  auth: { getSession: jest.fn(async () => ({ data: { session: null as { access_token: string } | null }, error: null })) },
  from: (table: string) => {
    let excluded = new Set<string>();
    const query = {
      select: () => query,
      order: () => query,
      not: (_column: string, _operator: string, value: string) => {
        excluded = new Set(value.match(/product-\d+/g) ?? []);
        return query;
      },
      in: (_column: string, ids: string[]) => {
        mockAttributeIds.push(ids);
        return Promise.resolve({ data: [], error: null });
      },
      range: (start: number, end: number) => {
        expect(table).toBe('products');
        mockRanges.push([start, end]);
        return Promise.resolve(mockFailQuery
          ? { data: null, error: { message: 'network failure' } }
          : { data: rows.filter(row => !excluded.has(row.id)).slice(start, end + 1), error: null });
      },
    };
    return query;
  },
};

describe('Discover pagination using the existing service and store', () => {
  beforeEach(() => {
    mockFailQuery = false;
    mockRanges.length = 0;
    mockAttributeIds.length = 0;
    mockBackend.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    jest.mocked(buildIntent).mockImplementation(emptySessionIntent);
    jest.mocked(getSupabaseClient).mockReturnValue({ ...mockBackend } as never);
    useAppStore.setState({ currentProducts: [], likedProducts: [], passedProductIds: [],
      passedStack: [], sessionUserId: null, feedStatus: 'idle', hasMore: true,
      isFetchingNext: false, feedMode: 'personal' });
  });
  afterEach(() => jest.restoreAllMocks());

  it('continues 20 → 20 → remaining batches until all 278 IDs are reachable exactly once', async () => {
    await useAppStore.getState().loadFeed(null);
    const delivered: string[] = [];
    const sizes: number[] = [];
    for (let batch = 0; batch < 15; batch++) {
      const products = useAppStore.getState().currentProducts;
      sizes.push(products.length);
      delivered.push(...products.map(product => product.id));
      expect(products.length).toBeLessThanOrEqual(20);
      products.forEach(product => useAppStore.getState().swipeLeft(product));
      if (!useAppStore.getState().hasMore) break;
      await useAppStore.getState().loadMoreFeed();
    }
    expect(sizes).toEqual([...Array<number>(13).fill(20), 18]);
    expect(delivered).toEqual(rows.map(row => row.id));
    expect(new Set(delivered).size).toBe(278);
    expect(useAppStore.getState().hasMore).toBe(false);
    expect(mockRanges.every(([start, end]) => end - start + 1 <= 81)).toBe(true);
    expect(mockAttributeIds.every(ids => ids.length <= 80)).toBe(true);
  });

  it('excludes prior likes and passes before choosing a full first batch', async () => {
    const previous = await fetchFeedProducts(20, null);
    useAppStore.setState({
      likedProducts: [{ product: previous.products[0], likedAt: '2026-01-01', notifyOnPriceDrop: false }],
      passedProductIds: previous.products.slice(1, 10).map(product => product.id),
    });
    await useAppStore.getState().loadFeed(null);
    expect(useAppStore.getState().currentProducts.map(product => product.id)).toEqual(rows.slice(10, 30).map(row => row.id));
  });

  it('shares the initial catalog request between feed and recommendation preparation', async () => {
    const [feed, catalog] = await Promise.all([fetchFeedProducts(20, null), fetchRecommendationCatalog()]);
    expect(feed.products).toHaveLength(20);
    expect(catalog).toHaveLength(80);
    expect(mockRanges).toHaveLength(1);
    const resolved = await productsById(feed.products.map(product => product.id));
    for (const product of feed.products) {
      expect(product).toBe(catalog.find(candidate => candidate.id === product.id));
      expect(product).toBe(resolved.get(product.id));
    }
  });

  it('also reaches all 278 products through the existing personalized fallback ranking', async () => {
    const delivered = new Set<string>();
    let hasMore = true;
    for (let batch = 0; batch < 15 && hasMore; batch++) {
      const result = await fetchFeedProducts(20, 'user-1', 'personal', {}, undefined, [...delivered]);
      expect(result.products.length).toBeGreaterThan(0);
      result.products.forEach(product => {
        expect(delivered.has(product.id)).toBe(false);
        delivered.add(product.id);
      });
      hasMore = result.hasMore === true;
    }
    expect(delivered.size).toBe(278);
    expect(hasMore).toBe(false);
  });

  it('appends without replacing the visible card and ignores concurrent continuation calls', async () => {
    await useAppStore.getState().loadFeed(null);
    const first = useAppStore.getState().currentProducts[0];
    await Promise.all([useAppStore.getState().loadMoreFeed(), useAppStore.getState().loadMoreFeed()]);
    expect(useAppStore.getState().currentProducts).toHaveLength(40);
    expect(useAppStore.getState().currentProducts[0]).toBe(first);
    expect(mockRanges).toHaveLength(2);
  });

  it('reuses catalog pages and attributes while still applying the full changing exclusion history', async () => {
    const first = await fetchFeedProducts(20, null, 'personal', {}, undefined, rows.slice(0, 100).map(row => row.id));
    const ranges = mockRanges.length;
    const attributes = mockAttributeIds.length;
    const second = await fetchFeedProducts(20, null, 'personal', {}, undefined, rows.slice(0, 120).map(row => row.id));
    expect(first.products.map(product => product.id)).toEqual(rows.slice(100, 120).map(row => row.id));
    expect(second.products.map(product => product.id)).toEqual(rows.slice(120, 140).map(row => row.id));
    expect(mockRanges).toHaveLength(ranges);
    expect(mockAttributeIds).toHaveLength(attributes);
  });

  it('keeps the current queue and hasMore on a continuation query failure', async () => {
    await useAppStore.getState().loadFeed(null);
    const queue = useAppStore.getState().currentProducts;
    mockFailQuery = true;
    jest.mocked(getSupabaseClient).mockReturnValue({ ...mockBackend } as never);
    await useAppStore.getState().loadMoreFeed();
    expect(useAppStore.getState().currentProducts).toBe(queue);
    expect(useAppStore.getState()).toMatchObject({ hasMore: true, isFetchingNext: false, feedStatus: 'error' });
  });

  it('passes exclusions to the Edge Function and accepts an explicit empty final page', async () => {
    const products = (await fetchFeedProducts(20, null)).products;
    jest.replaceProperty(process, 'env', { ...process.env, EXPO_PUBLIC_RECS_FEED_URL: 'https://example.com/recs-feed' });
    expect(getRecsFeedUrl()).not.toBeNull();
    mockBackend.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      recommendation_id: 'test-rec', score_id: 'test-score', config_version: 'v1',
      items: products.slice(1).map(product => ({ product, score: 1, reasons: [], position: 1 })), has_more: true,
    }) } as Response);
    const result = await fetchFeedProducts(20, 'user-1', 'personal', {}, undefined, [products[0].id]);
    expect(result.products).toEqual(products.slice(1));
    result.products.forEach(product => expect(product).toBe(products.find(candidate => candidate.id === product.id)));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).exclude_ids).toEqual([products[0].id]);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      recommendation_id: 'test-rec', score_id: 'test-score', config_version: 'v1', items: [], has_more: false,
    }) } as Response);
    expect(await fetchFeedProducts(20, 'user-1', 'personal', {}, undefined, products.map(product => product.id)))
      .toMatchObject({ products: [], hasMore: false, source: 'edge' });
  });

  it('preserves a legacy Edge first batch, then uses paginated fallback instead of repeating it', async () => {
    const products = (await fetchFeedProducts(20, null)).products;
    jest.replaceProperty(process, 'env', { ...process.env, EXPO_PUBLIC_RECS_FEED_URL: 'https://example.com/recs-feed' });
    mockBackend.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      recommendation_id: 'test-rec', score_id: 'test-score', config_version: 'v1',
      items: [...products].reverse().map(product => ({ product, score: 1, reasons: [], position: 1 })),
    }) } as Response);
    const first = await fetchFeedProducts(20, 'user-1');
    expect(first.products.map(product => product.id)).toEqual([...products].reverse().map(product => product.id));
    const second = await fetchFeedProducts(20, 'user-1', 'personal', {}, undefined, first.products.map(product => product.id));
    expect(second.source).toBe('supabase');
    expect(second.products).toHaveLength(20);
    expect(second.products.some(product => first.products.some(previous => previous.id === product.id))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses canonical catalog fields instead of stale Edge product snapshots', async () => {
    const canonical = (await fetchFeedProducts(20, null)).products[0];
    jest.replaceProperty(process, 'env', { ...process.env, EXPO_PUBLIC_RECS_FEED_URL: 'https://example.com/recs-feed' });
    mockBackend.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null });
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      recommendation_id: 'test-rec', score_id: 'test-score', config_version: 'v1', has_more: false,
      items: [{ product: { ...canonical, price: 999, brand: 'Stale', imageUrl: 'stale.jpg' },
        score: 1, reasons: ['Reason'], position: 1 }],
    }) } as Response);
    const result = await fetchFeedProducts(20, 'user-1');
    expect(result.source).toBe('edge');
    expect(result.products[0]).toBe(canonical);
    expect(canonical).toMatchObject({ price: 100, brand: 'DeFacto', imageUrl: MOCK_PRODUCTS[0].imageUrl, reason: 'Reason' });
  });
});
