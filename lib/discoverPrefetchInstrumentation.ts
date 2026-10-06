import type { Product } from '../types/product';
import type { DiscoverRecommendationCache } from './discoverRecommendationCache';

type Stage = 'preparationStartedAt' | 'rankingReadyAt' | 'finalReadyAt' | 'memoryWrittenAt' | 'packetAcceptedAt';
export interface PreparationDiagnosticInput {
  feedStatus: string; catalogLength: number; catalogReady: boolean;
  currentProductsLength: number; anchorIds: string[]; isFocused: boolean;
  userIdPresent: boolean; wardrobeUserId: string | null;
  wardrobeReady: boolean; wardrobeMatchesUser: boolean; signalAborted: boolean;
}
/** Observation only: never used to decide whether the production worker runs. */
export function preparationBlockedReason(input: PreparationDiagnosticInput): string | null {
  if (!input.isFocused) return 'NOT_FOCUSED';
  if (input.signalAborted) return 'ABORTED';
  if (input.feedStatus !== 'success') return 'FEED_NOT_SUCCESS';
  if (input.catalogLength === 0) return input.catalogReady ? 'CATALOG_EMPTY' : 'CATALOG_NOT_READY';
  if (input.userIdPresent && !input.wardrobeMatchesUser) return input.wardrobeReady ? 'WARDROBE_USER_MISMATCH' : 'WARDROBE_NOT_READY';
  if (input.anchorIds.length === 0) return 'NO_ANCHORS';
  return null;
}
interface Timing {
  productId: string;
  activeAt?: number;
  nextKnownAt?: number;
  nextPlusOneKnownAt?: number;
  preparationStartedAt?: number;
  rankingReadyAt?: number;
  finalReadyAt?: number;
  memoryWrittenAt?: number;
  packetAcceptedAt?: number;
  cache?: string;
}
interface Pending {
  swipeId?: number;
  target: Product;
  swipeAt: number;
  readyAtSwipe: boolean;
  sourceProductId?: string;
  next: Timing | null;
  nextPlusOne: Timing | null;
}
const createCounters = () => ({ preparationStartCount: 0, preparationCompleteCount: 0,
  cancellationCount: 0, abortCount: 0, restartCount: 0, duplicatePreparationCount: 0, feedAppendCount: 0 });
