import fs from 'fs';
import path from 'path';
import type { Product } from '../types/product';
import { RankingPreparationCache } from '../src/intelligence/recommendations/rankingPreparationCache';
import { prepareDiscoverRankingAsync, completeDiscoverRecommendationsAsync,
  getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import * as ranking from '../src/intelligence/outfits/rankOutfitCandidates';
import { runCooperatively } from '../src/intelligence/cooperativeWork';

const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(__dirname,
  'fixtures/recommendation-catalog.snapshot.json'), 'utf8'));

describe('exposure-independent ranking preparation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts current/next/warm without a predecessor dependency and reuses promoted promises', async () => {
    const cache = new RankingPreparationCache<object, number>();
    const products = Array.from({ length: 12 }, () => ({}));
    const signals = new Map<object, AbortSignal>();
    const finishes = new Map<object, (value: number) => void>();
    const prepare = jest.fn((product: object, signal: AbortSignal) => new Promise<number>(resolve => {
      signals.set(product, signal);
      finishes.set(product, resolve);
    }));
    const get = (product: object) => cache.get(product, signal => prepare(product, signal));
    for (let index = 0; index < 10; index++) {
      const window = products.slice(index, index + 3);
      cache.retainPending(window);
      const jobs = window.map(get);
      expect(get(window[0])).toBe(jobs[0]);
      expect(signals.get(window[0])?.aborted).toBe(false);
      // All three started even though none has completed yet.
      expect(prepare.mock.calls.length).toBe(index + 3);
      finishes.get(window[0])!(index);
      expect(await jobs[0]).toBe(index);
    }
    expect(prepare).toHaveBeenCalledTimes(12); // 12 misses; promotions are hits.
    expect(await get(products[0])).toBe(0); // Undo uses the completed pool.
    expect(prepare).toHaveBeenCalledTimes(12);
    cache.cancelPending();
    expect(signals.get(products[10])?.aborted).toBe(true);
    expect(signals.get(products[11])?.aborted).toBe(true);
    expect(signals.get(products[9])?.aborted).toBe(false);
  });

  it('pauses off-window work without aborting and cancels it only on blur/session invalidation', async () => {
    const cache = new RankingPreparationCache<object, number>();
    const a = {}, b = {};
    const signals: AbortSignal[] = [];
    const prepare = (signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<number>((resolve, reject) => signal.addEventListener('abort',
        () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))));
    };
    const old = cache.get(a, prepare);
    cache.retainPending([b]);
    expect(cache.get(a, prepare)).toBe(old);
    expect(signals[0].aborted).toBe(false);
    let resumed = false;
    const turn = cache.waitForTurn(a, signals[0]).then(() => { resumed = true; });
    await Promise.resolve();
    expect(resumed).toBe(false);
    cache.retainPending([a]);
    await turn;
    expect(resumed).toBe(true);
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    cache.cancelPending();
    await rejected;
    const fresh = cache.get(a, async () => 7);
    expect(fresh).not.toBe(old);
    expect(await fresh).toBe(7);
    const otherSession = new RankingPreparationCache<object, number>();
    expect(await otherSession.get(a, async () => 42)).toBe(42);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it.each(['top', 'bottom', 'shoes'])('reuses %s ranking across exposure changes with identical full results', async role => {
    const anchor = catalog.find(product => product.outfitRole === role)!;
    const calls = jest.spyOn(ranking, 'rankDiversityCandidatesAsync');
    const owned = ['top', 'bottom', 'shoes'].map((category, index) => ({
      id: `owned-${category}`, category, color: ['black', 'white', 'beige'][index], style_tags: ['casual'],
    }));
    for (const wardrobeItems of [[], owned]) {
      const input = { catalogProducts: catalog, wardrobeItems, requiredCatalogProductId: anchor.id, firstOnly: true };
      const prepared = await prepareDiscoverRankingAsync(input, { budgetMs: 1_000_000 });
      const original = getDiscoverRecommendations(input)[0]?.displayProducts ?? [];
      for (const count of [0, 1, 2, 5, 10, 100]) {
        const exposure = new Map(original.map(product => [product.id, count]));
        expect(await completeDiscoverRecommendationsAsync(prepared, exposure, { budgetMs: 1_000_000 }))
          .toEqual(getDiscoverRecommendations({ ...input, recommendationExposure: exposure }));
      }
    }
    expect(calls).toHaveBeenCalledTimes(2); // Twelve diversity selections, only two base preparations.
  }, 120_000);

  it('runs background slices before active completion and raises priority on promotion', async () => {
    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => ++clock);
    let active = 'a';
    const visits = { a: 0, b: 0, c: 0 };
    const budgets = { a: [] as number[], b: [] as number[], c: [] as number[] };
    const jobs = (['a', 'b', 'c'] as const).map(id => {
      function* work(): Generator<void, number, void> {
        for (; visits[id] < 100; visits[id]++) yield;
        return visits[id];
      }
      return runCooperatively(work(), { sliceBudgetMs: () => {
        const budget = active === id ? 4 : 1;
        budgets[id].push(budget);
        return budget;
      } });
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(visits.b).toBeGreaterThanOrEqual(0);
    expect(budgets.b).toContain(1);
    expect(visits.a).toBeLessThan(100);
    active = 'b';
    await Promise.all(jobs);
    expect(budgets.b).toContain(4);
    expect(visits).toEqual({ a: 100, b: 100, c: 100 });
  });
});
