import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Product } from '../../types/product';
import type { WardrobeItemForCandidate } from '../../src/intelligence/outfits/outfitCandidate';
import { prepareDiscoverRankingAsync, completeDiscoverRecommendationsAsync } from '../../src/intelligence/recommendations/getDiscoverRecommendations';
import type { CooperativeWorkOptions } from '../../src/intelligence/cooperativeWork';
import type { OutfitDiscoverRecommendation } from '../../src/intelligence/recommendations/discoverRecommendation';
import { createFinalCacheKey, createRankingCacheKey, type CacheContext, type RecommendationCacheKey } from '../../src/recommendationCache/fingerprint';
import { hydrateFinal, hydrateRanking, serializeFinal, serializeRanking } from '../../src/recommendationCache/codec';
import { RecommendationMemoryCache } from '../../src/recommendationCache/memoryCache';

export interface RecommendationRecordStore {
  read(key: RecommendationCacheKey): Promise<string | undefined>;
  write(key: RecommendationCacheKey, serialized: string): Promise<void>;
}

/** Local files only. The codec still verifies the full canonical key on reads. */
export class FileRecommendationRecordStore implements RecommendationRecordStore {
  private readonly root: string;
  constructor(directory: string) { this.root = path.resolve(directory); }
  private file(key: RecommendationCacheKey): string {
    const digest = createHash('sha256').update(key.fingerprint).digest('hex');
    return path.join(this.root, key.kind, `${digest}.json`);
  }
  async read(key: RecommendationCacheKey): Promise<string | undefined> {
    try { return await readFile(this.file(key), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async write(key: RecommendationCacheKey, serialized: string): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, serialized, 'utf8');
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  }
}

interface Binding {
  catalog: readonly Product[];
  wardrobe: readonly WardrobeItemForCandidate[];
}
export interface WorkerResult<T extends WardrobeItemForCandidate> {
  result: readonly OutfitDiscoverRecommendation<T>[];
  ranking: 'hit' | 'miss' | 'not-read';
  final: 'hit' | 'miss';
}

/** Run in a separate Node process, never import this into an app/render path. */
export class RecommendationCacheWorker<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> {
  private readonly memory: RecommendationMemoryCache<T>;
  private readonly bindings = new WeakMap<object, Binding>();
  // Import sweeps need not retain 278 potentially large ranking pools in RAM.
  constructor(private readonly records: RecommendationRecordStore, hotCapacityPerKind = 1) {
    this.memory = new RecommendationMemoryCache<T>(hotCapacityPerKind);
  }

  private bind(value: object, context: CacheContext<T>): void {
    this.bindings.set(value, { catalog: [...context.input.catalogProducts], wardrobe: [...context.input.wardrobeItems] });
  }
  private sameObjects(value: object, context: CacheContext<T>): boolean {
    const binding = this.bindings.get(value);
    return !!binding && binding.catalog.length === context.input.catalogProducts.length &&
      binding.wardrobe.length === context.input.wardrobeItems.length &&
      binding.catalog.every((product, index) => product === context.input.catalogProducts[index]) &&
      binding.wardrobe.every((item, index) => item === context.input.wardrobeItems[index]);
  }

