import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { loadDiscoverRecommendationPacket } from '../services/discoverRecommendationCacheService';
import { getProductRepository } from '../services/productRepository';
import * as engine from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { getSupabaseClient } from '../lib/supabase';
import { anchorContext, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { serializeFinal } from '../src/recommendationCache/codec';
import type { Product } from '../types/product';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn(() => null) }));

const top: Product = { id: 'prefetch-top', title: 'Top', price: 100, brand: 'Brand', category: 'upper_body',
  outfitRole: 'top', imageUrl: 'top.jpg', garmentDescription: 'Top' };
const catalog: Product[] = [top,
  { ...top, id: 'prefetch-bottom', category: 'lower_body', outfitRole: 'bottom' },
  { ...top, id: 'prefetch-shoes', category: 'shoes', outfitRole: 'shoes' },
  { ...top, id: 'prefetch-bag', category: 'bags', outfitRole: 'bag' }];

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Preparation did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function start() {
  const products = getProductRepository().register(catalog.map(product => ({ ...product })));
  const session = new DiscoverRecommendationCache(products, [], null);
  session.setPreparationWindow(products);
  const controller = new AbortController();
  const packets: RecommendationFeedPacket[] = [];
  const request = session.request(products, 1);
  const done = loadDiscoverRecommendationPacket(request, null, controller.signal, packet => {
    packets.push(packet);
    expect(session.accept(packet, products)).toBe(true);
    for (const entry of packet.entries) {
      const anchor = products.find(product => product.id === entry.anchorProductId)!;
      expect(session.peekPrepared(anchor)).toEqual(engine.getDiscoverRecommendations(
        anchorContext(products, anchor, [], new Map(entry.exposure)).input));
    }
    session.activate(session.preparationWindow[0]);
  }, session);
  return { products, session, controller, packets, done };
}

afterEach(() => { jest.restoreAllMocks(); jest.mocked(getSupabaseClient).mockReturnValue(null); });

it('admits appended anchors while preserving the pending preparation and unchanged engine results', async () => {
  const products = getProductRepository().register(catalog.map(product => ({ ...product })));
  const session = new DiscoverRecommendationCache(products, [], null);
  session.setPreparationWindow(products.slice(0, 2));
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const original = engine.prepareDiscoverRankingAsync;
  let pendingSignal: AbortSignal | undefined;
  const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync').mockImplementation(async (input, options) => {
    if (input.requiredCatalogProductId === products[0].id) {
      pendingSignal = options?.signal;
      await blocked;
    }
    return original(input, options);
  });
  const controller = new AbortController();
  const done = loadDiscoverRecommendationPacket(session.request(products.slice(0, 2), 1), null,
    controller.signal, packet => {
      expect(session.accept(packet, products)).toBe(true);
      for (const entry of packet.entries) {
        const anchor = products.find(product => product.id === entry.anchorProductId)!;
        expect(session.peekPrepared(anchor)).toEqual(engine.getDiscoverRecommendations(
          anchorContext(products, anchor, [], new Map(entry.exposure)).input));
      }
      session.activate(products[0]);
    }, session);
  try {
    await until(() => pendingSignal !== undefined);
    session.setPreparationWindow(products);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(pendingSignal?.aborted).toBe(false);
    expect(prepare.mock.calls.filter(([input]) => input.requiredCatalogProductId === products[0].id)).toHaveLength(1);
    release();
    await until(() => session.peekPrepared(products[2]) !== undefined);
    expect(prepare.mock.calls.map(([input]) => input.requiredCatalogProductId)).toEqual(products.slice(0, 3).map(p => p.id));
  } finally { release(); controller.abort(); await done; }
});

it('aborts pending ranking on focus loss without publishing the late result', async () => {
  const original = engine.prepareDiscoverRankingAsync;
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let signal: AbortSignal | undefined;
  jest.spyOn(engine, 'prepareDiscoverRankingAsync').mockImplementation(async (input, options) => {
    signal = options?.signal;
    await blocked;
    return original(input, options);
  });
  const state = start();
  try {
    await until(() => signal !== undefined);
    state.controller.abort();
    expect(signal?.aborted).toBe(true);
    release();
    await state.done;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(state.packets).toHaveLength(0);
  } finally { release(); state.controller.abort(); await state.done; }
});

it('prepares only active/next/next+1 in order and reuses ranking/finals across promotion and undo', async () => {
  const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
  const complete = jest.spyOn(engine, 'completeDiscoverRecommendationsAsync');
  const state = start();
  try {
    await until(() => state.products.slice(0, 3).every(product => state.session.peekPrepared(product) !== undefined));
    expect(prepare.mock.calls.map(([input]) => input.requiredCatalogProductId)).toEqual(state.products.slice(0, 3).map(p => p.id));
    expect(state.session.peekPrepared(state.products[3])).toBeUndefined();
    const preparedNext = state.session.peekPrepared(state.products[1]);
    state.session.setPreparationWindow(state.products.slice(1));
    expect(state.session.lookup(state.products[1])).toBe(preparedNext);
    state.session.activate(state.products[1]);
    await until(() => state.session.peekPrepared(state.products[3]) !== undefined);
    state.session.setPreparationWindow(state.products);
    state.session.activate(state.products[0]);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(prepare).toHaveBeenCalledTimes(4);
    const selections = complete.mock.calls.length;
    state.session.setPreparationWindow(state.products);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(complete).toHaveBeenCalledTimes(selections);
    expect(state.session.lookup(state.products[0])).toBeDefined();
  } finally { state.controller.abort(); await state.done; }
});

