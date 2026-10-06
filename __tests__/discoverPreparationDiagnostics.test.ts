import { DiscoverPrefetchInstrumentation, preparationBlockedReason,
  type PreparationDiagnosticInput } from '../lib/discoverPrefetchInstrumentation';
import type { Product } from '../types/product';
import type { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';

function setup(overrides: Partial<PreparationDiagnosticInput> = {}) {
  const emitted: Record<string, unknown>[] = [];
  const trace = new DiscoverPrefetchInstrumentation(() => 10, record => emitted.push(record as Record<string, unknown>));
  const products = [{ id: 'active' }, { id: 'next' }] as Product[];
  const session = { sessionId: 'diagnostic', contextFingerprint: 'context' } as DiscoverRecommendationCache;
  trace.bind(session, 1);
  const input: PreparationDiagnosticInput = { feedStatus: 'success', catalogLength: 80, catalogReady: true,
    currentProductsLength: 2, anchorIds: ['active', 'next'], isFocused: true, userIdPresent: false,
    wardrobeUserId: null, wardrobeReady: true, wardrobeMatchesUser: true, signalAborted: false, ...overrides };
  return { trace, input, products, emitted };
}

it('identifies initial empty anchors and observes later products without inventing a new effect/start', () => {
  const s = setup({ currentProductsLength: 0, anchorIds: [] });
  s.trace.effectEntered([], s.input); s.trace.productsObserved([], 1);
  s.trace.productsObserved(s.products, 2);
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'workerStartBlocked', blockedReason: 'NO_ANCHORS' }));
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'currentProductsChanged',
    currentProductsLength: 2, effectTriggeredForCurrentProducts: false, effectEntryCount: 1 }));
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'feedAppendWorkerState', listenerAttached: false }));
  expect(s.emitted.filter(x => x.event === 'effectEntered')).toHaveLength(1);
});
it('reports feed error before catalog/wardrobe checks', () => {
  const s = setup({ feedStatus: 'error', catalogLength: 0 }); s.trace.effectEntered(s.products, s.input);
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'workerStartBlocked', blockedReason: 'FEED_NOT_SUCCESS' }));
});
it('distinguishes an unfinished catalog from a completed empty catalog', () => {
  const s = setup({ catalogLength: 0, catalogReady: false });
  expect(preparationBlockedReason(s.input)).toBe('CATALOG_NOT_READY');
  expect(preparationBlockedReason({ ...s.input, catalogReady: true })).toBe('CATALOG_EMPTY');
});
it('distinguishes wardrobe pending from completed user mismatch', () => {
  const s = setup({ userIdPresent: true, wardrobeMatchesUser: false, wardrobeReady: false });
  expect(preparationBlockedReason(s.input)).toBe('WARDROBE_NOT_READY');
  s.trace.effectEntered(s.products, { ...s.input, wardrobeReady: true });
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'workerStartBlocked', blockedReason: 'WARDROBE_USER_MISMATCH' }));
});
it('logs focus cleanup and listener removal without invoking production cancellation', () => {
  const s = setup(); s.trace.effectEntered(s.products, s.input);
  s.trace.diagnostic('listenerAttached'); s.trace.diagnostic('workerInstalled');
  s.trace.diagnostic('effectCleanup', { reason: 'focus_lost' });
  s.trace.diagnostic('workerStopped', { reason: 'focus_lost', signalAborted: true });
  s.trace.productsObserved(s.products, 1); s.trace.productsObserved([...s.products, { id: 'warm' } as Product], 2);
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'effectCleanup', reason: 'focus_lost' }));
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'feedAppendWorkerState', listenerAttached: false, workerInstalled: false }));
  expect(preparationBlockedReason({ ...s.input, isFocused: false })).toBe('NOT_FOCUSED');
  expect(preparationBlockedReason({ ...s.input, signalAborted: true })).toBe('ABORTED');
});
it('records successful setup, first schedule and append with the attached worker', () => {
  const s = setup(); s.trace.effectEntered(s.products, s.input);
  s.trace.diagnostic('workerStartAttempt', { workerStartAttempt: true });
  s.trace.diagnostic('listenerAttached'); s.trace.diagnostic('workerInstalled');
  s.trace.diagnostic('firstScheduleCalled', { firstScheduleCalled: true });
  s.trace.productsObserved(s.products, 1); s.trace.productsObserved([...s.products, { id: 'warm' } as Product], 2);
  expect(s.emitted.some(x => x.event === 'workerStartBlocked')).toBe(false);
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'firstScheduleCalled', listenerAttached: true, workerInstalled: true }));
  expect(s.emitted).toContainEqual(expect.objectContaining({ event: 'feedAppendWorkerState', listenerAttached: true, workerInstalled: true }));
  expect(s.trace.counters.preparationStartCount).toBe(0);
});