  async prepare(context: CacheContext<T>, options?: CooperativeWorkOptions): Promise<WorkerResult<T>> {
    if (options?.signal?.aborted) throw Object.assign(new Error('Work cancelled'), { name: 'AbortError' });
    // Exposure can advance while disk I/O is pending. Bind this job to the exact
    // requested counts; preserve the caller's canonical product/wardrobe objects.
    context = { ...context, input: { ...context.input,
      catalogProducts: [...context.input.catalogProducts], wardrobeItems: [...context.input.wardrobeItems],
      recommendationExposure: context.input.recommendationExposure === undefined ? undefined :
        new Map(context.input.recommendationExposure) } };
    const finalKey = createFinalCacheKey(context);
    const hotFinal = this.memory.getFinal(finalKey);
    if (hotFinal.status === 'hit' && this.sameObjects(hotFinal.value, context)) {
      return { result: hotFinal.value, ranking: 'not-read', final: 'hit' };
    }
    const finalRecord = await this.records.read(finalKey);
    if (finalRecord !== undefined) {
      const restored = hydrateFinal(finalRecord, context);
      if (restored.status === 'hit') {
        this.memory.setFinal(finalKey, restored.value);
        this.bind(restored.value, context);
        return { result: restored.value, ranking: 'not-read', final: 'hit' };
      }
    }

    const rankingKey = createRankingCacheKey(context);
    const hotRanking = this.memory.getRanking(rankingKey);
    let prepared = hotRanking.status === 'hit' && this.sameObjects(hotRanking.value, context) ? hotRanking.value : undefined;
    if (!prepared) {
      const record = await this.records.read(rankingKey);
      if (record !== undefined) {
        const restored = hydrateRanking(record, context);
        if (restored.status === 'hit') prepared = restored.value;
      }
    }
    const ranking = prepared ? 'hit' : 'miss';
    if (!prepared) {
      prepared = await prepareDiscoverRankingAsync(context.input, options);
      await this.records.write(rankingKey, serializeRanking(prepared, context));
    }
    this.memory.setRanking(rankingKey, prepared);
    this.bind(prepared, context);
    const result = await completeDiscoverRecommendationsAsync(prepared, context.input.recommendationExposure, options);
    await this.records.write(finalKey, serializeFinal(result, context));
    this.memory.setFinal(finalKey, result);
    this.bind(result, context);
    return { result, ranking, final: 'miss' };
  }
}

export interface AnchorPreparationInput<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> {
  candidatePool: readonly Product[];
  anchor: Product;
  wardrobeItems: readonly T[];
  exposure?: ReadonlyMap<string, number>;
  catalogVersion?: string;
  engineVersion?: string;
}

export function createAnchorCacheContext<T extends WardrobeItemForCandidate>(input: AnchorPreparationInput<T>): CacheContext<T> {
  if (input.candidatePool.length > 80) throw new RangeError('Recommendation candidate pool must not exceed 80 products');
  if (new Set(input.candidatePool.map(product => product.id)).size !== input.candidatePool.length) throw new TypeError('Duplicate candidate pool ID');
  return { catalogVersion: input.catalogVersion, engineVersion: input.engineVersion,
    input: { catalogProducts: [input.anchor, ...input.candidatePool.filter(product => product.id !== input.anchor.id)],
      wardrobeItems: input.wardrobeItems, requiredCatalogProductId: input.anchor.id,
      firstOnly: true, recommendationExposure: input.exposure } };
}

export interface ImportPreparationInput {
  candidatePool: readonly Product[];
  anchors: readonly Product[];
  catalogVersion?: string;
  engineVersion?: string;
}
export interface PreparationReport {
  anchors: number;
  completed: number;
  rankingHits: number;
  rankingMisses: number;
  finalHits: number;
  finalMisses: number;
  emptyResults: number;
}

/** Import-time results are independent zero-exposure contexts, not a predicted feed. */
export async function prepareAnchors<T extends WardrobeItemForCandidate>(worker: RecommendationCacheWorker<T>,
  input: ImportPreparationInput & { wardrobeItems: readonly T[]; exposure?: ReadonlyMap<string, number> },
  options?: CooperativeWorkOptions): Promise<PreparationReport> {
  if (new Set(input.anchors.map(anchor => anchor.id)).size !== input.anchors.length) throw new TypeError('Duplicate anchor ID');
  const report: PreparationReport = { anchors: input.anchors.length, completed: 0,
    rankingHits: 0, rankingMisses: 0, finalHits: 0, finalMisses: 0, emptyResults: 0 };
  for (const anchor of input.anchors) {
    const outcome = await worker.prepare(createAnchorCacheContext({ ...input, anchor }), options);
    report.completed++;
    if (outcome.ranking === 'hit') report.rankingHits++;
    if (outcome.ranking === 'miss') report.rankingMisses++;
    if (outcome.final === 'hit') report.finalHits++; else report.finalMisses++;
    if (outcome.result.length === 0) report.emptyResults++;
  }
  return report;
}

export function precomputeImportRecommendations<T extends WardrobeItemForCandidate>(worker: RecommendationCacheWorker<T>, input: ImportPreparationInput,
  options?: CooperativeWorkOptions): Promise<PreparationReport> {
  return prepareAnchors(worker, { ...input, wardrobeItems: [] }, options);
}
