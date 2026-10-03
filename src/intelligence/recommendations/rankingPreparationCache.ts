/** Owned by one catalog/wardrobe/user session; exposure deliberately is not a key. */
export class RankingPreparationCache<K extends object, V> {
  private entries = new Map<K, { promise: Promise<V>; controller: AbortController; ready: boolean }>();
  private window: ReadonlySet<K> | null = null;
  private waiting = new Map<K, Set<() => void>>();

  get(key: K, prepare: (signal: AbortSignal) => Promise<V>): Promise<V> {
    const existing = this.entries.get(key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const entry = { controller, ready: false, promise: null as unknown as Promise<V> };
    entry.promise = prepare(controller.signal).then(value => {
      entry.ready = true;
      return value;
    }).catch(error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }

  cancelPending(): void {
    for (const [key, entry] of this.entries) {
      if (!entry.ready) {
        entry.controller.abort();
        this.entries.delete(key);
      }
    }
  }

  /** Swipes pause off-window work; promotion/undo resumes the original promise. */
  retainPending(keys: readonly K[]): void {
    this.window = new Set(keys);
    for (const key of keys) {
      for (const resume of this.waiting.get(key) ?? []) resume();
    }
  }

  waitForTurn(key: K, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(Object.assign(new Error('Work cancelled'), { name: 'AbortError' }));
    if (this.window === null || this.window.has(key)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        const waiting = this.waiting.get(key);
        waiting?.delete(resume);
        if (waiting?.size === 0) this.waiting.delete(key);
      };
      const resume = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(Object.assign(new Error('Work cancelled'), { name: 'AbortError' })); };
      const waiting = this.waiting.get(key) ?? new Set();
      waiting.add(resume);
      this.waiting.set(key, waiting);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
