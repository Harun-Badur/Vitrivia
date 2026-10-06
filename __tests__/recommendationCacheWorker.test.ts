import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import catalogFixture from './fixtures/recommendation-catalog.snapshot.json';
import type { Product } from '../types/product';
import * as engine from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { createFinalCacheKey } from '../src/recommendationCache/fingerprint';
import { hydrateFinal } from '../src/recommendationCache/codec';
import { FileRecommendationRecordStore, RecommendationCacheWorker, createAnchorCacheContext,
  precomputeImportRecommendations, type RecommendationRecordStore } from '../scripts/lib/recommendationCacheWorker';

function memoryRecords() {
  const records = new Map<string, string>();
  const store: RecommendationRecordStore = { read: jest.fn(async key => records.get(key.fingerprint)),
    write: jest.fn(async (key, value) => { records.set(key.fingerprint, value); }) };
  return { records, store };
}
const product = (id: string, role: Product['outfitRole']): Product => ({ id, title: id, imageUrl: `${id}.jpg`,
  price: 100, brand: 'Brand', garmentDescription: id, category: role === 'top' ? 'upper_body' : role === 'bottom' ? 'lower_body' : 'bags',
  outfitRole: role });
const pool = [product('top', 'top'), product('bottom', 'bottom'),
  ...Array.from({ length: 78 }, (_, index) => product(`bag-${index}`, 'bag'))];
const anchor = pool[0];
const base = () => createAnchorCacheContext({ candidatePool: pool, anchor, wardrobeItems: [], catalogVersion: 'v1' });

