import { readFile } from 'node:fs/promises';
import { isGarmentCategory, type Product } from '../types/product';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { SupabaseRecommendationRecordStore } from './lib/supabaseRecommendationCache';
import { parseRecommendationCliSnapshot } from './lib/discoverRecommendationSnapshot';
import type { WardrobeItemForCandidate } from '../src/intelligence/outfits/outfitCandidate';
import { FileRecommendationRecordStore, RecommendationCacheWorker, prepareAnchors,
  precomputeImportRecommendations, type PreparationReport } from './lib/recommendationCacheWorker';

interface InputSnapshot {
  candidatePool: Product[];
  anchors: Product[];
  wardrobeItems?: WardrobeItemForCandidate[];
  exposure?: [string, number][];
  catalogVersion?: string;
  engineVersion?: string;
}
function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false;
  const product = value as Product;
  return typeof product.id === 'string' && product.id.length > 0 && typeof product.title === 'string' &&
    typeof product.brand === 'string' && typeof product.imageUrl === 'string' &&
    typeof product.garmentDescription === 'string' && Number.isFinite(product.price) && isGarmentCategory(product.category);
}

export async function runRecommendationCacheCli(args: string[], signal?: AbortSignal): Promise<PreparationReport> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--input', '--cache-dir', '--mode', '--store', '--owner-id'].includes(args[index]) || !args[index + 1] || flags.has(args[index])) {
      throw new Error('Usage: npx tsx scripts/prepareRecommendationCache.ts --input snapshot.json --cache-dir output/cache --mode import|context');
    }
    flags.set(args[index], args[index + 1]);
  }
  const source = flags.get('--input'), directory = flags.get('--cache-dir'), mode = flags.get('--mode') ?? 'import';
  const destination = flags.get('--store') ?? 'file';
  if (!source || (destination === 'file' && !directory) || !['file', 'supabase'].includes(destination) || !['import', 'context'].includes(mode)) throw new Error('Required: --input, --cache-dir for file store; mode: import|context');
  const snapshot = parseRecommendationCliSnapshot<InputSnapshot>(await readFile(source, 'utf8'));
  if (!snapshot || !Array.isArray(snapshot.candidatePool) || snapshot.candidatePool.length > 80 ||
    !snapshot.candidatePool.every(isProduct) || !Array.isArray(snapshot.anchors) || !snapshot.anchors.every(isProduct)) {
    throw new Error('Provide mapped Product snapshots: candidatePool (at most 80) and anchors. Raw import rows are not accepted.');
  }
  if ((snapshot.catalogVersion !== undefined && typeof snapshot.catalogVersion !== 'string') ||
    (snapshot.engineVersion !== undefined && typeof snapshot.engineVersion !== 'string') ||
    (snapshot.wardrobeItems !== undefined && (!Array.isArray(snapshot.wardrobeItems) || snapshot.wardrobeItems.some(item =>
      !item || typeof item.id !== 'string' || typeof item.category !== 'string'))) ||
    (snapshot.exposure !== undefined && (!Array.isArray(snapshot.exposure) || snapshot.exposure.some(entry =>
      !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'number' || !Number.isFinite(entry[1]) || entry[1] < 0)))) {
    throw new Error('Invalid context snapshot');
  }
  if (mode === 'import' && ((snapshot.wardrobeItems?.length ?? 0) > 0 || (snapshot.exposure?.length ?? 0) > 0)) {
    throw new Error('Import mode requires empty wardrobe and exposure; use context mode for user snapshots');
  }
  if (new Set(snapshot.exposure?.map(([id]) => id)).size !== (snapshot.exposure?.length ?? 0)) throw new Error('Duplicate exposure ID');
  config({ quiet: true });
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (destination === 'supabase' && (!url || !key)) throw new Error('Existing Supabase URL/service-role credentials required');
  const worker = new RecommendationCacheWorker(destination === 'file' ? new FileRecommendationRecordStore(directory!) :
    new SupabaseRecommendationRecordStore(createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } }), flags.get('--owner-id') ?? null));
  const options = { signal };
  return mode === 'import' ? precomputeImportRecommendations(worker, snapshot, options) :
    prepareAnchors(worker, { ...snapshot, wardrobeItems: snapshot.wardrobeItems ?? [],
      exposure: snapshot.exposure === undefined ? undefined : new Map(snapshot.exposure) }, options);
}

if (require.main === module) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  runRecommendationCacheCli(process.argv.slice(2), controller.signal)
    .then(report => console.log(JSON.stringify(report)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
