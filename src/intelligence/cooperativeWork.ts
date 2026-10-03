import { withRecommendationMemo, type RecommendationMemo } from '../../lib/recommendationMemo';

export interface CooperativeWorkOptions {
  signal?: AbortSignal;
  /** Bound each JS work slice, rather than merely delaying a single large callback. */
  budgetMs?: number;
  /** Re-read priority between slices when a prepared product becomes active. */
  sliceBudgetMs?: () => number;
  /** Pause off-window preparation without discarding its generator/promise. */
  waitForTurn?: () => Promise<void>;
  recommendationMemo?: RecommendationMemo;
}

const aborted = (): Error => Object.assign(new Error('Work cancelled'), { name: 'AbortError' });
const checkAbort = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw aborted();
};

const yieldToHost = (signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  checkAbort(signal);
  const onAbort = (): void => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    reject(aborted());
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, 0);
  signal?.addEventListener('abort', onAbort, { once: true });
});

export const runSynchronously = <T>(work: Generator<void, T, void>): T => {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
};

export const runCooperatively = async <T>(
  work: Generator<void, T, void>, options: CooperativeWorkOptions = {},
): Promise<T> => {
  const { signal } = options;

  await yieldToHost(signal);
  for (;;) {
    if (options.waitForTurn) await options.waitForTurn();
    checkAbort(signal);
    const budget = Math.max(1, options.sliceBudgetMs?.() ?? options.budgetMs ?? 4);
    const started = performance.now();
    for (;;) {
      const step = withRecommendationMemo(options.recommendationMemo, () => work.next());
      if (step.done) return step.value;
      // Check frequently, including during candidate generation and merge sorting.
      if (performance.now() - started >= budget) break;
    }
    await yieldToHost(signal);
  }
};

/** Stable ordering, including comparator ties, with checkpoints inside the sort. */
export function* cooperativeSort<T>(
  values: T[], compare: (left: T, right: T) => number,
): Generator<void, T[], void> {
  let source = values;
  let target = new Array<T>(values.length);
  for (let width = 1; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += width * 2) {
      const middle = Math.min(start + width, values.length);
      const end = Math.min(start + width * 2, values.length);
      let left = start, right = middle;
      for (let index = start; index < end; index++) {
        target[index] = left < middle && (right >= end || compare(source[left], source[right]) <= 0)
          ? source[left++] : source[right++];
        yield;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}
