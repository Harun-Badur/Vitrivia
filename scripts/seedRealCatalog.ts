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

interface CatalogInput {
  provider: FeedProvider;
  brand: string;
  title: string;
  rawUrl: string;
  category: GarmentCategory;
  price: number;
}

interface CatalogRow {
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
  imageSource: ProductImageSource;
}

const CATALOG: CatalogInput[] = [
  {
    provider: 'trendyol',
    brand: 'Stradivarius',
    title: 'Keten Karışımlı Bol Kesim Pantolon',
    rawUrl:
      'https://www.trendyol.com/stradivarius/keten-karisimli-bol-kesim-pantolon-p-670154023',
    category: 'lower_body',
    price: 899,
  },
  {
    provider: 'trendyol',
    brand: 'Stradivarius',
    title: 'Kare Yaka Askılı Tişört',
    rawUrl:
      'https://www.trendyol.com/stradivarius/kare-yaka-askili-tisort-p-940829373',
    category: 'upper_body',
    price: 449,
  },
  {
    provider: 'trendyol',
    brand: 'West Club',
    title: 'Kahverengi Drapeli Çiçek Aksesuarlı Midi Elbise',
    rawUrl:
      'https://www.trendyol.com/west-club/kadin-kahverengi-drapeli-cicek-aksesuarli-midi-elbise-p-1173071782',
    category: 'dresses',
    price: 1299,
  },
  {
    provider: 'trendyol',
    brand: 'Tudors',
    title: 'Erkek Kahverengi Polo Yaka Tişört',
    rawUrl:
      'https://www.trendyol.com/tudors/erkek-slim-fit-dar-kesim-soft-modal-kumas-kisa-kollu-yarim-fermuarli-kahverengi-polo-yaka-tisort-p-1149754938',
    category: 'upper_body',
    price: 599,
  },
  {
    provider: 'trendyol',
    brand: 'AVVA',
    title: 'Erkek Gri Keten Relaxed Fit Pantolon',
    rawUrl:
      'https://www.trendyol.com/avva/erkek-gri-beli-lastikli-100-keten-relaxed-fit-pantolon-b003032-p-822488656',
    category: 'lower_body',
    price: 1099,
  },
  {
    provider: 'trendyol',
    brand: 'DS Damat',
    title: 'Gri Çizgili Kruvaze Takım Elbise',
    rawUrl:
      'https://www.trendyol.com/d-s-damat/ds-damat-regular-fit-gri-cizgili-kruvaze-takim-elbise-p-929681071',
    category: 'upper_body',
    price: 2499,
  },
  {
    provider: 'hepsiburada',
    brand: 'LTB',
    title: 'Slogan Baskılı Basic Beyaz T-Shirt',
    rawUrl:
      'https://www.hepsiburada.com/ltb-slogan-baskili-basic-beyaz-t-shirt-p-HBCV0000CYITMK',
    category: 'upper_body',
    price: 399,
  },
  {
    provider: 'hepsiburada',
    brand: 'Pierre Cardin',
    title: 'Erkek İndigo Comfort Fit Bisiklet Yaka Tişört',
    rawUrl:
      'https://www.hepsiburada.com/pierre-cardin-erkek-indigo-comfort-fit-bisiklet-yaka-tisort-50310076-vr028-p-HBCV00008NG76F',
    category: 'upper_body',
    price: 549,
  },
  {
    provider: 'hepsiburada',
    brand: 'Tarzını Seç',
    title: "Kahverengi ve Siyah Tül Pareo 2'li Set",
    rawUrl:
      'https://www.hepsiburada.com/tarzini-sec-esnek-likrali-uzun-kahverengi-ve-siyah-tul-pareo-2-li-set-150x95-p-HBCV0000FG17PA',
    category: 'lower_body',
    price: 329,
  },
  {
    provider: 'hepsiburada',
    brand: 'XCLSV',
    title: 'Firfirlı Transparan Şifon Pareo',
    rawUrl:
      'https://www.hepsiburada.com/xclsv-orme-sifondan-firfirli-transparan-pareo-p-HBCV00006JDCY7',
    category: 'lower_body',
    price: 379,
  },
];

const toCanonicalUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.search = '';
  parsed.hash = '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
};

const extractExternalId = (canonicalUrl: string): string => {
  const match = canonicalUrl.match(/-p-([A-Za-z0-9]+)$/i);
  if (!match || !match[1]) {
    throw new Error(`external_id URL'den okunamadı: ${canonicalUrl}`);
  }
  return match[1];
};

const csvEscape = (value: string): string => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const writeSampleFeedCsv = async (rows: CatalogRow[]): Promise<void> => {
  const header =
    'provider,external_id,title,brand,price,image_url,product_url,category,garment_description';
  const lines = rows.map((row) =>
    [
      row.provider,
      row.external_id,
      csvEscape(row.title),
      csvEscape(row.brand),
      row.price.toFixed(2),
      row.image_url,
      row.product_url,
      row.category,
      csvEscape(row.garment_description),
    ].join(','),
  );
  const csvPath = path.resolve(process.cwd(), 'data/sampleFeed.csv');
  await writeFile(csvPath, `${header}\n${lines.join('\n')}\n`, 'utf8');
};

const seedCatalog = async (): Promise<void> => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role yapilandirmasi eksik.');
  }

  const built: CatalogRow[] = [];
  for (const item of CATALOG) {
    const productUrl = toCanonicalUrl(item.rawUrl);
    const externalId = extractExternalId(productUrl);
    const extracted = await extractProductImages(
      productUrl,
      item.provider,
      IMAGE_FALLBACK[item.category],
    );
    const images =
      extracted.imageUrls.length > 0
        ? extracted.imageUrls
        : [extracted.imageUrl];
    built.push({
      id: `${item.provider}-${externalId}`,
      provider: item.provider,
      external_id: externalId,
      title: item.title,
      brand: item.brand,
      price: item.price,
      currency: 'TRY',
      image_url: extracted.imageUrl,
      images,
      product_url: productUrl,
      category: item.category,
      affiliate_url: null,
      garment_description: `${item.brand} ${item.title}`,
      imageSource: extracted.source,
    });
    console.log(
      `${item.brand} | HTTP ${extracted.httpStatus} | ${extracted.source} | ${externalId}`,
    );
  }

  await writeSampleFeedCsv(built);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: deleteError } = await supabase
    .from('products')
    .delete()
    .neq('id', '');

  if (deleteError) {
    throw new Error(`Eski katalog silinemedi: ${deleteError.message}`);
  }

  const payload = built.map(({ imageSource: _imageSource, ...row }) => row);
  let { error: insertError } = await supabase.from('products').insert(payload);

  if (insertError?.message.toLowerCase().includes('garment_description')) {
    const withoutDescription = payload.map(
      ({ garment_description: _garmentDescription, ...row }) => row,
    );
    const retry = await supabase.from('products').insert(withoutDescription);
    insertError = retry.error;
  }

  if (insertError?.message.toLowerCase().includes('images')) {
    const withoutImages = payload.map(({ images: _images, ...row }) => row);
    const retry = await supabase.from('products').insert(withoutImages);
    insertError = retry.error;
  }

  if (insertError) {
    throw new Error(`Yeni katalog yazılamadı: ${insertError.message}`);
  }

  const ogCount = built.filter((row) => row.imageSource !== 'fallback').length;
  const trendyol = built.filter((row) => row.provider === 'trendyol').length;
  const hepsiburada = built.filter(
    (row) => row.provider === 'hepsiburada',
  ).length;
  console.log(`inserted=${built.length}`);
  const multi = built.filter((row) => row.images.length > 1).length;
  console.log(`cdn_images=${ogCount}`);
  console.log(`multi_images=${multi}`);
  console.log(`fallback=${built.length - ogCount}`);
  console.log(`trendyol=${trendyol} hepsiburada=${hepsiburada}`);
};

seedCatalog().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  console.error(`Katalog seed başarısız: ${message}`);
  process.exit(1);
});
