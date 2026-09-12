import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import type { FeedProvider, FeedProductRow } from '../types/product';

loadEnv();

interface ColumnMapping {
  provider: string;
  external_id: string;
  title: string;
  brand: string;
  price: string;
  currency: string;
  image_url: string;
  product_url: string;
  category: string;
  affiliate_url: string;
}

const MARKETPLACE_COLUMN_MAPPING: ColumnMapping = {
  provider: 'provider',
  external_id: 'external_id',
  title: 'title',
  brand: 'brand',
  price: 'price',
  currency: 'currency',
  image_url: 'image_url',
  product_url: 'product_url',
  category: 'category',
  affiliate_url: 'affiliate_url',
};

const PROVIDER_MAPPINGS: Record<FeedProvider, ColumnMapping> = {
  mock: MARKETPLACE_COLUMN_MAPPING,
  amazon: MARKETPLACE_COLUMN_MAPPING,
  trendyol: MARKETPLACE_COLUMN_MAPPING,
  hepsiburada: MARKETPLACE_COLUMN_MAPPING,
};

const isFeedProvider = (value: string): value is FeedProvider =>
  value === 'amazon' ||
  value === 'trendyol' ||
  value === 'hepsiburada' ||
  value === 'mock';

const looksLikeSource = (value: string): boolean =>
  value.endsWith('.csv') ||
  value.startsWith('http://') ||
  value.startsWith('https://') ||
  value.includes('/') ||
  value.includes('\\');

const parsePrice = (raw: string): number => {
  const normalized = raw.trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Geçersiz fiyat: ${raw}`);
  }
  return parsed;
};

const readCsvText = async (source: string): Promise<string> => {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`CSV indirilemedi (HTTP ${response.status}): ${source}`);
    }
    return response.text();
  }

  const absolutePath = path.isAbsolute(source)
    ? source
    : path.resolve(process.cwd(), source);
  return readFile(absolutePath, 'utf8');
};

const cell = (
  row: Record<string, string>,
  column: string,
  required: boolean,
): string => {
  if (!column) {
    if (required) {
      throw new Error('Zorunlu kolon adı boş.');
    }
    return '';
  }

  const value = row[column]?.trim() ?? '';
  if (required && value.length === 0) {
    throw new Error(`Zorunlu kolon boş: ${column}`);
  }
  return value;
};

const resolveProvider = (
  raw: Record<string, string>,
  mapping: ColumnMapping,
  fallbackProvider: FeedProvider | null,
): FeedProvider => {
  const fromCsv = cell(raw, mapping.provider, false);
  if (fromCsv.length > 0) {
    if (!isFeedProvider(fromCsv)) {
      throw new Error(
        `CSV provider geçersiz: ${fromCsv}. Kullanılabilenler: amazon, trendyol, hepsiburada, mock`,
      );
    }
    return fromCsv;
  }

  if (fallbackProvider) {
    return fallbackProvider;
  }

  throw new Error('Satırda provider yok ve CLI provider verilmedi.');
};

const mapRow = (
  raw: Record<string, string>,
  fallbackProvider: FeedProvider | null,
  mapping: ColumnMapping,
): FeedProductRow => {
  const provider = resolveProvider(raw, mapping, fallbackProvider);
  const externalId = cell(raw, mapping.external_id, true);
  const title = cell(raw, mapping.title, true);
  const brand = cell(raw, mapping.brand, false);
  const price = parsePrice(cell(raw, mapping.price, true));
  const currency = cell(raw, mapping.currency, false) || 'TRY';
  const imageUrl = cell(raw, mapping.image_url, true);
  const productUrl = cell(raw, mapping.product_url, true);
  const category = cell(raw, mapping.category, true);
  const affiliateUrl = cell(raw, mapping.affiliate_url, false);

  return {
    id: `${provider}-${externalId}`,
    provider,
    external_id: externalId,
    title,
    brand: brand.length > 0 ? brand : null,
    price,
    currency,
    image_url: imageUrl,
    images: [imageUrl],
    product_url: productUrl,
    category,
    affiliate_url: affiliateUrl.length > 0 ? affiliateUrl : null,
  };
};

const countByProvider = (rows: FeedProductRow[]): string => {
  const counts = new Map<FeedProvider, number>();
  for (const row of rows) {
    counts.set(row.provider, (counts.get(row.provider) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(', ');
};

const importFeed = async (): Promise<void> => {
  const firstArg = process.argv[2];
  const secondArg = process.argv[3];

  if (!firstArg) {
    throw new Error(
      'Kullanım: npx tsx scripts/importFeed.ts [provider] <csv-url-veya-yol>',
    );
  }

  let fallbackProvider: FeedProvider | null = null;
  let sourceArg = firstArg;

  if (secondArg) {
    if (!isFeedProvider(firstArg)) {
      throw new Error(
        `Bilinmeyen provider: ${firstArg}. Kullanılabilenler: amazon, trendyol, hepsiburada, mock`,
      );
    }
    fallbackProvider = firstArg;
    sourceArg = secondArg;
  } else if (!looksLikeSource(firstArg)) {
    throw new Error(
      'CSV yolu eksik. Kullanım: npx tsx scripts/importFeed.ts [provider] <csv-url-veya-yol>',
    );
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'EXPO_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik.',
    );
  }

  const mapping = fallbackProvider
    ? PROVIDER_MAPPINGS[fallbackProvider]
    : MARKETPLACE_COLUMN_MAPPING;
  const csvText = await readCsvText(sourceArg);
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    throw new Error('CSV boş; içe aktarılacak satır yok.');
  }

  const rows = records.map((record) =>
    mapRow(record, fallbackProvider, mapping),
  );
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from('products').upsert(rows, {
    onConflict: 'provider,external_id',
  });

  if (error) {
    throw new Error(`Upsert başarısız: ${error.message}`);
  }

  console.log(`${rows.length} ürün içe aktarıldı`);
  console.log(countByProvider(rows));
};

importFeed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  console.error(`Feed ithalatı başarısız: ${message}`);
  process.exit(1);
});
