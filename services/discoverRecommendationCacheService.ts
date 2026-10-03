import { getSupabaseClient } from '../lib/supabase';
import { hydrateFinal, serializeFinal } from '../src/recommendationCache/codec';
import { RECOMMENDATION_ENGINE_VERSION } from '../src/recommendationCache/fingerprint';
import { anchorContext, type FeedPacketRequest, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { getDiscoverRecommendationsAsync } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import type { OutfitDiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';
import { getProductRepository, type ProductRepository } from './productRepository';

interface CachedFinal { payload: string; catalog_version: string | null; anchor_product_id: string }
const CACHE_READ_TIMEOUT_MS = 1_200;

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
  signal: AbortSignal, onPacket: (packet: RecommendationFeedPacket) => void): Promise<void> {
  if (signal.aborted || request.anchors.length === 0) return;
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
