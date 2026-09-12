// VITRIVIA Recs V1 — feed ranking Edge Function.
// JWT → profile + attributes + config (5 dk bellek cache) → AllActiveCatalogSource
// → scoring → diversity rerank → reasons.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  assembleRecsConfig,
  isConfigRow,
  isPriorRow,
  isProfileRow,
  mapStyleProfileRow,
} from '../_shared/config.ts';
import { rerankForDiversity } from '../_shared/diversity.ts';
import {
  applyFilterMaskProgressive,
  hasStructuredFilters,
  parseStructuredFilters,
} from '../_shared/feedFilter.ts';
import {
  applyFeedMode,
  DEFAULT_RECS_CONFIG,
  emptySessionIntent,
  matchesHardConstraints,
  rankCandidates,
} from '../_shared/scoring.ts';
import type {
  FeedMode,
  RecsScoringConfig,
  ScoringCandidate,
  SessionIntent,
  SessionIntentConstraints,
  SessionIntentWeights,
  WeightMap,
} from '../_shared/types.ts';
import { isFeedMode } from '../_shared/types.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CONFIG_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40;
const IMPRESSION_WINDOW_DAYS = 30;
const PRICE_BAND_LOW_MAX = 499.99;
const PRICE_BAND_MID_MAX = 1499.99;
const PRICE_BAND_HIGH_MAX = 2999.99;

interface CachedConfig {
  config: RecsScoringConfig;
  fetchedAt: number;
}

interface ProductColorJson {
  name: string;
  hex: string;
}

interface RecsProductJson {
  id: string;
  imageUrl: string;
  images?: string[];
  title: string;
  price: number;
  currentPrice?: number;
  previousPrice?: number;
  lastPriceCheckedAt?: string;
  createdAt?: string;
  brand: string;
  category: string;
  garmentDescription: string;
  provider?: string;
  productUrl?: string;
  affiliateUrl?: string;
  externalId?: string;
  colors?: ProductColorJson[];
  sizes?: string[];
  gender?: string;
  colorSlugs?: string[];
  fit?: string;
  subcategory?: string;
  brandSlug?: string;
  priceBand?: string;
  impressionCount?: number;
}

interface CatalogItem {
  product: RecsProductJson;
  candidate: ScoringCandidate;
}

interface CandidateSource {
  load(constraints: SessionIntentConstraints): Promise<CatalogItem[]>;
}

class AllActiveCatalogSource implements CandidateSource {
  constructor(private readonly items: CatalogItem[]) {}

  load(constraints: SessionIntentConstraints): Promise<CatalogItem[]> {
    const session: SessionIntent = {
      ...emptySessionIntent(),
      constraints,
    };
    return Promise.resolve(
      this.items.filter((item) =>
        matchesHardConstraints(item.candidate, session),
      ),
    );
  }
}

let configCache: CachedConfig | null = null;

const jsonResponse = (
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders,
      'Content-Type': 'application/json',
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getBearerToken = (request: Request): string | null => {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
};

const toPrice = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const optionalPrice = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = toPrice(value);
  return parsed > 0 ? parsed : undefined;
};

const slugify = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const inferPriceBand = (price: number): string => {
  if (price <= PRICE_BAND_LOW_MAX) {
    return 'low';
  }
  if (price <= PRICE_BAND_MID_MAX) {
    return 'mid';
  }
  if (price <= PRICE_BAND_HIGH_MAX) {
    return 'high';
  }
  return 'luxury';
};

const parseColorObjects = (value: unknown): ProductColorJson[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    if (typeof item.name === 'string' && typeof item.hex === 'string') {
      return [{ name: item.name, hex: item.hex }];
    }
    return [];
  });
  return parsed.length > 0 ? parsed : undefined;
};

const parseSizes = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parsed = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return parsed.length > 0 ? parsed : undefined;
};

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
};

const isGarmentCategory = (value: string): boolean =>
  value === 'upper_body' || value === 'lower_body' || value === 'dresses';

const parseWeightMap = (value: unknown): WeightMap => {
  if (!isRecord(value)) {
    return {};
  }
  const map: WeightMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      map[key] = raw;
    }
  }
  return map;
};

const parseIntent = (value: unknown): SessionIntent => {
  const empty = emptySessionIntent();
  if (!isRecord(value)) {
    return empty;
  }
  const constraintsRaw = isRecord(value.constraints) ? value.constraints : {};
  const weightsRaw = isRecord(value.weights) ? value.weights : {};
  const constraints: SessionIntentConstraints = {
    category:
      typeof constraintsRaw.category === 'string'
        ? constraintsRaw.category
        : null,
    gender:
      typeof constraintsRaw.gender === 'string' ? constraintsRaw.gender : null,
    size: typeof constraintsRaw.size === 'string' ? constraintsRaw.size : null,
  };
  const weights: SessionIntentWeights = {
    colorW: parseWeightMap(weightsRaw.colorW),
    subcategoryW: parseWeightMap(weightsRaw.subcategoryW),
    brandW: parseWeightMap(weightsRaw.brandW),
    fitW: parseWeightMap(weightsRaw.fitW),
    priceBandW: parseWeightMap(weightsRaw.priceBandW),
    categoryW: parseWeightMap(weightsRaw.categoryW),
  };
  return {
    weights,
    constraints,
    query: typeof value.query === 'string' ? value.query : '',
    lastCategory:
      typeof value.lastCategory === 'string' ? value.lastCategory : null,
    lastSubcategory:
      typeof value.lastSubcategory === 'string' ? value.lastSubcategory : null,
    lastTryShopSubcategory:
      typeof value.lastTryShopSubcategory === 'string'
        ? value.lastTryShopSubcategory
        : null,
  };
};

