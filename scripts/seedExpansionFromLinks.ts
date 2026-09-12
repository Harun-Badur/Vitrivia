/**
 * Expand products catalog from scripts/data/seed_expansion_links.tsv.
 *
 *   npm run seed:expansion
 *
 * Upserts only (no delete-all). Skips rows that fail HTTP/title/image gates.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import {
  extractProductImages,
  type ProductImageSource,
} from './lib/extractProductImage';
import type {
  FeedProvider,
  GarmentCategory,
  ProductGender,
} from '../types/product';
import { inferProductAttributes } from '../lib/productAttributes';

loadEnv();

const TSV_PATH = path.resolve(
  process.cwd(),
  'scripts/data/seed_expansion_links.tsv',
);

const MIN_DELAY_MS = 300;
const MAX_DELAY_MS = 800;

const IMAGE_FALLBACK: Record<GarmentCategory, string> = {
  upper_body:
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800',
  lower_body:
    'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800',
  dresses:
    'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800',
};

const CATEGORY_FROM_TSV: Record<string, GarmentCategory> = {
  ELBİSE: 'dresses',
  ELBISE: 'dresses',
  'ÜST GİYİM': 'upper_body',
  'UST GIYIM': 'upper_body',
  'ALT GİYİM': 'lower_body',
  'ALT GIYIM': 'lower_body',
};

const GENDER_FROM_TSV: Record<string, ProductGender> = {
  KADIN: 'women',
  ERKEK: 'men',
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

interface ScrapedMeta {
  httpStatus: number;
  title: string;
  brand: string | null;
  price: number | null;
  softBlocked: boolean;
}

interface BuiltProduct {
  id: string;
  provider: FeedProvider;
  external_id: string;
  title: string;
  brand: string;
  price: number;
  currency: string;
  image_url: string;
  images: string[];
  product_url: string;
  category: GarmentCategory;
  affiliate_url: null;
  garment_description: string;
  gender: ProductGender;
  imageSource: ProductImageSource;
}

interface SkipRecord {
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

const requireEnv = (
  name: 'EXPO_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY',
): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} eksik.`);
  }
  return value;
};

const toCanonicalUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.search = '';
  parsed.hash = '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
};

const detectProvider = (canonicalUrl: string): FeedProvider | null => {
  const host = new URL(canonicalUrl).hostname;
  if (host.includes('trendyol.com')) {
    return 'trendyol';
  }
  if (host.includes('hepsiburada.com')) {
    return 'hepsiburada';
  }
  return null;
};

const extractExternalId = (
  canonicalUrl: string,
  provider: FeedProvider,
): string | null => {
  if (provider === 'trendyol') {
    const match = canonicalUrl.match(/-p-(\d+)/i);
    return match?.[1] ?? null;
  }
  if (provider === 'hepsiburada') {
    const match = canonicalUrl.match(/-p(?:m)?-([A-Za-z0-9]+)/i);
    return match?.[1] ?? null;
  }
  return null;
};

const mapCategory = (raw: string): GarmentCategory | null => {
  const key = raw.trim().toLocaleUpperCase('tr-TR');
  return CATEGORY_FROM_TSV[key] ?? CATEGORY_FROM_TSV[raw.trim()] ?? null;
};

const mapGender = (raw: string): ProductGender | null => {
  const key = raw.trim().toLocaleUpperCase('tr-TR');
  return GENDER_FROM_TSV[key] ?? null;
};

const titleFromSlug = (canonicalUrl: string, brandHint: string): string => {
  try {
    const parts = new URL(canonicalUrl).pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    const withoutId = last.replace(/-p(?:m)?-[A-Za-z0-9]+$/i, '');
    const words = withoutId
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1));
    const slugTitle = words.join(' ').trim();
    if (slugTitle.length >= 8) {
      return brandHint && !slugTitle.toLowerCase().includes(brandHint.toLowerCase())
        ? `${brandHint} ${slugTitle}`
        : slugTitle;
    }
  } catch {
    /* ignore */
  }
  return brandHint;
};