/** Diagnostic identity only; does not replace any recommendation/cache key. */
export function instrumentationContextId(snapshot: string): string {
  let left = 0x811c9dc5, right = 0x9e3779b9;
  for (let index = 0; index < snapshot.length; index++) {
    const code = snapshot.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `ctx-${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}
const emitDevelopmentRecord = (record: object): void => {
  const host = globalThis as typeof globalThis & { __DISCOVER_PREFETCH_DIAGNOSTICS__?: { records: object[] } };
  const buffer = host.__DISCOVER_PREFETCH_DIAGNOSTICS__ ??= { records: [] };
  buffer.records.push(record);
  if (buffer.records.length > 2000) buffer.records.shift();
  // A console transport failure must not interrupt a gesture or recommendation work.
  try { console.info(JSON.stringify(record)); } catch { /* Retained in the development buffer. */ }
};

/** Dev diagnostics only. No engine inputs, payloads or environment values are logged. */
export class DiscoverPrefetchInstrumentation {
  private diagnosticListenerAttached = false;
  private diagnosticWorkerInstalled = false;
  private diagnosticEffectEntries = 0;
  private diagnosticEffectProducts?: readonly Product[];
  private diagnosticProducts?: readonly Product[];
  diagnostic(event: string, details: Record<string, unknown> = {}): void {
    if (event === 'effectEntered') this.diagnosticEffectEntries++;
    if (event === 'listenerAttached') this.diagnosticListenerAttached = true;
    if (event === 'workerInstalled') this.diagnosticWorkerInstalled = true;
    if (event === 'workerStopped') { this.diagnosticListenerAttached = false; this.diagnosticWorkerInstalled = false; }
    this.emit({ type: 'discover_preparation_diagnostic', sessionId: this.sessionId, contextId: this.context,
      revision: this.revision, timestamp: this.clock(), event,
      listenerAttached: this.diagnosticListenerAttached, workerInstalled: this.diagnosticWorkerInstalled,
      effectEntryCount: this.diagnosticEffectEntries, ...details });
  }
  effectEntered(products: readonly Product[], input: PreparationDiagnosticInput): void {
    this.diagnosticEffectProducts = products;
    this.diagnostic('effectEntered', { ...input, anchorCount: input.currentProductsLength,
      wardrobeUserIdEncoding: 'diagnostic_hash', effectEntered: true });
    for (const guard of ['focus', 'signal', 'feed', 'catalog', 'wardrobe', 'anchors']) {
      this.diagnostic('guardBefore', { guard });
      const blocked = preparationBlockedReason(input);
      const reasonGuard: Record<string, string> = { NOT_FOCUSED: 'focus', ABORTED: 'signal', FEED_NOT_SUCCESS: 'feed',
        CATALOG_NOT_READY: 'catalog', CATALOG_EMPTY: 'catalog', WARDROBE_NOT_READY: 'wardrobe',
        WARDROBE_USER_MISMATCH: 'wardrobe', NO_ANCHORS: 'anchors' };
      this.diagnostic('guardAfter', { guard, passed: !blocked || reasonGuard[blocked] !== guard });
      if (blocked && reasonGuard[blocked] === guard) {
        this.diagnostic('workerStartBlocked', { workerStartBlocked: true, blockedReason: blocked });
        break;
      }
    }
  }
  productsObserved(products: readonly Product[], revision: number): void {
    if (this.diagnosticProducts === products) return;
    const previous = this.diagnosticProducts;
    this.diagnosticProducts = products;
    this.diagnostic('currentProductsChanged', { currentProductsLength: products.length,
      anchorIds: products.slice(0, 3).map(product => product.id),
      effectTriggeredForCurrentProducts: this.diagnosticEffectProducts === products,
      reason: 'observed_after_focus_effect; append_is_not_an_effect_dependency' });
    if (previous && products.length > previous.length && previous.every((product, index) => product === products[index])) {
      this.diagnostic('feedAppendWorkerState', { feedRevision: revision, reason: 'feed_append' });
    }
  }
  closeReason = 'worker_replaced_or_aborted';
  private readonly timings = new Map<Product, Timing>();
  private pending: Pending[] = [];
  private sequence = 0;
  private swipeSequence = 0;
  private sessionId = 'unbound';
  private context = 'unbound';
  private contextSnapshot?: string;
  private swipeIds = new Map<Product, number>();
  private appendedPending = new Map<Product, number>();
  private revision = 0;
  private roles: readonly Product[] = [];
  private active = new Map<Product, Set<number>>();
  private starts = new Map<Product, number>();
  private startRevisions = new Map<Product, Map<number, number>>();
  private feed?: { revision: number; products: readonly Product[] };
  constructor(private readonly clock = () => performance.now(),
    private readonly emit = emitDevelopmentRecord,
    readonly counters = createCounters()) {}
  private timing(product: Product): Timing {
    let timing = this.timings.get(product);
    if (!timing) { timing = { productId: product.id }; this.timings.set(product, timing); }
    return timing;
  }
  window(products: readonly Product[]): void {
    this.roles = products.slice(0, 3);
    const now = this.clock();
    products.slice(0, 3).forEach((product, index) => {
      const timing = this.timing(product);
      const field = index === 0 ? 'activeAt' : index === 1 ? 'nextKnownAt' : 'nextPlusOneKnownAt';
      timing[field] ??= now;
    });
    // Bound diagnostics to the current window and unresolved measurements.
    const retained = new Set([...products.slice(0, 3), ...this.pending.map(item => item.target)]);
    for (const product of this.timings.keys()) if (!retained.has(product)) this.timings.delete(product);
  }
  bind(session: DiscoverRecommendationCache, revision: number): void {
    this.sessionId = session.sessionId;
    const snapshot = session.contextFingerprint ?? '';
    if (this.contextSnapshot !== snapshot) {
      this.contextSnapshot = snapshot;
      this.context = instrumentationContextId(snapshot);
    }
    this.revision = revision;
  }
  summary(reason: string): void {
    this.emit({ type: 'discover_prefetch_summary', sessionId: this.sessionId, contextId: this.context,
      revision: this.revision, timestamp: this.clock(), event: 'summary', reason,
      swipeCount: this.swipeSequence, openSwipeCount: this.pending.length, ...this.counters });
  }
  private role(product: Product): string {
    return ['active', 'next', 'next+1'][this.roles.indexOf(product)] ?? 'off_window';
  }
  private appendAction(product: Product, event: 'CONTINUE' | 'ABORT' | 'RESTART', reason: string,
    revision: number, attempt = this.starts.get(product)): void {
    this.emit({ type: 'discover_prefetch_feed_append', swipeId: this.swipeIds.get(product) ?? null,
      anchorId: product.id, sessionId: this.sessionId, contextId: this.context, revision,
      role: this.role(product), timestamp: this.clock(), event, reason, attempt });
  }
  event(product: Product, event: string, reason: string, revision = this.revision, attempt = this.starts.get(product)): void {
    if (event === 'cancelled') this.counters.cancellationCount++;
    this.emit({ type: 'discover_prefetch_lifecycle', anchorId: product.id, sessionId: this.sessionId,
      swipeId: this.swipeIds.get(product) ?? null, contextId: this.context, revision, timestamp: this.clock(),
      role: this.role(product), event, reason, attempt,
      preparationRevision: attempt === undefined ? undefined : this.startRevisions.get(product)?.get(attempt),
      feedRevision: this.feed?.revision });
    if (event === 'cancelled') this.summary('cancelled');
  }
  start(product: Product, revision: number): number {
    const previous = this.starts.get(product) ?? 0;
    if (this.active.has(product)) this.counters.duplicatePreparationCount++;
    else if (previous > 0) this.counters.restartCount++;
    const attempt = previous + 1;
    this.starts.set(product, attempt);
    const revisions = this.startRevisions.get(product) ?? new Map<number, number>();
    revisions.set(attempt, revision); this.startRevisions.set(product, revisions);
    const attempts = this.active.get(product) ?? new Set<number>();
    attempts.add(attempt); this.active.set(product, attempts);
    this.counters.preparationStartCount++;
    this.event(product, 'preparationStart', `attempt_${attempt}`, revision);
    if (previous > 0 && this.appendedPending.has(product)) this.appendAction(product, 'RESTART',
      'new_attempt_after_append_not_proof_of_causation', this.appendedPending.get(product)!);
    this.summary('preparation_start');
    return attempt;
  }
  finish(product: Product, attempt: number, reason: string): void {
    const attempts = this.active.get(product);
    if (!attempts?.delete(attempt)) return;
    if (attempts.size === 0) this.active.delete(product);
    this.counters.preparationCompleteCount++;
    this.event(product, 'completed', reason, this.revision, attempt);
    this.summary('preparation_complete');
  }
  abort(product: Product, attempt: number, reason: string): void {
    const attempts = this.active.get(product);
    if (!attempts?.delete(attempt)) return;
    if (attempts.size === 0) this.active.delete(product);
    this.counters.abortCount++;
    this.event(product, 'aborted', reason, this.revision, attempt);
    this.event(product, 'cancelled', reason, this.revision, attempt);
    if (this.appendedPending.has(product)) this.appendAction(product, 'ABORT', reason, this.appendedPending.get(product)!, attempt);
    this.closeAnchor(product, reason);
    this.summary('preparation_abort');
  }
  cancel(product: Product, attempt: number, reason: string): void {
    const attempts = this.active.get(product);
    if (!attempts?.delete(attempt)) return;
    if (attempts.size === 0) this.active.delete(product);
    this.event(product, 'cancelled', reason, this.revision, attempt);
    this.closeAnchor(product, reason);
    this.summary('preparation_cancel');
  }
  feedUpdate(products: readonly Product[], revision: number): void {
    const previous = this.feed;
    this.feed = { revision, products: [...products] };
    if (!previous || previous.revision === revision || products.length <= previous.products.length ||
      !previous.products.every((product, index) => product === products[index])) return;
    this.counters.feedAppendCount++;
    this.emit({ type: 'discover_prefetch_feed_append', sessionId: this.sessionId, contextId: this.context,
      swipeId: null, anchorId: null, revision, role: 'none', timestamp: this.clock(), event: 'feedAppend', reason: 'feed_append' });
    for (const [product, attempts] of this.active) {
      this.appendedPending.set(product, revision);
      for (const attempt of attempts) this.appendAction(product, 'CONTINUE', 'pending_at_append', revision, attempt);
    }
    this.summary('feed_append');
  }
  recordSwipe(session: DiscoverRecommendationCache, source: Product, target?: Product): void {
    const swipeId = ++this.swipeSequence;
    this.bind(session, this.revision);
    if (target) this.swipeIds.set(target, swipeId);
    this.emit({ type: 'discover_prefetch_swipe', swipeId, sessionId: session.sessionId,
      anchorId: target?.id ?? null, sourceProductId: source.id, contextId: this.context, role: 'next', event: 'swipe',
      sourceMatchesActive: session.preparationWindow[0]?.id === source.id,
      revision: this.revision, timestamp: this.clock(), reason: target ? 'pass_callback' : 'no_next_anchor',
      terminal: !target,
      readyAtSwipe: target ? session.lookup(target) !== undefined : false,
      nextPacketPrepared: target ? session.peekPrepared(target) !== undefined : false,
      nextPlusOnePacketPrepared: session.preparationWindow[2]
        ? session.peekPrepared(session.preparationWindow[2]) !== undefined : false });
    if (target) this.swipe(session, target, swipeId);
  }
  stage(product: Product, stage: Stage, cache?: string): void {
    const timing = this.timing(product);
    timing[stage] = this.clock();
    if (cache) timing.cache = cache;
    if (this.context !== 'unbound') {
      const event = { preparationStartedAt: null, rankingReadyAt: 'rankingReady', finalReadyAt: 'finalReady',
        memoryWrittenAt: null, packetAcceptedAt: null }[stage];
      if (event) this.event(product, event, cache ?? 'engine_stage_completed');
    }
  }
  swipe(session: DiscoverRecommendationCache, target: Product, swipeId?: number): void {
    const window = session.preparationWindow;
    const snapshot = (product?: Product) => product ? { ...this.timing(product),
      packetPreparedAtSwipe: session.peekPrepared(product) !== undefined } : null;
    this.pending.push({ swipeId, target, swipeAt: this.clock(), readyAtSwipe: session.lookup(target) !== undefined,
      sourceProductId: window[0]?.id, next: snapshot(window[1]), nextPlusOne: snapshot(window[2]) });
    this.settle(session);
  }
  settle(session: DiscoverRecommendationCache): void {
    this.pending = this.pending.filter(item => {
      const ready = session.lookup(item.target) !== undefined;
      if (!ready || (item.swipeId === undefined && session.preparationWindow[0] !== item.target)) return true;
      const timing = this.timing(item.target);
      // Readiness means an exposure-valid display lookup, not merely a prepared packet.
      const recommendationReadyAt = item.readyAtSwipe
        ? timing.packetAcceptedAt ?? item.swipeAt : this.clock();
      this.emit({ type: 'discover_prefetch_swipe_result', sequence: ++this.sequence, sessionId: session.sessionId,
        ...timing, ...item, target: undefined, productId: item.target.id, anchorId: item.target.id,
        contextId: this.context, revision: this.revision, role: this.role(item.target), timestamp: this.clock(),
        event: 'swipeResult', reason: 'display_eligible', recommendationReadyAt,
        timestampBasis: 'performance.now; swipeAt=JS store commit request; activeAt=layout effect',
        labelConvention: 'user_requested_inverted_inequality',
        status: item.swipeAt <= recommendationReadyAt ? 'READY' : 'NOT_READY',
        waitMs: item.readyAtSwipe ? 0 : Math.max(0, recommendationReadyAt - item.swipeAt),
        cacheAtSwipe: item.readyAtSwipe ? 'hit' : 'miss' });
      return false;
    });
  }
  published(session: DiscoverRecommendationCache, product: Product): void {
    this.event(product, 'published', 'packet_accepted');
    this.event(product, 'completed', 'final_packet_accepted');
    // Off-screen completion must close its measurement too. Display eligibility stays separate.
    this.pending = this.pending.filter(item => {
      if (item.target !== product) return true;
      const readyAt = this.timing(product).packetAcceptedAt ?? this.clock();
      this.emit({ type: 'discover_prefetch_swipe_result', sessionId: session.sessionId,
        ...this.timing(product), ...item, target: undefined, anchorId: product.id,
        contextId: this.context, revision: this.revision, role: this.role(product), timestamp: this.clock(),
        event: 'swipeResult', reason: 'packet_accepted', status: 'COMPLETED', recommendationReadyAt: readyAt,
        displayEligibleAtCompletion: session.lookup(product) !== undefined,
        waitMs: item.readyAtSwipe ? 0 : Math.max(0, readyAt - item.swipeAt) });
      return false;
    });
  }
  private closeAnchor(product: Product, reason: string): void {
    this.pending = this.pending.filter(item => {
      if (item.target !== product) return true;
      this.emit({ type: 'discover_prefetch_swipe_result', sessionId: this.sessionId,
        ...item, target: undefined, anchorId: product.id, status: 'CANCELLED', reason,
        contextId: this.context, revision: this.revision, role: this.role(product), event: 'swipeResult',
        timestamp: this.clock(), waitMs: null });
      return false;
    });
  }
  close(sessionId: string, reason = 'focus_or_context_cancelled'): void {
    for (const [product, attempts] of [...this.active]) {
      for (const attempt of [...attempts]) this.abort(product, attempt, reason);
    }
    for (const product of new Set(this.pending.filter(item => item.swipeId !== undefined).map(item => item.target))) {
      this.event(product, 'cancelled', reason);
    }
    for (const item of this.pending) this.emit({ type: 'discover_prefetch_swipe_result', sequence: ++this.sequence,
      sessionId, productId: item.target.id, ...item, target: undefined, status: item.swipeId ? 'CANCELLED' : 'UNRESOLVED',
      anchorId: item.target.id, contextId: this.context, revision: this.revision,
      role: this.role(item.target), event: 'swipeResult', reason, timestamp: this.clock(), waitMs: null });
    this.pending = [];
    if (this.context !== 'unbound') {
      this.emit({ type: 'discover_prefetch_cleanup', sessionId, contextId: this.context, revision: this.revision,
        swipeId: null, anchorId: null, role: 'none', timestamp: this.clock(), event: 'cleanup', reason });
      this.summary(reason);
    }
  }
}

let traces: WeakMap<DiscoverRecommendationCache, DiscoverPrefetchInstrumentation> | undefined;
let globalCounters: ReturnType<typeof createCounters> | undefined;
export function discoverPrefetchTrace(session: DiscoverRecommendationCache): DiscoverPrefetchInstrumentation {
  traces ??= new WeakMap();
  let trace = traces.get(session);
  if (!trace) { trace = new DiscoverPrefetchInstrumentation(undefined, undefined,
    globalCounters ??= createCounters()); traces.set(session, trace); }
  return trace;
}