const loadConfig = async (
  admin: ReturnType<typeof createClient>,
): Promise<RecsScoringConfig> => {
  const now = Date.now();
  if (configCache && now - configCache.fetchedAt < CONFIG_CACHE_MS) {
    return configCache.config;
  }

  const [configResult, priorResult] = await Promise.all([
    admin.from('recs_config').select('key, value, updated_at'),
    admin.from('style_tag_priors').select('tag, subcategory_w, fit_w, color_w'),
  ]);

  if (configResult.error) {
    console.error('recs_config okunamadı', { detail: configResult.error.message });
    return configCache?.config ?? DEFAULT_RECS_CONFIG;
  }

  const rows = (configResult.data ?? []).filter(isConfigRow);
  const priors = (priorResult.data ?? []).filter(isPriorRow);
  const config = assembleRecsConfig(rows, priors);
  configCache = { config, fetchedAt: now };
  return config;
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ detail: 'Yalnızca POST destekleniyor.' }, 405);
  }

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('recs-feed yapılandırması eksik');
    return jsonResponse({ detail: 'Servis yapılandırılmamış.' }, 500);
  }

  const token = getBearerToken(request);
  if (!token) {
    return jsonResponse({ detail: 'Giriş yapmalısın.' }, 401, {
      'WWW-Authenticate': 'Bearer',
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    return jsonResponse(
      { detail: 'Oturumun geçersiz veya süresi dolmuş. Tekrar giriş yap.' },
      401,
      { 'WWW-Authenticate': 'Bearer' },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const payload = isRecord(body) ? body : {};
  const limitRaw = payload.limit;
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.round(limitRaw)))
      : DEFAULT_LIMIT;
  const intent = parseIntent(payload.intent);
  const mode: FeedMode = isFeedMode(payload.mode) ? payload.mode : 'personal';
  const structuredFilters = parseStructuredFilters(payload.filters);
  if (structuredFilters.category && !intent.constraints.category) {
    intent.constraints.category = structuredFilters.category;
  }

  try {
    const impressionSince = new Date(
      Date.now() - IMPRESSION_WINDOW_DAYS * 86_400_000,
    ).toISOString();

    const [config, profileResult, productsResult, attributesResult, impressionsResult] =
      await Promise.all([
        loadConfig(admin),
        admin
          .from('user_style_profiles')
          .select(
            'user_id, color_w, subcategory_w, brand_w, fit_w, price_band_w, style_tag_weights, negative_preferences',
          )
          .eq('user_id', user.id)
          .maybeSingle(),
        admin
          .from('products')
          .select(
            'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, images, product_url, category, affiliate_url, colors, sizes, created_at',
          ),
        admin
          .from('product_attributes')
          .select(
            'product_id, gender, colors, fit, subcategory, brand_slug, price_band',
          ),
        admin
          .from('user_events')
          .select('product_id')
          .eq('user_id', user.id)
          .eq('event_type', 'impression')
          .gte('created_at', impressionSince),
      ]);

    const profile = mapStyleProfileRow(
      profileResult.data && isProfileRow(profileResult.data)
        ? profileResult.data
        : null,
      user.id,
    );

    const rankedConfig = applyFeedMode(config, mode);

    const impressionCounts = new Map<string, number>();
    for (const row of impressionsResult.data ?? []) {
      if (!isRecord(row) || typeof row.product_id !== 'string') {
        continue;
      }
      impressionCounts.set(
        row.product_id,
        (impressionCounts.get(row.product_id) ?? 0) + 1,
      );
    }

    const attributesById = new Map<string, Record<string, unknown>>();
    for (const row of attributesResult.data ?? []) {
      if (!isRecord(row) || typeof row.product_id !== 'string') {
        continue;
      }
      attributesById.set(row.product_id, row);
    }

    const catalog: CatalogItem[] = [];
    for (const row of productsResult.data ?? []) {
      if (!isRecord(row) || typeof row.id !== 'string') {
        continue;
      }
      if (typeof row.category !== 'string' || !isGarmentCategory(row.category)) {
        continue;
      }
      if (typeof row.title !== 'string' || typeof row.image_url !== 'string') {
        continue;
      }
      if (typeof row.provider !== 'string' || typeof row.external_id !== 'string') {
        continue;
      }
      if (typeof row.product_url !== 'string') {
        continue;
      }

      const attr = attributesById.get(row.id);
      const price = toPrice(row.price);
      const currentPrice = optionalPrice(row.current_price);
      const displayPrice = currentPrice ?? price;
      const brand =
        typeof row.brand === 'string' && row.brand.trim().length > 0
          ? row.brand.trim()
          : 'Kabin';
      const createdAt =
        typeof row.created_at === 'string' ? row.created_at : undefined;
      const colorSlugs = parseStringArray(attr?.colors);
      const gender =
        attr && typeof attr.gender === 'string' ? attr.gender : 'unisex';
      const fit = attr && typeof attr.fit === 'string' ? attr.fit : 'regular';
      const subcategory =
        attr && typeof attr.subcategory === 'string'
          ? attr.subcategory
          : row.category === 'dresses'
            ? 'elbise'
            : row.category === 'lower_body'
              ? 'pantolon'
              : 'tisort';
      const brandSlug =
        attr && typeof attr.brand_slug === 'string'
          ? attr.brand_slug
          : slugify(brand);
      const priceBand =
        attr && typeof attr.price_band === 'string'
          ? attr.price_band
          : inferPriceBand(displayPrice);
      const impressionCount = impressionCounts.get(row.id) ?? 0;
      const garmentDescription = `${brand} ${row.title}`.trim();
      const affiliateUrl =
        typeof row.affiliate_url === 'string' && row.affiliate_url.trim().length > 0
          ? row.affiliate_url
          : row.product_url;

      const galleryImages = parseStringArray(row.images);
      const product: RecsProductJson = {
        id: row.id,
        imageUrl: galleryImages[0] ?? row.image_url,
        images: galleryImages.length > 0 ? galleryImages : undefined,
        title: row.title,
        price,
        currentPrice,
        previousPrice: optionalPrice(row.previous_price),
        lastPriceCheckedAt:
          typeof row.last_price_checked_at === 'string'
            ? row.last_price_checked_at
            : undefined,
        createdAt,
        brand,
        category: row.category,
        garmentDescription,
        provider: row.provider,
        productUrl: row.product_url,
        affiliateUrl,
        externalId: row.external_id,
        colors: parseColorObjects(row.colors),
        sizes: parseSizes(row.sizes),
        gender,
        colorSlugs,
        fit,
        subcategory,
        brandSlug,
        priceBand,
        impressionCount,
      };

      const candidate: ScoringCandidate = {
        id: row.id,
        brand,
        brandSlug,
        category: row.category,
        subcategory,
        fit,
        colors: colorSlugs,
        priceBand,
        price: displayPrice,
        gender:
          gender === 'women' || gender === 'men' || gender === 'unisex'
            ? gender
            : 'unisex',
        createdAtMs: createdAt ? Date.parse(createdAt) : 0,
        impressionCount,
        deal:
          product.previousPrice !== undefined &&
          product.previousPrice > displayPrice
            ? 1
            : 0,
      };

      catalog.push({ product, candidate });
    }

    const source = new AllActiveCatalogSource(catalog);
    const filtered = await source.load(intent.constraints);
    const nowMs = Date.now();
    const scored = rankCandidates(
      filtered.map((item) => item.candidate),
      profile,
      intent,
      rankedConfig,
      nowMs,
      user.id,
    );

    const byId = new Map(filtered.map((item) => [item.candidate.id, item.product]));

    const scoredWithProduct = scored.flatMap((entry) => {
      const product = byId.get(entry.candidate.id);
      if (!product) {
        return [];
      }
      return [{ entry, product }];
    });

    const masked = hasStructuredFilters(structuredFilters)
      ? applyFilterMaskProgressive(
          scoredWithProduct,
          structuredFilters,
          (row) => ({
            id: row.entry.candidate.id,
            brand: row.entry.candidate.brand,
            category: row.entry.candidate.category,
            colors: row.entry.candidate.colors,
            price: row.entry.candidate.price,
            title: row.product.title,
            garmentDescription: row.product.garmentDescription,
            subcategory: row.entry.candidate.subcategory,
          }),
        )
      : { items: scoredWithProduct, fallback: false, dropped: [] as string[] };

    const ranked = rerankForDiversity(
      masked.items.map((row) => row.entry),
      intent,
      rankedConfig,
      profile,
      limit,
      nowMs,
    );

    const items = ranked.flatMap((entry) => {
      const product = byId.get(entry.candidate.id);
      if (!product) {
        return [];
      }
      return [
        {
          product,
          score: Math.round(entry.breakdown.total * 1000) / 1000,
          reasons: entry.reasons,
          position: entry.position,
        },
      ];
    });

    const elapsedMs = Date.now() - startedAt;
    console.info(
      JSON.stringify({
        msg: 'recs-feed',
        ms: elapsedMs,
        n: items.length,
        fallback: masked.fallback,
        config_version: rankedConfig.configVersion,
      }),
    );

    return jsonResponse({
      recommendation_id: crypto.randomUUID(),
      score_id: crypto.randomUUID(),
      config_version: rankedConfig.configVersion,
      items,
      fallback: masked.fallback,
    });
  } catch (error) {
    console.error('recs-feed başarısız', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return jsonResponse({ detail: 'Öneri üretilemedi. Lütfen tekrar dene.' }, 500);
  }
});