const isGenericTitle = (title: string): boolean => {
  const t = title.trim().toLowerCase();
  if (t.length < 8) {
    return true;
  }
  return (
    t.includes("türkiye'nin trend yolu") ||
    t.includes('online alışveriş sitesi') ||
    t === 'trendyol' ||
    t === 'hepsiburada'
  );
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

const scrapeMeta = async (productUrl: string): Promise<ScrapedMeta> => {
  try {
    const response = await fetch(productUrl, {
      headers: headersForUrl(productUrl),
      redirect: 'follow',
    });
    const html = await response.text();
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

    return {
      httpStatus: response.status,
      title,
      brand: brandMeta && brandMeta.length > 0 ? brandMeta : null,
      price: price !== null && Number.isFinite(price) && price > 0 ? price : null,
      softBlocked,
    };
  } catch {
    return {
      httpStatus: 0,
      title: '',
      brand: null,
      price: null,
      softBlocked: true,
    };
  }
};

const parseTsv = async (): Promise<LinkRow[]> => {
  const raw = await readFile(TSV_PATH, 'utf8');
  const rows: LinkRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const parts = trimmed.split('\t');
    if (parts.length < 4) {
      continue;
    }
    const [genderRaw, categoryRaw, brandHint, url] = parts;
    if (!genderRaw || !categoryRaw || !url) {
      continue;
    }
    rows.push({
      genderRaw,
      categoryRaw,
      brandHint: (brandHint ?? '').trim(),
      url: url.trim(),
    });
  }
  return rows;
};

