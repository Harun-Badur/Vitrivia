import { getSupabaseClient } from '../lib/supabase';
import { loadDiscoverRecommendationPacket } from '../services/discoverRecommendationCacheService';
import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { anchorContext, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { serializeFinal } from '../src/recommendationCache/codec';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import * as engine from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { getProductRepository } from '../services/productRepository';
import type { Product } from '../types/product';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
const top: Product = { id: 'top', title: 'Top', price: 100, brand: 'Brand', category: 'upper_body',
  outfitRole: 'top', imageUrl: 'top.jpg', garmentDescription: 'Top' };
const bottom: Product = { ...top, id: 'bottom', category: 'lower_body', outfitRole: 'bottom' };
const shoes: Product = { ...top, id: 'shoes', category: 'shoes', outfitRole: 'shoes' };
const bag: Product = { ...top, id: 'bag', category: 'bags', outfitRole: 'bag' };
const catalog = [top, bottom, shoes, bag];

function backend(rows: unknown[] = [], error: unknown = null) {
  const query = { select: jest.fn(), eq: jest.fn(), in: jest.fn(), abortSignal: jest.fn(),
    limit: jest.fn().mockResolvedValue({ data: rows, error }) };
  for (const method of [query.select, query.eq, query.in, query.abortSignal]) method.mockReturnValue(query);
  // A queued worker has no bearing on V1 display readiness.
  const client = { from: jest.fn(() => query), rpc: jest.fn().mockResolvedValue({ data: 'queued-job', error: null }),
    channel: jest.fn() };
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  return { query, client };
}
function session(owner: string | null = 'owner') {
  const canonical = getProductRepository().register(catalog.map(product => ({ ...product })));
  const cache = new DiscoverRecommendationCache(canonical, [], owner);
  return { cache, canonical, request: cache.request([canonical[0]], 1) };
}

function receive(cache: DiscoverRecommendationCache, anchors: Product[], packets: RecommendationFeedPacket[]) {
  return (packet: RecommendationFeedPacket) => {
    packets.push(packet);
    expect(cache.accept(packet, anchors)).toBe(true);
  };
}

describe('optional Discover cache with local engine fallback', () => {
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it.each([null, 'owner'])('publishes all 3 canonical complements on a cache miss for %s without waiting for a queued worker', async owner => {
    const { client } = backend();
    const { cache, canonical, request } = session(owner);
    const expected = engine.getDiscoverRecommendations(anchorContext(canonical, canonical[0], [], new Map()).input);
    expect(complementaryProductsForDisplay(expected, 'top')).toHaveLength(3);
    const packets: RecommendationFeedPacket[] = [];
    await loadDiscoverRecommendationPacket(request, owner, new AbortController().signal, receive(cache, [canonical[0]], packets));
    const recommendations = cache.lookup(canonical[0])!;
    expect(recommendations).toStrictEqual(expected);
    const products = complementaryProductsForDisplay(recommendations, 'top');
    expect(products.map(product => product.id)).toEqual(complementaryProductsForDisplay(expected, 'top').map(product => product.id));
    const resolved = await getProductRepository().productsById(products.map(product => product.id));
    expect(recommendations[0].displayProducts).toHaveLength(3);
    products.forEach(product => expect(product).toBe(resolved.get(product.id)));
    expect(packets).toHaveLength(1);
    expect(client.rpc).not.toHaveBeenCalled(); expect(client.channel).not.toHaveBeenCalled();
  });

  it('uses a ready cache hit without invoking the local engine', async () => {
    const { query } = backend();
    const { cache, canonical, request } = session();
    const context = anchorContext(canonical, canonical[0], [], new Map(), 'catalog-v1');
    const expected = engine.getDiscoverRecommendations(context.input);
    query.limit.mockResolvedValue({ data: [{ anchor_product_id: 'top', catalog_version: 'catalog-v1',
      payload: serializeFinal(expected, context) }], error: null });
    const local = jest.spyOn(engine, 'getDiscoverRecommendationsAsync');
    await loadDiscoverRecommendationPacket(request, 'owner', new AbortController().signal, receive(cache, [canonical[0]], []));
    expect(local).not.toHaveBeenCalled();
    expect(cache.lookup(canonical[0])).toStrictEqual(expected);
    expect(complementaryProductsForDisplay(cache.lookup(canonical[0])!, 'top')).toHaveLength(3);
  });

  it('continues past a missing first anchor and preserves sequential exposure for a later cache hit', async () => {
    const { query } = backend();
    const { cache, canonical } = session();
    const anchors = canonical.slice(0, 2), request = cache.request(anchors, 1);
    const firstContext = anchorContext(canonical, anchors[0], [], new Map());
    const first = engine.getDiscoverRecommendations(firstContext.input);
    const exposure = new Map(complementaryProductsForDisplay(first, 'top').map(product => [product.id, 1]));
    const secondContext = anchorContext(canonical, anchors[1], [], exposure);
    const second = engine.getDiscoverRecommendations(secondContext.input);
    query.limit.mockResolvedValue({ data: [{ anchor_product_id: 'bottom', catalog_version: '',
      payload: serializeFinal(second, secondContext) }], error: null });
    const local = jest.spyOn(engine, 'getDiscoverRecommendationsAsync');
    const packets: RecommendationFeedPacket[] = [];
    await loadDiscoverRecommendationPacket(request, 'owner', new AbortController().signal, receive(cache, anchors, packets));
    expect(local).toHaveBeenCalledTimes(1);
    expect(packets.map(packet => packet.entries[0].anchorProductId)).toEqual(['top', 'bottom']);
    expect(cache.lookup(anchors[0])).toStrictEqual(first);
    cache.activate(anchors[0]);
    expect(cache.lookup(anchors[1])).toStrictEqual(second);
  });

  it.each(['unavailable', 'error', 'invalid'])('falls back when the cache is %s', async failure => {
    backend(failure === 'invalid' ? [{ anchor_product_id: 'top', payload: 'invalid', catalog_version: '' }] : [],
      failure === 'error' ? { message: 'cache unavailable' } : null);
    if (failure === 'unavailable') jest.mocked(getSupabaseClient).mockReturnValue(null);
    const { cache, canonical, request } = session();
    await loadDiscoverRecommendationPacket(request, 'owner', new AbortController().signal, receive(cache, [canonical[0]], []));
    expect(complementaryProductsForDisplay(cache.lookup(canonical[0])!, 'top')).toHaveLength(3);
  });

  it('bounds a stalled cache read and uses the local engine', async () => {
    jest.useFakeTimers();
    const { query } = backend();
    query.limit.mockReturnValue(new Promise(() => {}));
    const { cache, canonical, request } = session();
    jest.spyOn(engine, 'getDiscoverRecommendationsAsync').mockImplementation(async input => engine.getDiscoverRecommendations(input));
    const completion = loadDiscoverRecommendationPacket(request, 'owner', new AbortController().signal, receive(cache, [canonical[0]], []));
    await jest.advanceTimersByTimeAsync(1_200);
    await completion;
    expect(query.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(complementaryProductsForDisplay(cache.lookup(canonical[0])!, 'top')).toHaveLength(3);
  });

  it('does not publish a local result after cancellation', async () => {
    backend();
    const { request } = session();
    const controller = new AbortController(), publish = jest.fn();
    jest.spyOn(engine, 'getDiscoverRecommendationsAsync').mockImplementation(async () => { controller.abort(); return []; });
    await loadDiscoverRecommendationPacket(request, 'owner', controller.signal, publish);
    expect(publish).not.toHaveBeenCalled();
  });
});
