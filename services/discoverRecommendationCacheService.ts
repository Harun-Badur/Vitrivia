import { getSupabaseClient } from '../lib/supabase';
import { discoverPrefetchTrace } from '../lib/discoverPrefetchInstrumentation';
import { hydrateFinal, serializeFinal } from '../src/recommendationCache/codec';
import { RECOMMENDATION_ENGINE_VERSION } from '../src/recommendationCache/fingerprint';
import { anchorContext, type FeedPacketRequest, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { getDiscoverRecommendationsAsync, prepareDiscoverRankingAsync, completeDiscoverRecommendationsAsync,
  type PreparedDiscoverRanking } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { RankingPreparationCache } from '../src/intelligence/recommendations/rankingPreparationCache';
import { RecommendationMemoryCache } from '../src/recommendationCache/memoryCache';
import { createFinalCacheKey, createRankingCacheKey } from '../src/recommendationCache/fingerprint';
import type { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import type { Product } from '../types/product';
import type { OutfitDiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';
import { getProductRepository, type ProductRepository } from './productRepository';

interface CachedFinal { payload: string; catalog_version: string | null; anchor_product_id: string }
const CACHE_READ_TIMEOUT_MS = 1_200;
const preparationCaches = new WeakMap<DiscoverRecommendationCache, {
  memory: RecommendationMemoryCache;
  rankings: RankingPreparationCache<Product, PreparedDiscoverRanking>;
  stop?: () => void;
}>();

/** Optional cache reads cannot hold Discover behind an unavailable backend/worker. */
async function readCachedFinals(request: FeedPacketRequest, ownerId: string | null,
  signal: AbortSignal): Promise<CachedFinal[]> {
  const client = getSupabaseClient();
  if (!client || signal.aborted) return [];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const stopped = new Promise<CachedFinal[]>(resolve => {
    onAbort = () => { controller.abort(); resolve([]); };
    timer = setTimeout(onAbort, CACHE_READ_TIMEOUT_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const query = client.from('discover_recommendation_cache')
      .select('payload,catalog_version,anchor_product_id').eq('kind', 'final').eq('engine_version', RECOMMENDATION_ENGINE_VERSION)
      .in('scope', ownerId ? ['public', ownerId] : ['public'])
      .in('anchor_product_id', request.anchors.map(anchor => anchor.id)).abortSignal(controller.signal).limit(1000);
    return await Promise.race([stopped, Promise.resolve(query)
      .then(({ data, error }) => error ? [] : data ?? []).catch(() => [])]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

async function resolveProducts(result: readonly OutfitDiscoverRecommendation[], repository: ProductRepository) {
  const ids = result.flatMap(entry => entry.candidate.items.flatMap(item =>
    item.sourceType === 'catalog' ? [item.sourceId] : []));
  const products = await repository.productsById(ids);
  const resolve = (id: string) => {
    const product = products.get(id);
    if (!product) throw new Error(`Recommendation product not found: ${id}`);
    return product;
  };
  return result.map(entry => ({ ...entry, candidate: { ...entry.candidate,
    items: entry.candidate.items.map(item => item.sourceType === 'catalog'
      ? { ...item, product: resolve(item.sourceId) } : item) },
    ...(entry.displayProducts === undefined ? {} : { displayProducts: entry.displayProducts.map(product => resolve(product.id)) }),
  }));
}

/** Feed/context preparation only. Cache hits are reused; misses use the unchanged local engine. */
export async function loadDiscoverRecommendationPacket(request: FeedPacketRequest, ownerId: string | null,
  signal: AbortSignal, onPacket: (packet: RecommendationFeedPacket) => void,
  session?: DiscoverRecommendationCache): Promise<void> {
  if (signal.aborted || request.anchors.length === 0) {
    if (__DEV__ && session) discoverPrefetchTrace(session).diagnostic('workerStartBlocked', {
      workerStartBlocked: true, blockedReason: signal.aborted ? 'ABORTED' : 'NO_ANCHORS' });
    return;
  }
  if (session) return prepareWindow(request, ownerId, signal, onPacket, session);
  const repository = getProductRepository();
  // These records already came from the products repository, never recommendation payloads.
  const catalog = repository.register(request.candidatePool);
  const anchors = repository.register(request.anchors);
  const records = await readCachedFinals(request, ownerId, signal);
  const exposure = new Map(request.exposure), shown = new Set(request.shownAnchorIds);
  const reusable = new Set(request.reusableAnchorIds ?? request.shownAnchorIds);
  for (const anchor of anchors) {
    if (signal.aborted) return;
    if (reusable.has(anchor.id)) continue;
    let context = anchorContext(catalog, anchor, request.wardrobeItems, exposure);
    let result: readonly OutfitDiscoverRecommendation[] | undefined;
    for (const row of records) {
      if (row.anchor_product_id !== anchor.id) continue;
      const cachedContext = anchorContext(catalog, anchor, request.wardrobeItems, exposure, row.catalog_version || undefined);
      const hit = hydrateFinal(row.payload, cachedContext);
      if (hit.status !== 'hit') continue;
      context = cachedContext;
      result = hit.value;
      break;
    }
    if (result === undefined) result = await getDiscoverRecommendationsAsync(context.input, { signal });
    if (signal.aborted) return;
    const resolved = await resolveProducts(result, repository);
    if (signal.aborted) return;
    // Publish each anchor as soon as it is ready; a missing prefix cannot hide later results.
    onPacket({ sessionId: request.sessionId, generation: request.generation,
      contextFingerprint: request.contextFingerprint, entries: [{ anchorProductId: anchor.id,
        exposure: [...exposure], catalogVersion: context.catalogVersion, serialized: serializeFinal(resolved, context) }] });
    if (!shown.has(anchor.id)) {
      shown.add(anchor.id);
      for (const product of complementaryProductsForDisplay(resolved, anchor.id)) {
        exposure.set(product.id, (exposure.get(product.id) ?? 0) + 1);
      }
    }
  }
}

/** One cooperative CPU queue. Product resolution/publication never holds up the next ranking. */
async function prepareWindow(request: FeedPacketRequest, ownerId: string | null, signal: AbortSignal,
  onPacket: (packet: RecommendationFeedPacket) => void, session: DiscoverRecommendationCache): Promise<void> {
  let caches = preparationCaches.get(session);
  if (!caches) {
    caches = { memory: new RecommendationMemoryCache(), rankings: new RankingPreparationCache() };
    preparationCaches.set(session, caches);
  }
  caches.stop?.();
  const { memory, rankings } = caches;
  const controller = new AbortController();
  const repository = getProductRepository();
  const catalog = repository.register(request.candidatePool);
  let revision = 0, running = false, dirty = false, ready = false;
  const changed = new Set<() => void>();
  let records: CachedFinal[] = [];
  const publications = new Map<string, number>();
  const resolutions = new Map<string, Promise<readonly OutfitDiscoverRecommendation[]>>();
  const current = (version: number) => !controller.signal.aborted && revision === version;
  const stop = () => { controller.abort(); rankings.cancelPending(); changed.forEach(wake => wake()); unsubscribe(); signal.removeEventListener('abort', stop);
    if (__DEV__) discoverPrefetchTrace(session).diagnostic('workerStopped', {
      reason: discoverPrefetchTrace(session).closeReason, signalAborted: controller.signal.aborted });
    if (__DEV__) discoverPrefetchTrace(session).close(session.sessionId, discoverPrefetchTrace(session).closeReason);
  };
  const schedule = () => {
    if (__DEV__ && revision === 0) discoverPrefetchTrace(session).diagnostic('firstScheduleCalled', {
      firstScheduleCalled: true, ready, signalAborted: controller.signal.aborted,
      anchorCount: session.preparationWindow.length });
    revision += 1;
    if (__DEV__) {
      discoverPrefetchTrace(session).bind(session, revision);
      for (const product of session.preparationWindow) discoverPrefetchTrace(session).event(product, 'queued', 'window_or_exposure_changed', revision);
    }
    dirty = true;
    publications.clear();
    rankings.retainPending([]);
    changed.forEach(wake => wake());
    // Gesture-time notification only queues work; it never runs the engine synchronously.
    if (ready && !running) void Promise.resolve().then(pump);
  };
  const unsubscribe = session.subscribePreparation(schedule);
  if (__DEV__) discoverPrefetchTrace(session).diagnostic('listenerAttached', { listenerAttached: true });
  caches.stop = stop;
  signal.addEventListener('abort', stop, { once: true });
  if (__DEV__) discoverPrefetchTrace(session).diagnostic('workerInstalled', {
    reason: 'subscription_and_abort_handler_attached', signalAborted: controller.signal.aborted });

  async function pump(): Promise<void> {
    if (running || controller.signal.aborted) return;
    running = true;
    try {
      while (dirty && !controller.signal.aborted) {
        dirty = false;
        const version = revision;
        // The live window also admits appended feed anchors without replacing this worker.
        const window = session.preparationWindow;
        const exposure = new Map(session.exposure);
        for (const product of window) {
          if (!current(version)) break;
          // Shown/pinned anchors keep their final result, including undo.
          if (session.shown.has(product.id) && session.lookup(product) !== undefined) continue;
          const anchor = repository.register([product])[0];
          let context = anchorContext(catalog, anchor, request.wardrobeItems, exposure);
          let finalKey = createFinalCacheKey(context);
          const finalHit = memory.getFinal(finalKey);
          if (__DEV__ && finalHit.status === 'hit') discoverPrefetchTrace(session).stage(product, 'finalReadyAt', 'final_memory_hit');
          let result = finalHit.status === 'hit' ? finalHit.value : undefined;
          if (result === undefined) {
            for (const row of records) {
              if (row.anchor_product_id !== anchor.id) continue;
              const cachedContext = anchorContext(catalog, anchor, request.wardrobeItems, exposure, row.catalog_version || undefined);
              const hit = hydrateFinal(row.payload, cachedContext);
              if (hit.status !== 'hit') continue;
              context = cachedContext;
              result = hit.value;
              if (__DEV__) discoverPrefetchTrace(session).stage(product, 'finalReadyAt', 'backend_final_hit');
              break;
            }
            if (result === undefined) {
              const rankingKey = createRankingCacheKey(context);
              const rankingHit = memory.getRanking(rankingKey);
              if (__DEV__ && rankingHit.status === 'hit') discoverPrefetchTrace(session).stage(product, 'rankingReadyAt', 'ranking_memory_hit');
              rankings.retainPending([product]);
              const preparation = rankingHit.status === 'hit' ? Promise.resolve(rankingHit.value) : rankings.get(product, async rankingSignal => {
                const trace = __DEV__ ? discoverPrefetchTrace(session) : undefined;
                const attempt = trace?.start(product, version);
                const aborted = () => trace?.abort(product, attempt!, trace.closeReason);
                if (__DEV__) rankingSignal.addEventListener('abort', aborted, { once: true });
                if (__DEV__) discoverPrefetchTrace(session).stage(product, 'preparationStartedAt', 'ranking_miss');
                let value: PreparedDiscoverRanking;
                try {
                  value = await prepareDiscoverRankingAsync(context.input, { signal: rankingSignal,
                    waitForTurn: () => rankings.waitForTurn(product, rankingSignal) });
                } catch (error) {
                  if (__DEV__ && !rankingSignal.aborted) trace?.cancel(product, attempt!, 'preparation_failed');
                  throw error;
                } finally {
                  if (__DEV__) rankingSignal.removeEventListener('abort', aborted);
                }
                memory.setRanking(rankingKey, value);
                if (__DEV__) discoverPrefetchTrace(session).stage(product, 'rankingReadyAt');
                if (__DEV__) trace?.finish(product, attempt!, 'ranking_preparation_completed');
                return value;
              });
              let wake = () => {};
              const interrupted = new Promise<undefined>(resolve => { wake = () => resolve(undefined); changed.add(wake); });
              const prepared = await Promise.race([preparation, interrupted]);
              changed.delete(wake);
              if (prepared === undefined) break;
              if (!current(version)) break;
              result = await completeDiscoverRecommendationsAsync(prepared, exposure, { signal: controller.signal });
              if (__DEV__) discoverPrefetchTrace(session).stage(product, 'finalReadyAt');
            }
            if (!current(version)) break;
            // Cache under the local context too, so a backend catalog version does not cause repeated reads.
            memory.setFinal(finalKey, result);
            if (__DEV__) discoverPrefetchTrace(session).stage(product, 'memoryWrittenAt');
          }
          finalKey = createFinalCacheKey(context);
          const publicationKey = finalKey.fingerprint;
          if (publications.get(publicationKey) !== version) {
            publications.set(publicationKey, version);
            let resolved = resolutions.get(publicationKey);
            if (!resolved) {
              resolved = resolveProducts(result, repository);
              resolutions.set(publicationKey, resolved);
              void resolved.then(() => { resolutions.delete(publicationKey); }, () => { resolutions.delete(publicationKey); });
            }
            const packetExposure = [...exposure];
            void resolved.then(value => {
              if (!current(version)) {
                if (__DEV__) discoverPrefetchTrace(session).event(product, 'cancelled', 'stale_revision_publication', version);
                return;
              }
              onPacket({ sessionId: request.sessionId, generation: request.generation,
                contextFingerprint: request.contextFingerprint, entries: [{ anchorProductId: anchor.id,
                  exposure: packetExposure, catalogVersion: context.catalogVersion, serialized: serializeFinal(value, context) }] });
            }).catch(error => {
              if (!controller.signal.aborted) { publications.delete(publicationKey); rejectCompletion(error); stop(); }
            });
          }
          if (!session.shown.has(product.id)) {
            for (const complement of complementaryProductsForDisplay(result, product.id)) {
              exposure.set(complement.id, (exposure.get(complement.id) ?? 0) + 1);
            }
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) { rejectCompletion(error); stop(); }
    } finally { running = false; }
  }

  // Keep the focus-owned subscription alive until cancellation and surface background errors.
  let rejectCompletion: (error: unknown) => void = () => {};
  const completion = new Promise<void>((resolve, reject) => {
    rejectCompletion = reject;
    controller.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  if (signal.aborted) stop();
  else {
    records = await readCachedFinals(request, ownerId, controller.signal);
    ready = true;
    if (!controller.signal.aborted) schedule();
  }
  return completion;
}
