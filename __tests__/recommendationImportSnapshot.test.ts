import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiscoverImportSnapshot, parseRecommendationCliSnapshot, serializeDiscoverImportSnapshot } from '../scripts/lib/discoverRecommendationSnapshot';
import { runRecommendationSnapshotCli } from '../scripts/createRecommendationSnapshot';
import { runRecommendationCacheCli } from '../scripts/prepareRecommendationCache';
import * as worker from '../scripts/lib/recommendationCacheWorker';
import { fetchFeedProducts, fetchRecommendationCatalog } from '../services/productService';
import { getSupabaseClient } from '../lib/supabase';
import { fingerprint, createFinalCacheKey } from '../src/recommendationCache/fingerprint';
import type { ImportPreparationInput } from '../scripts/lib/recommendationCacheWorker';
import type { Product } from '../types/product';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn(), setLastRecommendationId: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ buildIntent: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../lib/recsConfig', () => ({ fetchRecsConfig: jest.fn(), fetchStyleProfileSnapshot: jest.fn() }));

const rows = Array.from({ length: 278 }, (_, i) => ({
  id: `product-${String(i).padStart(3, '0')}`, provider: 'defacto', external_id: String(i),
  title: `Kadın Siyah ${i % 2 === 0 ? 'Bluz' : 'Pantolon'} ${i}`, brand: i % 5 === 0 ? null : ' DeFacto ',
  price: i % 3 === 0 ? '199,90' : 100, current_price: i % 4 === 0 ? '80.50' : null,
  previous_price: null, currency: 'TRY', image_url: 'https://example.com/fallback.jpg',
  images: i % 2 === 0 ? ['https://example.com/gallery.jpg', '', null] : [],
  product_url: 'https://example.com/product', affiliate_url: i % 2 === 0 ? 'https://example.com/affiliate' : null,
  category: i % 2 === 0 ? 'upper_body' : 'lower_body',
  colors: [{ name: 'Siyah', hex: '#000000' }, null], sizes: ['M', '', null],
  created_at: i === 277 ? null : '2026-09-01T00:00:00.000000Z',
}));
const attributes = rows.filter((_, i) => i % 3 === 0).map(row => ({ product_id: row.id, gender: 'women',
  colors: ['siyah'], fit: 'regular', subcategory: 'basic', brand_slug: 'defacto', price_band: 'mid', outfit_role: 'top' }));
const raw = { products: [...rows].reverse(), attributes: [...attributes].reverse() };

function backend() {
  const orders: unknown[][] = [];
  return { orders, from: (table: string) => {
    let excluded = new Set<string>();
    const query = {
      select: () => query,
      order: (...args: unknown[]) => { orders.push(args); return query; },
      not: (_column: string, _operator: string, value: string) => {
        excluded = new Set(value.match(/product-\d+/g) ?? []); return query;
      },
      in: (_column: string, ids: string[]) => Promise.resolve({ data: attributes.filter(row => ids.includes(row.product_id)), error: null }),
      range: (start: number, end: number) => {
        expect(table).toBe('products');
        // Fixture is independently in the server's created_at / id order.
        return Promise.resolve({ data: rows.filter(row => !excluded.has(row.id)).slice(start, end + 1), error: null });
      },
    };
    return query;
  } };
}