const seedExpansion = async (): Promise<void> => {
  const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const linkRows = await parseTsv();
  if (linkRows.length === 0) {
    throw new Error(`TSV boş: ${TSV_PATH}`);
  }

  const built: BuiltProduct[] = [];
  const skipped: SkipRecord[] = [];
  const seenIds = new Set<string>();

  for (const [index, row] of linkRows.entries()) {
    const label = `[${index + 1}/${linkRows.length}]`;
    let canonicalUrl: string;
    try {
      canonicalUrl = toCanonicalUrl(row.url);
    } catch {
      skipped.push({ url: row.url, reason: 'invalid_url' });
      console.log(`${label} SKIP invalid_url`);
      continue;
    }

    const provider = detectProvider(canonicalUrl);
    if (!provider) {
      skipped.push({ url: canonicalUrl, reason: 'unknown_provider' });
      console.log(`${label} SKIP unknown_provider`);
      continue;
    }

    const category = mapCategory(row.categoryRaw);
    if (!category) {
      skipped.push({
        url: canonicalUrl,
        reason: `bad_category:${row.categoryRaw}`,
      });
      console.log(`${label} SKIP bad_category`);
      continue;
    }

    const gender = mapGender(row.genderRaw);
    if (!gender) {
      skipped.push({ url: canonicalUrl, reason: `bad_gender:${row.genderRaw}` });
      console.log(`${label} SKIP bad_gender`);
      continue;
    }

    const externalId = extractExternalId(canonicalUrl, provider);
    if (!externalId) {
      skipped.push({ url: canonicalUrl, reason: 'external_id_parse_failed' });
      console.log(`${label} SKIP external_id_parse_failed`);
      continue;
    }

    const id = `${provider}-${externalId}`;
    if (seenIds.has(id)) {
      skipped.push({ url: canonicalUrl, reason: 'duplicate_in_tsv' });
      console.log(`${label} SKIP duplicate_in_tsv ${id}`);
      continue;
    }
    seenIds.add(id);

    const meta = await scrapeMeta(canonicalUrl);
    if (meta.httpStatus !== 200) {
      skipped.push({
        url: canonicalUrl,
        reason: `http_${meta.httpStatus || 'error'}`,
      });
      console.log(`${label} SKIP http_${meta.httpStatus}`);
      await jitterDelay();
      continue;
    }
    if (meta.softBlocked) {
      skipped.push({ url: canonicalUrl, reason: 'soft_blocked_shell' });
      console.log(`${label} SKIP soft_blocked_shell`);
      await jitterDelay();
      continue;
    }

    let title = meta.title;
    if (isGenericTitle(title)) {
      title = titleFromSlug(canonicalUrl, row.brandHint);
    }
    if (isGenericTitle(title)) {
      skipped.push({ url: canonicalUrl, reason: 'no_usable_title' });
      console.log(`${label} SKIP no_usable_title`);
      await jitterDelay();
      continue;
    }

    const extracted = await extractProductImages(
      canonicalUrl,
      provider,
      IMAGE_FALLBACK[category],
    );
    const images =
      extracted.imageUrls.length > 0
        ? extracted.imageUrls
        : extracted.source !== 'fallback'
          ? [extracted.imageUrl]
          : [];

    if (images.length === 0 || extracted.source === 'fallback') {
      skipped.push({
        url: canonicalUrl,
        reason: `no_usable_image:http_${extracted.httpStatus}`,
      });
      console.log(`${label} SKIP no_usable_image`);
      await jitterDelay();
      continue;
    }

    const brand =
      meta.brand?.trim() ||
      row.brandHint.trim() ||
      (provider === 'trendyol' ? 'Trendyol' : 'Hepsiburada');
    const price = meta.price ?? 499;

    built.push({
      id,
      provider,
      external_id: externalId,
      title,
      brand,
      price,
      currency: 'TRY',
      image_url: images[0] ?? extracted.imageUrl,
      images,
      product_url: canonicalUrl,
      category,
      affiliate_url: null,
      garment_description: `${brand} ${title}`,
      gender,
      imageSource: extracted.source,
    });

    console.log(
      `${label} OK ${id} | ${extracted.source} | imgs=${images.length} | ₺${price}`,
    );
    await jitterDelay();
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const productPayload = built.map(
    ({ imageSource: _imageSource, gender: _gender, ...row }) => row,
  );

  let upsertError =
    productPayload.length === 0
      ? null
      : (
          await supabase.from('products').upsert(productPayload, {
            onConflict: 'provider,external_id',
          })
        ).error;

  if (upsertError?.message.toLowerCase().includes('garment_description')) {
    const withoutDescription = productPayload.map(
      ({ garment_description: _g, ...row }) => row,
    );
    upsertError = (
      await supabase.from('products').upsert(withoutDescription, {
        onConflict: 'provider,external_id',
      })
    ).error;
  }

  if (upsertError?.message.toLowerCase().includes('images')) {
    const withoutImages = productPayload.map(({ images: _i, ...row }) => row);
    upsertError = (
      await supabase.from('products').upsert(withoutImages, {
        onConflict: 'provider,external_id',
      })
    ).error;
  }

  if (upsertError) {
    throw new Error(`products upsert failed: ${upsertError.message}`);
  }

  // Gender lives on product_attributes (products.gender column not present).
  if (built.length > 0) {
    const attrRows = built.map((row) => {
      const inferred = inferProductAttributes({
        title: row.title,
        brand: row.brand,
        price: row.price,
        category: row.category,
      });
      return {
        product_id: row.id,
        gender: row.gender,
        colors: inferred.colors,
        fit: inferred.fit,
        subcategory: inferred.subcategory,
        brand_slug: inferred.brand_slug,
        price_band: inferred.price_band,
      };
    });
    const { error: attrError } = await supabase
      .from('product_attributes')
      .upsert(attrRows, { onConflict: 'product_id' });
    if (attrError) {
      console.warn(
        `product_attributes upsert warning: ${attrError.message}`,
      );
    }
  }

  const byCategory = built.reduce<Record<string, number>>((acc, row) => {
    acc[row.category] = (acc[row.category] ?? 0) + 1;
    return acc;
  }, {});
  const multi = built.filter((row) => row.images.length > 1).length;
  const imageUrlOk = built.filter(
    (row) => row.image_url === row.images[0],
  ).length;

  console.log('--- seed:expansion summary ---');
  console.log(`tsv_rows=${linkRows.length}`);
  console.log(`upserted=${built.length}`);
  console.log(`skipped=${skipped.length}`);
  console.log(`categories=${JSON.stringify(byCategory)}`);
  console.log(`multi_images=${multi}/${built.length}`);
  console.log(`image_url_eq_images0=${imageUrlOk}/${built.length}`);
  console.log(`ids=${built.map((row) => row.id).join(',')}`);
  for (const skip of skipped) {
    console.log(`SKIP\t${skip.reason}\t${skip.url}`);
  }
};

seedExpansion().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  console.error(`seed:expansion failed: ${message}`);
  process.exit(1);
});
