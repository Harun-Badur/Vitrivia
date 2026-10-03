/**
 * Expand products catalog from a TSV of product links.
 *
 *   npm run seed:expansion
 *   npm run seed:expansion -- scripts/data/new_product_links.tsv
 *
 * Inserts new products only; never updates existing catalog rows.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { extractProductImagesFromHtml } from './lib/extractProductImage';
import {
  extractRetailMetadata,
  inferCatalogCategory,
  isRetailProvider,
} from './lib/retailProviders';
import type { FeedProvider, ProductGender } from '../types/product';
import { inferProductAttributes } from '../lib/productAttributes';
import {
  inferExpansionOutfitRole,
  canonicalizeCatalogUrl,
} from './lib/seedExpansionRules';
import {
  ingestCatalogLink,
  type CatalogMetadata,
  type CatalogProduct,
  persistIngestionResult,
  type ImportResult,
} from './lib/catalogIngestion';

loadEnv();

const DEFAULT_TSV_PATH = path.resolve(
  process.cwd(),
  'scripts/data/seed_expansion_links.tsv',
);

const MIN_DELAY_MS = 300;
const MAX_DELAY_MS = 800;

const GENDER_FROM_TSV: Record<string, ProductGender> = {
  KADIN: 'women',
  ERKEK: 'men',
  UNISEX: 'unisex',
};

const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TRENDYOL_STOREFRONT_COOKIE =
  'storefrontId=1; language=tr; countryCode=TR; Culture=tr-TR';

interface LinkRow {
  genderRaw: string;
  categoryRaw: string;
  brandHint: string;
  url: string;
}

interface SkipRecord {
  provider: FeedProvider | null;
  url: string;
  reason: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const jitterDelay = async (): Promise<void> => {
  const ms =
    MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
  await sleep(ms);
};

const requireEnv = (name: 'EXPO_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY' | 'EXPO_PUBLIC_SUPABASE_ANON_KEY'): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} eksik.`);
  }
  return value;
};

const mapGender = (raw: string): ProductGender | null => {
  const key = raw.trim().toLocaleUpperCase('tr-TR');
  return GENDER_FROM_TSV[key] ?? null;
};

const parsePriceNumber = (raw: string): number | null => {
  const cleaned = raw.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) {
    return null;
  }
  // 1.299,99 or 1299,99 or 1299.99
  let normalized = cleaned;
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const collectJsonLd = ($: cheerio.CheerioAPI): unknown[] => {
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      blocks.push(JSON.parse($(el).text()) as unknown);
    } catch {
      /* ignore */
    }
  });
  return blocks;
};

const walkJson = (value: unknown, visit: (node: Record<string, unknown>) => void): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visit));
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  Object.values(record).forEach((nested) => walkJson(nested, visit));
};

const extractFromJsonLd = (
  blocks: unknown[],
): { title: string | null; brand: string | null; price: number | null } => {
  let title: string | null = null;
  let brand: string | null = null;
  let price: number | null = null;

  walkJson(blocks, (node) => {
    const typeRaw = node['@type'];
    const type =
      typeof typeRaw === 'string'
        ? typeRaw
        : Array.isArray(typeRaw)
          ? typeRaw.map(String).join(',')
          : '';
    if (/Product/i.test(type) && typeof node.name === 'string' && !title) {
      title = node.name;
    }
    if (node.brand && brand === null) {
      if (typeof node.brand === 'string') {
        brand = node.brand;
      } else if (
        typeof node.brand === 'object' &&
        node.brand !== null &&
        typeof (node.brand as { name?: unknown }).name === 'string'
      ) {
        brand = (node.brand as { name: string }).name;
      }
    }
    if (node.offers && price === null) {
      const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
      for (const offer of offers) {
        if (typeof offer !== 'object' || offer === null) {
          continue;
        }
        const p = (offer as { price?: unknown }).price;
        if (typeof p === 'number' && p > 0) {
          price = p;
          break;
        }
        if (typeof p === 'string') {
          const parsed = parsePriceNumber(p);
          if (parsed !== null) {
            price = parsed;
            break;
          }
        }
      }
    }
  });

  return { title, brand, price };
};

const headersForUrl = (productUrl: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'User-Agent': CHROME_USER_AGENT,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  try {
    const host = new URL(productUrl).hostname;
    if (host.includes('trendyol.com')) {
      headers.Cookie = TRENDYOL_STOREFRONT_COOKIE;
      headers.Referer = 'https://www.trendyol.com/';
    } else if (host.includes('hepsiburada.com')) {
      headers.Referer = 'https://www.hepsiburada.com/';
    }
  } catch {
    /* ignore */
  }
  return headers;
};