describe('offline Discover recommendation import snapshot', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());
  it('matches Discover candidate pool and all 278 paginated mapped anchors including undefined fields', async () => {
    const client = backend(); jest.mocked(getSupabaseClient).mockReturnValue(client as never);
    const snapshot = createDiscoverImportSnapshot(raw);
    const pool = await fetchRecommendationCatalog();
    expect(snapshot.candidatePool).toHaveLength(80);
    expect(snapshot.candidatePool).toStrictEqual(pool);
    expect(fingerprint(snapshot.candidatePool)).toBe(fingerprint(pool));
    expect(client.orders).toEqual([['created_at', { ascending: true }], ['id']]);
    const anchors: Product[] = [];
    let more = true;
    while (more) {
      const page = await fetchFeedProducts(20, null, 'personal', {}, undefined, anchors.map(product => product.id));
      anchors.push(...page.products); more = page.hasMore === true;
    }
    expect(anchors).toHaveLength(278); expect(new Set(anchors.map(product => product.id)).size).toBe(278);
    expect(snapshot.anchors).toStrictEqual(anchors);
    expect(snapshot.anchors[0]).toHaveProperty('previousPrice', undefined);
    const filtered = await fetchFeedProducts(20, null, 'personal', { category: 'lower_body' });
    expect(filtered.products.map(product => product.id)).toEqual(rows.filter(row => row.category === 'lower_body').slice(0, 20).map(row => row.id));
  });
  it('has stable bytes, order and fingerprints after reordered raw exports and lossless JSON roundtrip', () => {
    const first = createDiscoverImportSnapshot(raw);
    const second = createDiscoverImportSnapshot({ products: rows, attributes });
    expect(serializeDiscoverImportSnapshot(first)).toBe(serializeDiscoverImportSnapshot(second));
    const restored = parseRecommendationCliSnapshot<ImportPreparationInput>(serializeDiscoverImportSnapshot(first));
    expect(restored).toStrictEqual(first); expect(fingerprint(restored)).toBe(fingerprint(first));
    const context = (value: ImportPreparationInput) => worker.createAnchorCacheContext({
      ...value, anchor: value.anchors[0], wardrobeItems: [],
    });
    expect(createFinalCacheKey(context(restored))).toStrictEqual(createFinalCacheKey(context(first)));
    expect(parseRecommendationCliSnapshot(JSON.stringify({ anchors: [], candidatePool: [] }))).toEqual({ anchors: [], candidatePool: [] });
  });
  it('preserves PostgreSQL microsecond timestamp order, equivalent offsets, id ties and nulls last', () => {
    const products = rows.map(row => ({ ...row }));
    products[0].created_at = '2026-09-01T00:00:00.000002Z';
    products[1].created_at = '2026-09-01T03:00:00.000001+03:00';
    const snapshot = createDiscoverImportSnapshot({ products, attributes });
    expect(snapshot.anchors.slice(-3).map(product => product.id)).toEqual([rows[1].id, rows[0].id, rows[277].id]);
    expect(snapshot.anchors.slice(0, 2).map(product => product.id)).toEqual([rows[2].id, rows[3].id]);
  });
  it('rejects incomplete, duplicate, unsupported or invalid ordering exports instead of producing a different pool', () => {
    expect(() => createDiscoverImportSnapshot({ ...raw, products: rows.slice(0, 277) })).toThrow('278');
    expect(() => createDiscoverImportSnapshot({ ...raw, products: [rows[0], ...rows.slice(0, 277)] })).toThrow('unique');
    expect(() => createDiscoverImportSnapshot({ ...raw, products: [{ ...rows[0], provider: 'unsupported' }, ...rows.slice(1)] })).toThrow('Unsupported');
    expect(() => createDiscoverImportSnapshot({ ...raw, products: [{ ...rows[0], created_at: 'invalid' }, ...rows.slice(1)] })).toThrow('created_at');
    expect(() => createDiscoverImportSnapshot({ ...raw, attributes: [attributes[0], attributes[0]] })).toThrow('duplicate');
    expect(() => parseRecommendationCliSnapshot('{"format":"wrong","snapshot":"[]"}')).toThrow('format');
  });
  it('generates snapshot.json offline and hands the exact 278/80 snapshot to the existing import CLI', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-import-'));
    try {
      const input = path.join(directory, 'raw.json'), output = path.join(directory, 'snapshot.json'), next = path.join(directory, 'again.json');
      await fs.writeFile(input, JSON.stringify(raw));
      const first = await runRecommendationSnapshotCli(['--input', input, '--output', output]);
      const second = await runRecommendationSnapshotCli(['--input', input, '--output', next]);
      expect(first).toEqual(second); expect(first).toMatchObject({ anchors: 278, candidatePool: 80 });
      expect(await fs.readFile(output, 'utf8')).toBe(await fs.readFile(next, 'utf8'));
      const precompute = jest.spyOn(worker, 'precomputeImportRecommendations').mockResolvedValue({
        anchors: 278, completed: 278, rankingHits: 0, rankingMisses: 278, finalHits: 0, finalMisses: 278, emptyResults: 0,
      });
      await runRecommendationCacheCli(['--input', output, '--cache-dir', path.join(directory, 'cache'), '--mode', 'import']);
      expect(precompute).toHaveBeenCalledTimes(1);
      expect(precompute.mock.calls[0][1]).toStrictEqual(createDiscoverImportSnapshot(raw));
      expect(getSupabaseClient).not.toHaveBeenCalled();
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