describe('Node recommendation cache worker', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['top', 'bottom', 'shoes'])('preserves 12 reference contexts for %s, including persisted outputs and snapshot references', async role => {
    const catalog = catalogFixture as Product[];
    expect(catalog).toHaveLength(80);
    const required = catalog.find(item => item.outfitRole === role)!;
    const owned = ['top', 'bottom', 'shoes'].map((category, index) => ({ id: `owned-${category}`, category,
      color: ['black', 'white', 'beige'][index], style_tags: ['casual'] }));
    const { store } = memoryRecords();
    const worker = new RecommendationCacheWorker(store);
    const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
    const complete = jest.spyOn(engine, 'completeDiscoverRecommendationsAsync');
    let comparisons = 0;
    const preparedFinalKeys = new Set<string>();
    for (const wardrobeItems of [[], owned]) {
      const first = createAnchorCacheContext({ candidatePool: catalog, anchor: required, wardrobeItems });
      const initial = engine.getDiscoverRecommendations(first.input)[0]?.displayProducts ?? [];
      for (const count of [0, 1, 2, 5, 10, 100]) {
        const context = createAnchorCacheContext({ candidatePool: catalog, anchor: required, wardrobeItems,
          exposure: new Map(initial.map(item => [item.id, count])) });
        const expected = engine.getDiscoverRecommendations(context.input);
        const finalFingerprint = createFinalCacheKey(context).fingerprint;
        const alreadyPrepared = preparedFinalKeys.has(finalFingerprint);
        const outcome = await worker.prepare(context, { budgetMs: 1_000_000 });
        // Explicit age filtering can leave no catalog complements: changing
        // exposure over an empty list reuses the same final key, correctly a hit.
        expect(outcome.final).toBe(alreadyPrepared ? 'hit' : 'miss');
        expect(outcome.ranking).toBe(alreadyPrepared ? 'not-read' : count === 0 ? 'miss' : 'hit');
        preparedFinalKeys.add(finalFingerprint);
        expect(outcome.result).toStrictEqual(expected);
        const persisted = await store.read(createFinalCacheKey(context));
        const hit = hydrateFinal(persisted!, context);
        expect(hit.status).toBe('hit');
        if (hit.status !== 'hit') throw new Error('Invalid worker record');
        expect(hit.value).toStrictEqual(expected);
        for (const entry of hit.value) {
          for (const selected of entry.displayProducts ?? []) {
            expect(selected).toBe(context.input.catalogProducts.find(item => item.id === selected.id));
            expect(entry.candidate.items.some(item => item.sourceType === 'catalog' && item.product === selected)).toBe(true);
          }
        }
        expect((await worker.prepare(context)).final).toBe('hit');
        comparisons++;
      }
    }
    expect(comparisons).toBe(12);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(preparedFinalKeys.size);
  }, 120_000);

  it('returns cached valid empty results without treating them as misses', async () => {
    const { store } = memoryRecords();
    const worker = new RecommendationCacheWorker(store);
    const context = createAnchorCacheContext({ candidatePool: pool, anchor: product('unknown', undefined), wardrobeItems: [] });
    const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
    const complete = jest.spyOn(engine, 'completeDiscoverRecommendationsAsync');
    expect(await worker.prepare(context)).toMatchObject({ ranking: 'miss', final: 'miss', result: [] });
    expect(await worker.prepare(context)).toMatchObject({ ranking: 'not-read', final: 'hit', result: [] });
    expect(await new RecommendationCacheWorker(store).prepare(context)).toMatchObject({ final: 'hit', result: [] });
    expect(prepare).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
  });

  it('reuses persisted ranking after an exposure change or process restart and rebinds fresh objects', async () => {
    const { store } = memoryRecords();
    const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
    const complete = jest.spyOn(engine, 'completeDiscoverRecommendationsAsync');
    const worker = new RecommendationCacheWorker(store);
    const original = base();
    await worker.prepare(original);
    const catalogCopy = pool.map(item => ({ ...item }));
    const fresh = createAnchorCacheContext({ candidatePool: catalogCopy, anchor: catalogCopy[0], wardrobeItems: [],
      catalogVersion: 'v1', exposure: new Map([['bottom', 10]]) });
    const restarted = new RecommendationCacheWorker(store);
    const outcome = await restarted.prepare(fresh);
    expect(outcome).toMatchObject({ ranking: 'hit', final: 'miss' });
    expect(outcome.result).toStrictEqual(engine.getDiscoverRecommendations(fresh.input));
    const hotClone = createAnchorCacheContext({ candidatePool: pool, anchor, wardrobeItems: [], catalogVersion: 'v1',
      exposure: new Map([['bottom', 10]]) });
    const rebound = await restarted.prepare(hotClone);
    expect(rebound.final).toBe('hit');
    for (const entry of rebound.result) for (const item of entry.candidate.items) {
      if (item.sourceType === 'catalog') expect(item.product).toBe(pool.find(candidate => candidate.id === item.sourceId));
    }
    expect(prepare).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(2);
  });

  it.each(['wardrobe', 'catalog', 'anchor', 'engine', 'catalog-version'])('recomputes ranking when %s context changes', async changed => {
    const { store } = memoryRecords();
    const worker = new RecommendationCacheWorker(store);
    const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
    await worker.prepare(base());
    const altered = createAnchorCacheContext({ candidatePool: changed === 'catalog' ? pool.map((item, index) =>
      index === 1 ? { ...item, currentPrice: 50 } : item) : pool,
      anchor: changed === 'anchor' ? pool[1] : anchor,
      wardrobeItems: changed === 'wardrobe' ? [{ id: 'w', category: 'bottom', color: 'white' }] : [],
      engineVersion: changed === 'engine' ? 'v2' : undefined,
      catalogVersion: changed === 'catalog-version' ? 'v2' : 'v1' });
    const outcome = await worker.prepare(altered);
    expect(outcome).toMatchObject({ ranking: 'miss', final: 'miss' });
    expect(outcome.result).toStrictEqual(engine.getDiscoverRecommendations(altered.input));
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('rebuilds a corrupt final using valid ranking and does not persist errors as empty hits', async () => {
    const { store, records } = memoryRecords();
    const context = base();
    await new RecommendationCacheWorker(store).prepare(context);
    records.set(createFinalCacheKey(context).fingerprint, 'corrupt');
    const prepare = jest.spyOn(engine, 'prepareDiscoverRankingAsync');
    const complete = jest.spyOn(engine, 'completeDiscoverRecommendationsAsync').mockRejectedValueOnce(new Error('failed'));
    await expect(new RecommendationCacheWorker(store).prepare(context)).rejects.toThrow('failed');
    expect(records.get(createFinalCacheKey(context).fingerprint)).toBe('corrupt');
    expect(await new RecommendationCacheWorker(store).prepare(context)).toMatchObject({ ranking: 'hit', final: 'miss' });
    expect(prepare).not.toHaveBeenCalled(); expect(complete).toHaveBeenCalledTimes(2);
  });

  it('preserves anchor-first precedence and rejects expanded or duplicate candidate pools', () => {
    const differentAnchor = { ...anchor, currentPrice: 40 };
    const context = createAnchorCacheContext({ candidatePool: pool, anchor: differentAnchor, wardrobeItems: [] });
    expect(context.input.catalogProducts[0]).toBe(differentAnchor);
    expect(context.input.catalogProducts.slice(1)).toEqual(pool.slice(1));
    expect(context.input.catalogProducts).toHaveLength(80);
    const outside = createAnchorCacheContext({ candidatePool: pool, anchor: product('outside', 'bag'), wardrobeItems: [] });
    expect(outside.input.catalogProducts).toHaveLength(81);
    expect(outside.input.catalogProducts.slice(1)).toEqual(pool);
    expect(() => createAnchorCacheContext({ candidatePool: [...pool, product('extra', 'bag')], anchor, wardrobeItems: [] })).toThrow();
    expect(() => createAnchorCacheContext({ candidatePool: [anchor, anchor], anchor, wardrobeItems: [] })).toThrow();
  });

  it('honors cancellation before cache reads or computation', async () => {
    const { store } = memoryRecords();
    const controller = new AbortController(); controller.abort();
    await expect(new RecommendationCacheWorker(store).prepare(base(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.read).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled();
  });

  it('snapshots exposure counts before asynchronous cache reads', async () => {
    const { store } = memoryRecords();
    const exposure = new Map([['bottom', 1]]);
    const context = createAnchorCacheContext({ candidatePool: pool, anchor, wardrobeItems: [], exposure });
    const expected = engine.getDiscoverRecommendations(context.input);
    const read = store.read;
    store.read = async key => { exposure.set('bottom', 100); return read(key); };
    const outcome = await new RecommendationCacheWorker(store).prepare(context);
    expect(outcome.result).toStrictEqual(expected);
    const old = { ...context, input: { ...context.input, recommendationExposure: new Map([['bottom', 1]]) } };
    expect(hydrateFinal((await read(createFinalCacheKey(old)))!, old).status).toBe('hit');
    expect(await read(createFinalCacheKey(context))).toBeUndefined();
  });

  it('precomputes 278 anchors through the actual CLI and resumes with 278 final hits', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recommendation-worker-'));
    const anchors = [...pool, ...Array.from({ length: 198 }, (_, index) => product(`import-${index}`, 'bag'))];
    const source = path.join(directory, 'input.json'), cacheDirectory = path.join(directory, 'cache');
    const args = [require.resolve('tsx/cli'), path.resolve('scripts/prepareRecommendationCache.ts'),
      '--input', source, '--cache-dir', cacheDirectory, '--mode', 'import'];
    try {
      await fs.writeFile(source, JSON.stringify({ candidatePool: pool, anchors, catalogVersion: 'import-v1' }));
      const execute = promisify(execFile);
      const first = JSON.parse((await execute(process.execPath, args, { timeout: 120_000 })).stdout);
      expect(first).toMatchObject({ anchors: 278, completed: 278, rankingMisses: 278, finalMisses: 278, finalHits: 0 });
      expect(await fs.readdir(path.join(cacheDirectory, 'ranking'))).toHaveLength(278);
      expect(await fs.readdir(path.join(cacheDirectory, 'final'))).toHaveLength(278);
      const second = JSON.parse((await execute(process.execPath, args, { timeout: 120_000 })).stdout);
      expect(second).toMatchObject({ completed: 278, rankingMisses: 0, finalMisses: 0, finalHits: 278 });
      const records = new FileRecommendationRecordStore(cacheDirectory);
      // Every stored result, including outside-pool anchors, equals the real engine.
      for (const required of anchors) {
        const context = createAnchorCacheContext({ candidatePool: pool, anchor: required, wardrobeItems: [], catalogVersion: 'import-v1' });
        const record = await records.read(createFinalCacheKey(context));
        const hit = hydrateFinal(record!, context);
        expect(hit.status).toBe('hit');
        if (hit.status !== 'hit') throw new Error('Missing import result');
        expect(hit.value).toStrictEqual(engine.getDiscoverRecommendations(context.input));
      }
      const worker = new RecommendationCacheWorker(records);
      expect(await precomputeImportRecommendations(worker, { candidatePool: pool, anchors, catalogVersion: 'import-v1' }))
        .toMatchObject({ completed: 278, finalHits: 278, rankingMisses: 0 });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }, 180_000);
});