const scrapeMeta = async (
  productUrl: string,
  provider: FeedProvider,
): Promise<CatalogMetadata> => {
  try {
    const response = await fetch(productUrl, {
      headers: headersForUrl(productUrl),
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return {
        httpStatus: response.status, title: '', brand: null, price: null,
        softBlocked: false, imageUrls: [], imageSource: 'none',
      };
    }
    const html = await response.text();
    if (isRetailProvider(provider)) {
      const retail = extractRetailMetadata(html, productUrl);
      return {
        httpStatus: response.status,
        title: retail.title,
        brand: retail.brand,
        price: retail.price,
        softBlocked: false,
        imageUrls: retail.images,
        imageSource: retail.imageSource,
      };
    }
    const $ = cheerio.load(html);
    const hasProductOgImage =
      /property=["']og:image["'][^>]+content=["']https?:\/\/(?:cdn\.dsmcdn\.com|productimages\.hepsiburada\.net)/i.test(
        html,
      );
    const softBlocked =
      /pageType"\s*:\s*"select_country"/.test(html) ||
      /storefrontId"\s*:\s*"-1"/.test(html) ||
      (/Türkiye'nin Trend Yolu/.test(html) && !hasProductOgImage);

    const ld = extractFromJsonLd(collectJsonLd($));
    const ogTitle = ($('meta[property="og:title"]').attr('content') ?? '').trim();
    const docTitle = $('title').first().text().replace(/\s+/g, ' ').trim();
    const rawTitle = ld.title ?? (ogTitle || docTitle);
    const title = rawTitle
      .replace(
        /\s*[-|].*(Fiyatı|Yorumları|Taksit|Hepsiburada|Trendyol).*$/i,
        '',
      )
      .trim();

    const brandMeta =
      ($('meta[property="product:brand"]').attr('content') ?? '').trim() ||
      ld.brand;

    let price = ld.price;
    if (price === null) {
      const selling = html.match(
        /"sellingPrice"\s*:\s*\{\s*"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/,
      );
      if (selling?.[1]) {
        price = Number(selling[1]);
      }
    }
    if (price === null) {
      const metaPrice =
        $('meta[property="product:price:amount"]').attr('content') ??
        $('meta[itemprop="price"]').attr('content') ??
        $('[itemprop="price"]').attr('content');
      if (metaPrice) {
        price = parsePriceNumber(metaPrice);
      }
    }

    const extracted = extractProductImagesFromHtml(html, provider, '', response.status);
    return {
      httpStatus: response.status,
      title,
      brand: brandMeta && brandMeta.length > 0 ? brandMeta : null,
      price: price !== null && Number.isFinite(price) && price > 0 ? price : null,
      softBlocked,
      imageUrls: extracted.imageUrls,
      imageSource: extracted.source,
    };
  } catch {
    throw new Error('fetch_or_parse_failed');
  }
};

const parseTsv = async (
  inputPath: string,
): Promise<{ rows: LinkRow[]; invalid: SkipRecord[] }> => {
  const raw = await readFile(inputPath, 'utf8');
  const rows: LinkRow[] = [];
  const invalid: SkipRecord[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const parts = trimmed.split('\t');
    if (parts.length === 1) {
      try {
        const url = parts[0];
        const parsed = new URL(url);
        const category = inferCatalogCategory(url);
        rows.push({
          genderRaw: /(?:^|[-/])kadin(?:[-/]|$)/i.test(parsed.pathname)
            ? 'KADIN'
            : /(?:^|[-/])erkek(?:[-/]|$)/i.test(parsed.pathname)
              ? 'ERKEK'
              : /(?:^|[-/])unisex(?:[-/]|$)/i.test(parsed.pathname)
                ? 'UNISEX'
                : '',
          categoryRaw: category ?? '',
          brandHint: '',
          url,
        });
      } catch {
        invalid.push({ provider: null, url: parts[0] || 'line:' + (index + 1), reason: 'invalid_url' });
      }
      continue;
    }
    if (parts.length < 4) {
      invalid.push({ provider: null, url: `line:${index + 1}`, reason: 'invalid_input_row' });
      continue;
    }
    const [genderRaw, categoryRaw, brandHint, url] = parts;
    if (!genderRaw || !categoryRaw || !url) {
      invalid.push({ provider: null, url: url || `line:${index + 1}`, reason: 'invalid_input_row' });
      continue;
    }
    rows.push({
      genderRaw,
      categoryRaw,
      brandHint: (brandHint ?? '').trim(),
      url: url.trim(),
    });
  }
  return { rows, invalid };
};

const seedExpansion = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const inputArg = args.find((arg) => !arg.startsWith('--'));
  const inputPath = inputArg
    ? path.resolve(process.cwd(), inputArg)
    : DEFAULT_TSV_PATH;
  const { rows: linkRows, invalid } = await parseTsv(inputPath);
  if (linkRows.length === 0) {
    throw new Error(`TSV içinde geçerli satır yok: ${inputPath}`);
  }

  const supabase = createClient(
    requireEnv('EXPO_PUBLIC_SUPABASE_URL'),
    requireEnv(dryRun ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY' : 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: roleColumnError } = await supabase
    .from('product_attributes')
    .select('outfit_role')
    .limit(0);
  if (roleColumnError) {
    throw new Error(`outfit_role migration'ı gerekli: ${roleColumnError.message}`);
  }

  const existing = { ids: new Set<string>(), urls: new Set<string>() };
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('products')
      .select('id, provider, external_id, product_url')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Mevcut katalog okunamadı: ${error.message}`);
    for (const row of data ?? []) {
      if (typeof row.id === 'string') existing.ids.add(row.id);
      if (typeof row.provider === 'string' && typeof row.external_id === 'string') {
        existing.ids.add(`${row.provider}-${row.external_id}`);
      }
      if (typeof row.product_url === 'string') {
        try {
          existing.urls.add(canonicalizeCatalogUrl(row.product_url));
        } catch {
          // Existing malformed URLs are left untouched.
        }
      }
    }
    if ((data ?? []).length < pageSize) break;
  }

  const results: ImportResult[] = invalid.map((row) => ({
    status: 'skipped' as const,
    ...row,
  }));
  const seen = { ids: new Set<string>(), urls: new Set<string>() };
  for (const [index, row] of linkRows.entries()) {
    const gender = row.genderRaw ? mapGender(row.genderRaw) : null;
    let result: ImportResult;
    if (row.genderRaw && !gender) {
      result = {
        status: 'skipped', provider: null, url: row.url,
        reason: `bad_gender:${row.genderRaw}`,
      };
    } else {
      result = await ingestCatalogLink({
        url: row.url, categoryRaw: row.categoryRaw,
        gender, brandHint: row.brandHint,
      }, existing, seen, scrapeMeta);
    }

    result = await persistIngestionResult(result, dryRun, (product) => insertNewProduct(supabase, product));
    results.push(result);
    console.log(`[${index + 1}/${linkRows.length}] ${result.status.toUpperCase()} ${result.provider ?? 'unknown'} ${result.url}${'reason' in result ? ` ${result.reason}` : ''}`);
    if (result.status !== 'duplicate' && result.status !== 'skipped') {
      await jitterDelay();
    }
  }

  const counts = {
    processed: results.length,
    inserted: results.filter((item) => item.status === 'inserted').length,
    duplicate: results.filter((item) => item.status === 'duplicate').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    failed: results.filter((item) => item.status === 'failed').length,
    ready: results.filter((item) => item.status === 'ready').length,
  };
  const providers: Record<string, number> = {};
  for (const item of results) {
    const provider = item.provider ?? 'unknown';
    providers[provider] = (providers[provider] ?? 0) + 1;
  }
  console.log('--- seed:expansion summary ---');
  console.log(`mode=${dryRun ? 'dry-run' : 'import'}`);
  console.log(`counts=${JSON.stringify(counts)}`);
  console.log(`providers=${JSON.stringify(providers)}`);
  for (const item of results) {
    if (item.status === 'skipped' || item.status === 'failed') {
      console.log(`${item.status.toUpperCase()}\t${item.provider ?? 'unknown'}\t${item.url}\t${item.reason}`);
    }
  }
};

const insertNewProduct = async (
  supabase: ReturnType<typeof createClient>,
  row: CatalogProduct,
): Promise<ImportResult> => {
  const { gender, imageSource: _imageSource, ...product } = row;
  let payload: Partial<typeof product> = product;
  let { error: productError } = await supabase.from('products').insert(payload);
  if (productError?.message.toLowerCase().includes('garment_description')) {
    const { garment_description: _description, ...rest } = payload;
    payload = rest;
    ({ error: productError } = await supabase.from('products').insert(payload));
  }
  if (productError?.message.toLowerCase().includes('images')) {
    const { images: _images, ...rest } = payload;
    payload = rest;
    ({ error: productError } = await supabase.from('products').insert(payload));
  }
  if (productError) {
    return productError.code === '23505'
      ? { status: 'duplicate', provider: row.provider, url: row.product_url, reason: 'conflict_at_insert' }
      : { status: 'failed', provider: row.provider, url: row.product_url, reason: `products_insert:${productError.message}` };
  }
  try {
    const inferred = inferProductAttributes({
      title: row.title, brand: row.brand, price: row.price, category: row.category,
    });
    const { error: attrError } = await supabase.from('product_attributes').insert({
      product_id: row.id,
      gender,
      colors: inferred.colors,
      fit: inferred.fit,
      subcategory: inferred.subcategory,
      brand_slug: inferred.brand_slug,
      price_band: inferred.price_band,
      outfit_role: inferExpansionOutfitRole(row.category, row.title, inferred.subcategory),
    });
    if (attrError) throw new Error(attrError.message);
  } catch (error) {
    const { error: rollbackError } = await supabase.from('products').delete().eq('id', row.id);
    return {
      status: 'failed', provider: row.provider, url: row.product_url,
      reason: `attributes_insert:${error instanceof Error ? error.message : 'unknown'};rollback:${rollbackError ? rollbackError.message : 'ok'}`,
    };
  }
  return { status: 'inserted', provider: row.provider, url: row.product_url };
};

seedExpansion().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  console.error(`seed:expansion failed: ${message}`);
  process.exit(1);
});
