import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  extractProductImages,
  type ProductImageSource,
} from './lib/extractProductImage';
import type { FeedProvider } from '../types/product';
import type { GarmentCategory } from '../types/product';

loadEnv();

const IMAGE_FALLBACK: Record<GarmentCategory, string> = {
  upper_body:
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800',
  lower_body:
    'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800',
  dresses:
    'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800',
};

interface ProductRow {
  id: string;
  provider: FeedProvider;
  external_id: string;
  title: string;
  brand: string | null;
  price: number | string;
  image_url: string;
  product_url: string;
  category: GarmentCategory;
}

interface RefreshResult {
  title: string;
  imageUrl: string;
  imageCount: number;
  source: ProductImageSource;
  httpStatus: number;
}

const isFeedProvider = (value: string): value is FeedProvider =>
  value === 'amazon' ||
  value === 'trendyol' ||
  value === 'hepsiburada' ||
  value === 'mock';

const isGarmentCategory = (value: string): value is GarmentCategory =>
  value === 'upper_body' || value === 'lower_body' || value === 'dresses';

const toProductRow = (row: {
  id: string;
  provider: string;
  external_id: string;
  title: string;
  brand: string | null;
  price: number | string;
  image_url: string;
  product_url: string;
  category: string;
}): ProductRow => {
  if (!isFeedProvider(row.provider) || !isGarmentCategory(row.category)) {
    throw new Error(`Geçersiz ürün satırı: ${row.id}`);
  }
  return {
    id: row.id,
    provider: row.provider,
    external_id: row.external_id,
    title: row.title,
    brand: row.brand,
    price: row.price,
    image_url: row.image_url,
    product_url: row.product_url,
    category: row.category,
  };
};

const csvEscape = (value: string): string => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const writeSampleFeedCsv = async (rows: ProductRow[]): Promise<void> => {
  const header =
    'provider,external_id,title,brand,price,image_url,product_url,category,garment_description';
  const lines = rows.map((row) => {
    const price =
      typeof row.price === 'number' ? row.price.toFixed(2) : String(row.price);
    return [
      row.provider,
      row.external_id,
      csvEscape(row.title),
      csvEscape(row.brand ?? ''),
      price,
      row.image_url,
      row.product_url,
      row.category,
      csvEscape(row.brand ? `${row.brand} ${row.title}` : row.title),
    ].join(',');
  });
  const csvPath = path.resolve(process.cwd(), 'data/sampleFeed.csv');
  await writeFile(csvPath, `${header}\n${lines.join('\n')}\n`, 'utf8');
};

const refreshProductImages = async (): Promise<void> => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role yapılandırması eksik.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('products')
    .select(
      'id, provider, external_id, title, brand, price, image_url, product_url, category',
    )
    .order('provider', { ascending: true })
    .order('title', { ascending: true });

  if (error) {
    throw new Error(`Ürünler okunamadı: ${error.message}`);
  }

  const products = (data ?? []).map((row) => toProductRow(row));
  if (products.length === 0) {
    throw new Error('products tablosu boş.');
  }

  const results: RefreshResult[] = [];

  for (const product of products) {
    const category = isGarmentCategory(product.category)
      ? product.category
      : 'upper_body';
    const fallbackUrl = IMAGE_FALLBACK[category];
    const extracted = await extractProductImages(
      product.product_url,
      product.provider,
      fallbackUrl,
    );

    if (extracted.source !== 'fallback') {
      const images =
        extracted.imageUrls.length > 0
          ? extracted.imageUrls
          : [extracted.imageUrl];
      const { error: updateError } = await supabase
        .from('products')
        .update({ image_url: extracted.imageUrl, images })
        .eq('provider', product.provider)
        .eq('external_id', product.external_id);

      if (updateError) {
        throw new Error(
          `${product.title} güncellenemedi: ${updateError.message}`,
        );
      }
      product.image_url = extracted.imageUrl;
    }

    results.push({
      title: product.title,
      imageUrl: product.image_url,
      imageCount:
        extracted.source === 'fallback' ? 1 : extracted.imageUrls.length || 1,
      source: extracted.source,
      httpStatus: extracted.httpStatus,
    });

    console.log(
      `${product.title} | HTTP ${extracted.httpStatus} | ${extracted.source} | images=${extracted.imageUrls.length || (extracted.source === 'fallback' ? 0 : 1)} | ${product.image_url}`,
    );
  }

  await writeSampleFeedCsv(products);

  const { data: verified, error: verifyError } = await supabase
    .from('products')
    .select('title, image_url, images')
    .order('title', { ascending: true });

  if (verifyError) {
    throw new Error(`Doğrulama SELECT başarısız: ${verifyError.message}`);
  }

  console.log('\nSELECT title, image_url, images FROM products');
  (verified ?? []).forEach((row) => {
    const count = Array.isArray(row.images) ? row.images.length : 0;
    console.log(`${row.title}\n  images=${count} ${row.image_url}`);
  });

  const cdnCount = results.filter((row) => row.source !== 'fallback').length;
  console.log(`\ncdn_images=${cdnCount}/${results.length}`);
};

refreshProductImages().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  console.error(`Görsel yenileme başarısız: ${message}`);
  process.exit(1);
});
