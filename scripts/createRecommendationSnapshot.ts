import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import { createDiscoverImportSnapshot, serializeDiscoverImportSnapshot } from './lib/discoverRecommendationSnapshot';
import { fingerprint } from '../src/recommendationCache/fingerprint';

export async function runRecommendationSnapshotCli(args: string[]): Promise<{
  anchors: number; candidatePool: number; fingerprint: string;
}> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--input', '--output', '--catalog-version'].includes(args[index]) || !args[index + 1] || flags.has(args[index])) {
      throw new Error('Usage: npx tsx scripts/createRecommendationSnapshot.ts --input raw-catalog.json --output snapshot.json [--catalog-version VERSION]');
    }
    flags.set(args[index], args[index + 1]);
  }
  const source = flags.get('--input'), destination = flags.get('--output');
  if (!source || !destination) throw new Error('Required: --input raw-catalog.json --output snapshot.json');
  config({ quiet: true }); // Same affiliate mapping settings as Discover; no Supabase client.
  const snapshot = createDiscoverImportSnapshot(JSON.parse(await readFile(source, 'utf8')), flags.get('--catalog-version'));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, serializeDiscoverImportSnapshot(snapshot) + '\n', { flag: 'wx' });
  return { anchors: snapshot.anchors.length, candidatePool: snapshot.candidatePool.length,
    fingerprint: createHash('sha256').update(fingerprint(snapshot)).digest('hex') };
}

if (require.main === module) {
  runRecommendationSnapshotCli(process.argv.slice(2)).then(report => console.log(JSON.stringify(report)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