it('starts next ranking while active product resolution is still pending and exposes next images early', async () => {
  const repository = getProductRepository();
  const original = repository.productsById.bind(repository);
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  jest.spyOn(repository, 'productsById').mockImplementationOnce(async ids => { await blocked; return original(ids); });
  const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
  const state = start();
  try {
    await until(() => state.session.peekPrepared(state.products[1]) !== undefined);
    expect(prepare.mock.calls.map(([input]) => input.requiredCatalogProductId)).toContain(state.products[1].id);
    expect(state.session.peekPrepared(state.products[0])).toBeUndefined();
    // Future exposure intentionally prevents display; image warming can use the prepared packet.
    expect(state.session.lookup(state.products[1])).toBeUndefined();
    release();
    await until(() => state.session.lookup(state.products[0]) !== undefined);
  } finally { release(); state.controller.abort(); await state.done; }
});

it('refreshes final selection after a skipped anchor without discarding prepared ranking', async () => {
  const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
  const complete = jest.spyOn(engine, 'completeDiscoverRecommendationsAsync');
  const state = start();
  try {
    await until(() => state.products.slice(0, 3).every(product => state.session.peekPrepared(product) !== undefined));
    const before = complete.mock.calls.length;
    state.session.setPreparationWindow([state.products[2], state.products[1], state.products[0]]);
    await until(() => state.session.lookup(state.products[2]) !== undefined);
    await until(() => complete.mock.calls.length > before);
    expect(prepare).toHaveBeenCalledTimes(3);
  } finally { state.controller.abort(); await state.done; }
});

it('does not publish pending packets after focus cancellation', async () => {
  const repository = getProductRepository();
  const original = repository.productsById.bind(repository);
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  jest.spyOn(repository, 'productsById').mockImplementation(async ids => { await blocked; return original(ids); });
  const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
  const state = start();
  await until(() => prepare.mock.calls.length >= 2);
  state.controller.abort();
  await state.done;
  release();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(state.packets).toHaveLength(0);
});

it('reuses a backend final hit without ranking or selection work', async () => {
  const context = anchorContext(catalog, top, [], new Map());
  const result = engine.getDiscoverRecommendations(context.input);
  const query = { select: jest.fn(), eq: jest.fn(), in: jest.fn(), abortSignal: jest.fn(),
    limit: jest.fn().mockResolvedValue({ data: [{ anchor_product_id: top.id, catalog_version: null,
      payload: serializeFinal(result, context) }], error: null }) };
  for (const method of [query.select, query.eq, query.in, query.abortSignal]) method.mockReturnValue(query);
  jest.mocked(getSupabaseClient).mockReturnValue({ from: () => query } as never);
  const products = getProductRepository().register(catalog.map(product => ({ ...product })));
  const session = new DiscoverRecommendationCache(products, [], null);
  session.setPreparationWindow([products[0]]);
  const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
  const complete = jest.spyOn(engine, 'completeDiscoverRecommendationsAsync');
  const controller = new AbortController();
  const done = loadDiscoverRecommendationPacket(session.request(products, 1), null, controller.signal,
    packet => { session.accept(packet, products); }, session);
  try {
    await until(() => session.lookup(products[0]) !== undefined);
    expect(prepare).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  } finally { controller.abort(); await done; }
});

it('promotes next immediately, pauses the original ranking promise, and resumes it on undo without a duplicate', async () => {
  const original = engine.prepareDiscoverRankingAsync;
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let firstSignal: AbortSignal | undefined;
  const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync').mockImplementation(async (input, options) => {
    if (input.requiredCatalogProductId === top.id) {
      firstSignal = options?.signal;
      await blocked;
    }
    return original(input, options);
  });
  const state = start();
  try {
    await until(() => firstSignal !== undefined);
    state.session.setPreparationWindow(state.products.slice(1));
    await until(() => state.session.lookup(state.products[1]) !== undefined);
    expect(firstSignal?.aborted).toBe(false);
    state.session.setPreparationWindow(state.products);
    release();
    await until(() => state.session.lookup(state.products[0]) !== undefined);
    expect(prepare.mock.calls.filter(([input]) => input.requiredCatalogProductId === top.id)).toHaveLength(1);
    expect(prepare.mock.calls.every(([, options]) => options?.budgetMs === undefined && options?.sliceBudgetMs === undefined)).toBe(true);
  } finally { release(); state.controller.abort(); await state.done; }
});

it('blocks an old generation publication and preserves completed ranking when the feed request is replaced', async () => {
  const repository = getProductRepository();
  const original = repository.productsById.bind(repository);
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  jest.spyOn(repository, 'productsById').mockImplementationOnce(async ids => { await blocked; return original(ids); });
  const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
  const state = start();
  const replacementController = new AbortController();
  let replacement: Promise<void> | undefined;
  try {
    await until(() => state.session.peekPrepared(state.products[1]) !== undefined);
    const previousPackets = state.packets.length;
    const request = state.session.request(state.products, 2);
    replacement = loadDiscoverRecommendationPacket(request, null, replacementController.signal, packet => {
      expect(packet.generation).toBe(2);
      expect(state.session.accept(packet, state.products)).toBe(true);
      state.session.activate(state.products[0]);
    }, state.session);
    release();
    await until(() => state.session.lookup(state.products[0]) !== undefined);
    expect(state.packets).toHaveLength(previousPackets);
    expect(prepare.mock.calls.filter(([input]) => input.requiredCatalogProductId === top.id)).toHaveLength(1);
  } finally { release(); state.controller.abort(); replacementController.abort(); await state.done; await replacement; }
});
