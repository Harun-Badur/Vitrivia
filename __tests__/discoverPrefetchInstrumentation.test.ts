import { DiscoverPrefetchInstrumentation, instrumentationContextId } from '../lib/discoverPrefetchInstrumentation';
import type { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import type { Product } from '../types/product';

const products = ['active', 'next', 'warm'].map(id => ({ id } as Product));
function setup() {
  let now = 0;
  let ready = false;
  const emit = jest.fn();
  const trace = new DiscoverPrefetchInstrumentation(() => now, emit);
  const session = { sessionId: 'test', contextFingerprint: 'test-context', preparationWindow: products,
    lookup: () => ready ? [] : undefined, peekPrepared: () => ready ? [] : undefined };
  trace.window(products);
  return { trace, emit, session: session as unknown as DiscoverRecommendationCache,
    time: (value: number) => { now = value; }, ready: () => { ready = true; },
    window: (value: Product[]) => { session.preparationWindow = value; trace.window(value); },
    context: (value: string) => { session.contextFingerprint = value; },
    promote: () => { session.preparationWindow = products.slice(1); trace.window(session.preparationWindow); } };
}
it('logs a prepared empty result exactly once with both upcoming positions and the requested label convention', () => {
  const state = setup();
  state.time(10); state.trace.stage(products[1], 'packetAcceptedAt'); state.ready();
  state.time(20); state.trace.swipe(state.session, products[1]);
  expect(state.emit).not.toHaveBeenCalled();
  state.promote(); state.trace.settle(state.session); state.trace.settle(state.session);
  expect(state.emit).toHaveBeenCalledTimes(1);
  expect(state.emit.mock.calls[0][0]).toMatchObject({ productId: 'next', readyAtSwipe: true,
    activeAt: 20, swipeAt: 20, recommendationReadyAt: 10, status: 'NOT_READY', waitMs: 0,
    cacheAtSwipe: 'hit', next: { productId: 'next' }, nextPlusOne: { productId: 'warm' } });
});
it('measures the actual wait on a miss without emitting stage logs', () => {
  const state = setup(); state.time(20); state.trace.swipe(state.session, products[1]); state.promote();
  state.time(35); state.trace.stage(products[1], 'preparationStartedAt', 'ranking_miss');
  state.time(50); state.trace.stage(products[1], 'rankingReadyAt');
  state.time(60); state.trace.stage(products[1], 'finalReadyAt');
  state.time(70); state.ready(); state.trace.stage(products[1], 'packetAcceptedAt'); state.trace.settle(state.session);
  expect(state.emit).toHaveBeenCalledTimes(1);
  expect(state.emit.mock.calls[0][0]).toMatchObject({ readyAtSwipe: false, status: 'READY', waitMs: 50,
    rankingReadyAt: 50, finalReadyAt: 60, cacheAtSwipe: 'miss' });
});
it('reports an unresolved swipe once on cancellation rather than inventing a ready time', () => {
  const state = setup(); state.trace.swipe(state.session, products[1]);
  state.trace.close('test'); state.trace.close('test');
  expect(state.emit).toHaveBeenCalledTimes(1);
  expect(state.emit.mock.calls[0][0]).toMatchObject({ status: 'UNRESOLVED', waitMs: null });
});

const records = (emit: jest.Mock, type: string) => emit.mock.calls.map(([record]) => record)
  .filter(record => record.type === type);

it('records all 20 swipe callbacks and closes all off-screen completions exactly once', () => {
  const state = setup();
  for (let index = 0; index < 20; index++) state.trace.recordSwipe(state.session, products[0], products[1]);
  expect(records(state.emit, 'discover_prefetch_swipe')).toHaveLength(20);
  state.window([products[2]]);
  state.time(100); state.trace.stage(products[1], 'packetAcceptedAt');
  state.trace.published(state.session, products[1]);
  state.trace.published(state.session, products[1]);
  const results = records(state.emit, 'discover_prefetch_swipe_result');
  expect(results).toHaveLength(20);
  expect(new Set(results.map(record => record.swipeId)).size).toBe(20);
  expect(results.every(record => record.status === 'COMPLETED' && record.waitMs === 100)).toBe(true);
});

it('counts an append without aborting or restarting its continuing preparation', () => {
  const state = setup(); state.trace.bind(state.session, 1);
  state.trace.feedUpdate(products.slice(0, 2), 1);
  const attempt = state.trace.start(products[1], 1);
  state.trace.feedUpdate(products, 2); state.trace.feedUpdate(products, 2);
  const append = records(state.emit, 'discover_prefetch_feed_append').find(record => record.event === 'CONTINUE');
  expect(append).toMatchObject({ anchorId: 'next', event: 'CONTINUE', reason: 'pending_at_append' });
  expect(attempt).toBe(1);
  expect(state.trace.counters).toMatchObject({ feedAppendCount: 1, preparationStartCount: 1,
    abortCount: 0, restartCount: 0 });
  state.trace.finish(products[1], attempt, 'ranking_preparation_completed');
  expect(state.trace.counters.preparationCompleteCount).toBe(1);
});

it('counts abort, restart and simultaneous duplicate preparation independently', () => {
  const state = setup();
  const first = state.trace.start(products[1], 1);
  state.trace.abort(products[1], first, 'context_changed');
  state.trace.abort(products[1], first, 'context_changed');
  const second = state.trace.start(products[1], 2);
  const duplicate = state.trace.start(products[1], 2);
  state.trace.finish(products[1], second, 'completed');
  state.trace.finish(products[1], duplicate, 'completed');
  expect(state.trace.counters).toMatchObject({ preparationStartCount: 3, preparationCompleteCount: 2,
    cancellationCount: 1, abortCount: 1, restartCount: 1, duplicatePreparationCount: 1 });
});

it('closes a pending swipe on cancellation and labels focus cleanup explicitly', () => {
  const state = setup(); state.trace.bind(state.session, 1);
  state.trace.start(products[1], 1);
  state.trace.recordSwipe(state.session, products[0], products[1]);
  state.trace.close('test', 'focus_lost'); state.trace.close('test', 'focus_lost');
  expect(records(state.emit, 'discover_prefetch_swipe_result')).toHaveLength(1);
  expect(records(state.emit, 'discover_prefetch_swipe_result')[0]).toMatchObject({ status: 'CANCELLED', reason: 'focus_lost' });
  expect(state.trace.counters.abortCount).toBe(1);
});

it('records a rejected stale publication with its revision without claiming completion', () => {
  const state = setup(); state.trace.bind(state.session, 2);
  state.trace.recordSwipe(state.session, products[0], products[1]);
  state.trace.event(products[1], 'cancelled', 'stale_revision_publication', 1);
  expect(records(state.emit, 'discover_prefetch_lifecycle')[0]).toMatchObject({
    anchorId: 'next', revision: 1, role: 'next', reason: 'stale_revision_publication' });
  expect(records(state.emit, 'discover_prefetch_swipe_result')).toHaveLength(0);
  state.trace.close('test', 'context_changed');
  expect(records(state.emit, 'discover_prefetch_swipe_result')[0]).toMatchObject({ status: 'CANCELLED', reason: 'context_changed' });
});

it('still records stale source references and the no-next case', () => {
  const state = setup();
  state.trace.recordSwipe(state.session, { ...products[0] }, products[1]);
  state.trace.recordSwipe(state.session, products[2]);
  expect(records(state.emit, 'discover_prefetch_swipe')).toHaveLength(2);
  expect(records(state.emit, 'discover_prefetch_swipe')[1]).toMatchObject({ anchorId: null, reason: 'no_next_anchor' });
});

it('counts a preparation failure as cancellation rather than a signal abort', () => {
  const state = setup(); const attempt = state.trace.start(products[1], 1);
  state.trace.cancel(products[1], attempt, 'preparation_failed');
  expect(state.trace.counters).toMatchObject({ cancellationCount: 1, abortCount: 0 });
});

it('produces deterministic short context IDs without logging the snapshot', () => {
  const snapshot = JSON.stringify({ catalog: 'private-snapshot'.repeat(10000), owner: 'owner-a' });
  expect(instrumentationContextId(snapshot)).toBe(instrumentationContextId(snapshot));
  expect(instrumentationContextId(snapshot)).not.toBe(instrumentationContextId(`${snapshot}x`));
  expect(instrumentationContextId(snapshot)).toMatch(/^ctx-[0-9a-f]{16}$/);
  const state = setup();
  state.context(snapshot);
  state.trace.bind(state.session, 1);
  state.trace.event(products[1], 'queued', 'window_changed');
  state.trace.recordSwipe(state.session, products[0], products[1]);
  state.trace.close('test', 'focus_lost');
  for (const [record] of state.emit.mock.calls) {
    expect(JSON.stringify(record)).not.toContain('private-snapshot');
    expect(record.context).toBeUndefined();
    expect(record.contextId).toBe(instrumentationContextId(snapshot));
  }
});

it('exports 20 complete lifecycles as small single-line parseable logcat JSON', () => {
  const state = setup(); state.trace.bind(state.session, 1);
  for (let index = 0; index < 20; index++) {
    const product = { id: `anchor-${index}` } as Product;
    state.window([products[0], product, products[2]]);
    state.trace.event(product, 'queued', 'window_changed');
    state.trace.recordSwipe(state.session, products[0], product);
    const attempt = state.trace.start(product, index + 1);
    state.time(index * 100 + 10); state.trace.stage(product, 'rankingReadyAt');
    state.trace.finish(product, attempt, 'ranking_preparation_completed');
    state.time(index * 100 + 20); state.trace.stage(product, 'finalReadyAt');
    state.time(index * 100 + 30); state.trace.stage(product, 'packetAcceptedAt');
    state.trace.published(state.session, product);
  }
  expect(records(state.emit, 'discover_prefetch_swipe')).toHaveLength(20);
  expect(records(state.emit, 'discover_prefetch_swipe_result')).toHaveLength(20);
  for (const [record] of state.emit.mock.calls) {
    const line = JSON.stringify(record);
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThan(3000);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({ contextId: expect.any(String), timestamp: expect.any(Number),
      revision: expect.any(Number), event: expect.any(String), reason: expect.any(String) });
    if (record.type !== 'discover_prefetch_summary') {
      expect(record).toHaveProperty('anchorId'); expect(record).toHaveProperty('swipeId');
      expect(record).toHaveProperty('role'); expect(record.preparationStartCount).toBeUndefined();
    }
  }
});

it('emits separate CONTINUE, ABORT and RESTART events and a compact counter summary', () => {
  const state = setup(); state.trace.bind(state.session, 1);
  state.trace.feedUpdate(products.slice(0, 2), 1);
  const first = state.trace.start(products[1], 1);
  state.trace.feedUpdate(products, 2);
  state.trace.abort(products[1], first, 'context_changed');
  state.trace.start(products[1], 3);
  const actions = records(state.emit, 'discover_prefetch_feed_append');
  expect(actions.map(record => record.event)).toEqual(['feedAppend', 'CONTINUE', 'ABORT', 'RESTART']);
  expect(actions.slice(1).every(record => record.anchorId === 'next' && record.contextId.startsWith('ctx-'))).toBe(true);
  const summary = records(state.emit, 'discover_prefetch_summary').at(-1);
  expect(summary).toMatchObject({ preparationStartCount: 2, preparationCompleteCount: 0,
    cancellationCount: 1, abortCount: 1, restartCount: 1, duplicatePreparationCount: 0, feedAppendCount: 1 });
  expect(summary.counters).toBeUndefined();
});
