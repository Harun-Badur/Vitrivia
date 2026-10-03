import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fingerprint, type RecommendationCacheKey } from '../../src/recommendationCache/fingerprint';
import { anchorContext, type FeedPacketRequest, type RecommendationFeedPacket } from '../../src/recommendationCache/feedPacket';
import { complementaryProductsForDisplay } from '../../src/intelligence/recommendations/complementaryProductsForDisplay';
import { serializeFinal } from '../../src/recommendationCache/codec';
import { RecommendationCacheWorker, type RecommendationRecordStore } from './recommendationCacheWorker';

export class SupabaseRecommendationRecordStore implements RecommendationRecordStore {
  private readonly scope: string;
  constructor(private readonly client: SupabaseClient, private readonly ownerId: string | null = null) {
    this.scope = ownerId ?? 'public';
  }
  private hash(key: RecommendationCacheKey): string { return createHash('sha256').update(key.fingerprint).digest('hex'); }
  async read(key: RecommendationCacheKey): Promise<string | undefined> {
    const { data, error } = await this.client.from('discover_recommendation_cache').select('payload')
      .eq('scope', this.scope).eq('kind', key.kind).eq('cache_key_hash', this.hash(key)).maybeSingle();
    if (error) throw error;
    return data?.payload;
  }
  async write(key: RecommendationCacheKey, serialized: string): Promise<void> {
    if (this.ownerId === null && key.wardrobeFingerprint !== fingerprint([])) throw new Error('Private wardrobe requires an owner');
    const { error } = await this.client.from('discover_recommendation_cache').upsert({
      scope: this.scope, owner_id: this.ownerId, kind: key.kind, cache_key_hash: this.hash(key),
      engine_version: key.engineVersion, catalog_version: key.catalogVersion, anchor_product_id: key.anchorProductId,
      catalog_fingerprint: key.catalogFingerprint, context_fingerprint: key.contextFingerprint,
      payload: serialized, updated_at: new Date().toISOString(),
    }, { onConflict: 'scope,kind,cache_key_hash' });
    if (error) throw error;
  }
}

/** Feed order is an input. Only recommendations are attached; no feed reranking. */
export async function prepareRecommendationFeedPacket(worker: RecommendationCacheWorker,
  request: FeedPacketRequest): Promise<RecommendationFeedPacket> {
  if (!request || !Array.isArray(request.anchors) || request.anchors.length > 278 ||
    !Array.isArray(request.exposure) || !Array.isArray(request.shownAnchorIds) || !Array.isArray(request.wardrobeItems)) throw new Error('Invalid feed request');
  const packet: RecommendationFeedPacket = { sessionId: request.sessionId, generation: request.generation,
    contextFingerprint: request.contextFingerprint, entries: [] };
  const exposure = new Map(request.exposure);
  const shown = new Set(request.shownAnchorIds);
  const reusable = new Set(request.reusableAnchorIds ?? request.shownAnchorIds);
  for (const anchor of request.anchors) {
    if (reusable.has(anchor.id)) continue;
    const context = anchorContext(request.candidatePool, anchor, request.wardrobeItems, exposure);
    const { result } = await worker.prepare(context);
    packet.entries.push({ anchorProductId: anchor.id, exposure: [...exposure], serialized: serializeFinal(result, context) });
    if (!shown.has(anchor.id)) {
      shown.add(anchor.id);
      for (const product of complementaryProductsForDisplay(result, anchor.id)) exposure.set(product.id, (exposure.get(product.id) ?? 0) + 1);
    }
  }
  return packet;
}

export async function processRecommendationJob(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('claim_discover_recommendation_job');
  if (error) throw error;
  const job = data?.[0];
  if (!job) return false;
  try {
    const { decodeSnapshot } = await import('../../src/recommendationCache/feedPacket');
    const { data: payload, error: payloadError } = await client.from('discover_recommendation_job_payloads')
      .select('request_payload').eq('job_id', job.id).single();
    if (payloadError) throw payloadError;
    const request = decodeSnapshot<FeedPacketRequest>(payload.request_payload);
    const worker = new RecommendationCacheWorker(new SupabaseRecommendationRecordStore(client, job.owner_id));
    const packet = await prepareRecommendationFeedPacket(worker, request);
    const { error: packetError } = await client.from('discover_recommendation_job_payloads').update({
      result_packet: JSON.stringify(packet) }).eq('job_id', job.id);
    if (packetError) throw packetError;
    const { error: updateError } = await client.from('discover_recommendation_jobs').update({ status: 'completed',
      updated_at: new Date().toISOString() }).eq('id', job.id);
    if (updateError) throw updateError;
  } catch (failure) {
    const { error: updateError } = await client.from('discover_recommendation_jobs').update({ status: 'error',
      error_message: failure instanceof Error ? failure.message : 'Preparation failed', updated_at: new Date().toISOString() }).eq('id', job.id);
    if (updateError) throw updateError;
  }
  return true;
}
