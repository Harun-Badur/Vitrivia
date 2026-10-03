# Recommendation cache foundation (stage 1)

The fingerprint, codec and memory cache foundation never calls an engine function,
performs network I/O or schedules preparation. Stage 3 connects ready packets to
Discover through separate consumers without changing feed selection or Style Intelligence.

- Pass the exact engine input to key creation and serialization. The existing
  80-product pool and anchor precedence belong to the caller; nothing is sampled,
  expanded or reordered here.
- Keys are versioned, collision-free canonical snapshot strings, not shortened
  hashes. Full product/wardrobe snapshots conservatively invalidate even display
  metadata changes. Exposure affects final keys only; map insertion order does not.
- Bump `RECOMMENDATION_ENGINE_VERSION` when engine rules or normalization change.
  Supply `catalogVersion` when a catalog revision is available. Rebuild keys whenever
  their input snapshots change; do not mutate snapshots or cached values in place.
- Prepare fingerprints, decode and hydrate outside the gesture/render path. Memory
  reads use an already prepared key and return the exact stored object reference.
- Serialize ranking and final outputs separately. The graph codec retains array
  order, optional undefined fields and shared references. Hydration requires the
  same-version canonical input snapshots and binds catalog/wardrobe references to
  those objects. It does not infer missing products or truncate ranking pools.
- Ranking hydration recreates an empty per-computation memo. Process-local memo
  maps are not persisted; this changes no recommendation result.
- `hit` with an empty array is a valid engine result. Missing, incompatible or
  damaged records return `miss`; there is no calculation or network fallback.
- The memory cache has independent bounded LRU stores for ranking/final results.
  Its owner must isolate users/sessions, clear on lifecycle invalidation, and retain
  any already-shown undo results separately according to existing exposure rules.

Payload integrity detects accidental corruption; it is not authentication.

## Stage 2: separate Node worker / CLI

`scripts/lib/recommendationCacheWorker.ts` uses this foundation and the unchanged
engine. It persists codec records to local files, retains bounded hot memory, and
hydrates disk hits against the current canonical snapshot objects. A final hit calls
neither engine phase. Changed exposure reuses the ranking and runs only completion;
changed catalog, wardrobe, anchor or engine version selects a different ranking key.
The worker retains one hot ranking/final by default (configurable), so an import
sweep does not accumulate all 278 ranking pools in RAM. Exposure counts are copied
at job entry; product and wardrobe snapshots must remain immutable during the job.

Run after a successful import, using a JSON snapshot with `candidatePool` (the exact
existing first 80 mapped Products, in their existing order), `anchors` (all 278 mapped
Products), and optionally `catalogVersion` / `engineVersion`:

    npx tsx scripts/prepareRecommendationCache.ts --input snapshot.json --cache-dir output/recommendation-cache --mode import

To produce that snapshot offline from an existing raw catalog export with
`products` and `attributes` arrays, run:

    npx tsx scripts/createRecommendationSnapshot.ts --input raw-catalog.json --output snapshot.json

The exporter uses the same row mapper and enrichment as productService, orders by
`created_at` then `id` (including microseconds and nulls last), requires exactly 278
unique supported anchors, and takes the existing first 80 as the candidate pool.
It performs no Supabase/network operations. Use the same affiliate mapping settings
as the app and a complete, consistent export of both tables. Optional
`--catalog-version VERSION` labels the snapshot. It refuses to overwrite output.
The versioned JSON envelope preserves explicit undefined Product fields so CLI
fingerprints exactly match Discover; ordinary legacy CLI JSON remains supported.
The CLI itself accepts the generated file directly with `--mode import`.

For a user context, supply `wardrobeItems` and optionally `exposure` as `[productId,
count]` pairs, using `--mode context`. Import mode rejects nonempty user context.
No database requests or raw-row conversion are performed. The caller must export
the same enriched Product snapshots used by Discover, not reconstruct a differently
sorted pool from raw import rows. Anchor-first precedence matches existing Discover.

Each anchor is prepared independently with the supplied exposure; the worker does
not simulate swipes, increment exposure or change feed order. Work is sequential.
Completed records survive interruption, so rerunning the command resumes via hits.
Writes are atomic. An invalid codec record is a worker miss and is regenerated.
Errors are propagated; an engine/storage failure is never persisted as an empty hit.
The CLI is the separate background process; nothing starts from the application.

## Stage 3: Supabase / Discover

Apply `supabase/migrations/20260929_discover_recommendation_cache.sql` before rollout.
It adds owner-scoped records, atomic authenticated job requests, service-role claims
and Realtime status. Large request/result payloads stay in a separate private table.
Clients cannot write cache records, complete jobs or claim work. The RLS regression
script in `supabase/tests` requires a migrated local PostgreSQL database.

Publish import snapshots using `--store supabase` instead of `--cache-dir` with the
same preparation CLI. Private snapshots require `--owner-id UUID`. Existing
`EXPO_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` credentials are used only by
Node; the app never receives the service-role key. Run
`npx tsx scripts/processRecommendationJobs.ts --watch` as the separate consumer.
Without `--watch` it processes at most one job. Running jobs can be reclaimed after
ten minutes; successfully persisted ranking/final records remain reusable.

Discover loads packets only on focus/context/accepted-feed-batch events. The worker
attaches recommendations along that exact feed order without changing Style
Intelligence, pagination, exclusions or gestures. It predicts exposure for the
packet; only actual active-card acceptance commits device exposure. Session,
generation, context and codec keys are validated against canonical input objects.
Swipe/undo read memory; a mismatch/miss stays empty and never starts computation or
requests. Shown anchors retain their results for undo without double exposure.

Authenticated misses queue Node work. Realtime pushes small completion notices;
one packet read then belongs to the preparation job, with no polling. Anonymous
clients read shared records only and stay empty on a miss. Shared zero-exposure
results never substitute for incompatible wardrobe/exposure. Deploying SQL and
running the consumer are operational prerequisites, not application side effects.
