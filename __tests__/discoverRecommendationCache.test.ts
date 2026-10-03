import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { anchorContext, decodeSnapshot, encodeSnapshot, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { serializeFinal } from '../src/recommendationCache/codec';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { prepareRecommendationFeedPacket, processRecommendationJob, SupabaseRecommendationRecordStore } from '../scripts/lib/supabaseRecommendationCache';
import { RecommendationCacheWorker } from '../scripts/lib/recommendationCacheWorker';
import { createFinalCacheKey } from '../src/recommendationCache/fingerprint';
import type { Product } from '../types/product';

const top: Product = { id: 'top', title: 'Top', category: 'upper_body', outfitRole: 'top', price: 100,
  brand: 'Brand', imageUrl: 'top.jpg', garmentDescription: 'Top', fit: undefined };
const bottom: Product = { ...top, id: 'bottom', title: 'Bottom', category: 'lower_body', outfitRole: 'bottom' };
const bag: Product = { ...top, id: 'bag', title: 'Bag', category: 'bags', outfitRole: 'bag' };
const catalog = [top, bottom, bag];
const wardrobe = [{ id: 'w', category: 'top', color: undefined, style_tags: ['casual'] }];
const store = () => {
  const rows = new Map<string, string>();
  return { read: async (key: { fingerprint: string }) => rows.get(key.fingerprint),
    write: async (key: { fingerprint: string }, payload: string) => { rows.set(key.fingerprint, payload); } };
};

describe('ready feed packet context and memory', () => {
  it('losslessly transports undefined metadata, nulls and exposure without changing snapshot order', () => {
    const snapshot = { catalog, wardrobe, null: null, exposure: [['bag', 2]], missing: undefined };
    expect(decodeSnapshot(encodeSnapshot(snapshot))).toStrictEqual(snapshot);
    expect(() => decodeSnapshot('{"wrong":true}')).toThrow();
  });
  it('attaches existing engine results in exact feed order; only activation credits exposure and undo pins results', async () => {
    const cache = new DiscoverRecommendationCache(catalog, [], 'u');
    const anchors = [bag, top, bottom];
    const request = cache.request(anchors, 1);
    const packet = await prepareRecommendationFeedPacket(new RecommendationCacheWorker(store()), request);
    expect(packet.entries.map(entry => entry.anchorProductId)).toEqual(anchors.map(anchor => anchor.id));
    expect(cache.accept(packet, anchors)).toBe(true); expect(cache.exposure.size).toBe(0);
    const first = cache.lookup(bag);
    expect(first).toStrictEqual(getDiscoverRecommendations(anchorContext(catalog, bag, [], new Map()).input));
    cache.activate(bag); const counts = new Map(cache.exposure);
    cache.activate(bag); expect(cache.exposure).toEqual(counts);
    expect(cache.lookup(top)).toBeDefined(); cache.activate(top);
    expect(cache.lookup(bag)).toBe(first);
    expect(anchors).toEqual([bag, top, bottom]);
  });
  it('never shows incorrect exposure, wardrobe, catalog, owner/session or generation results', async () => {
    const cache = new DiscoverRecommendationCache(catalog, [], 'u');
    const request = cache.request(catalog, 1);
    const packet = await prepareRecommendationFeedPacket(new RecommendationCacheWorker(store()), request);
    expect(cache.accept({ ...packet, generation: 2 }, catalog)).toBe(false);
    expect(new DiscoverRecommendationCache(catalog, [], 'other').accept(packet, catalog)).toBe(false);
    expect(new DiscoverRecommendationCache(catalog, wardrobe, 'u').accept(packet, catalog)).toBe(false);
    expect(new DiscoverRecommendationCache([{ ...top, price: 500 }, bottom, bag], [], 'u').accept(packet, catalog)).toBe(false);
    cache.accept(packet, catalog);
    expect(cache.lookup(bottom)).toBeUndefined(); // top not activated yet
    cache.exposure.set('bag', 100); expect(cache.lookup(top)).toBeUndefined();
    expect(cache.lookup({ ...top, price: 400 })).toBeUndefined();
  });
  it('distinguishes a cached empty result from miss and rejects wrong entry context even with a matching header', () => {
    const cache = new DiscoverRecommendationCache(catalog, [], null);
    const request = cache.request([top], 1);
    expect(cache.lookup(top)).toBeUndefined();
    const wrong = anchorContext(catalog, top, wardrobe, new Map());
    const packet: RecommendationFeedPacket = { ...request, entries: [{ anchorProductId: top.id, exposure: [], serialized: serializeFinal([], wrong) }] };
    expect(cache.accept(packet, [top])).toBe(false);
    packet.entries[0].serialized = serializeFinal([], anchorContext(catalog, top, [], new Map()));
    expect(cache.accept(packet, [top])).toBe(true); expect(cache.lookup(top)).toEqual([]);
    cache.activate(top); expect(cache.shown.has(top.id)).toBe(true); expect(cache.exposure.size).toBe(0);
  });
  it('writes owner-scoped codec records to Supabase and denies publishing private wardrobe to public scope', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const client = { from: jest.fn(() => ({ upsert })) };
    const context = anchorContext(catalog, top, wardrobe, new Map());
    const key = createFinalCacheKey(context), payload = serializeFinal(getDiscoverRecommendations(context.input), context);
    await new SupabaseRecommendationRecordStore(client as never, 'owner').write(key, payload);
    expect(upsert.mock.calls[0][0]).toMatchObject({ scope: 'owner', owner_id: 'owner', kind: 'final', payload });
    expect(upsert.mock.calls[0][0].cache_key_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(new SupabaseRecommendationRecordStore(client as never).write(key, payload)).rejects.toThrow('Private wardrobe');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
  it('rebinds a changed already-shown anchor on a new batch without counting exposure twice', async () => {
    const cache = new DiscoverRecommendationCache(catalog, [], 'u');
    const worker = new RecommendationCacheWorker(store());
    const first = cache.request(catalog, 1);
    cache.accept(await prepareRecommendationFeedPacket(worker, first), catalog); cache.activate(top);
    const counts = new Map(cache.exposure), changed = { ...top, currentPrice: 200 };
    const next = cache.request([changed], 2);
    expect(next.reusableAnchorIds).toEqual([]); expect(next.shownAnchorIds).toContain(top.id);
    const packet = await prepareRecommendationFeedPacket(worker, next);
    expect(packet.entries).toHaveLength(1);
    cache.accept(packet, [changed]); cache.activate(changed);
    expect(cache.exposure).toEqual(counts);
    const ready = cache.lookup(changed);
    expect(ready).toStrictEqual(getDiscoverRecommendations(anchorContext(catalog, changed, [], counts).input));
    cache.exposure.set('extra', 1); expect(cache.lookup(changed)).toBe(ready);
  });
  it('processes a claimed private job with the existing engine and publishes a lossless, canonical packet', async () => {
    const cache = new DiscoverRecommendationCache(catalog, wardrobe, 'owner');
    const request = cache.request([top], 1);
    const records: Record<string, unknown>[] = [];
    const updates: { table: string; value: Record<string, unknown> }[] = [];
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [{ id: 'job', owner_id: 'owner' }], error: null }),
      from: (table: string) => {
        const query = {
          select: (_columns: string) => query,
          eq: (_column: string, _value: unknown) => query,
          single: async () => ({ data: { request_payload: encodeSnapshot(request) }, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          upsert: async (value: Record<string, unknown>) => { records.push(value); return { error: null }; },
          update: (value: Record<string, unknown>) => {
            updates.push({ table, value });
            return { eq: async () => ({ error: null }) };
          },
        };
        return query;
      },
    };
    expect(await processRecommendationJob(client as never)).toBe(true);
    expect(records.map(record => record.kind)).toEqual(['ranking', 'final']);
    expect(records.every(record => record.owner_id === 'owner' && record.scope === 'owner')).toBe(true);
    const result = updates.find(update => update.table === 'discover_recommendation_job_payloads')!;
    const packet = JSON.parse(result.value.result_packet as string) as RecommendationFeedPacket;
    expect(cache.accept(packet, [top])).toBe(true);
    expect(cache.lookup(top)).toStrictEqual(getDiscoverRecommendations(anchorContext(catalog, top, wardrobe, new Map()).input));
    expect(updates.at(-1)).toMatchObject({ table: 'discover_recommendation_jobs', value: { status: 'completed' } });
  });
});
