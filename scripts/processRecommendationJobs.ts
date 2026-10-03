import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { processRecommendationJob } from './lib/supabaseRecommendationCache';

async function main(): Promise<void> {
  config({ quiet: true });
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Existing Supabase URL and service-role credentials are required');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const watch = process.argv.includes('--watch');
  do {
    const worked = await processRecommendationJob(client);
    if (!watch && !worked) break;
    if (watch && !worked) await new Promise(resolve => setTimeout(resolve, 1000));
  } while (watch);
}
if (require.main === module) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
