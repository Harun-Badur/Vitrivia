/**
 * Mevcut katalog satırlarına title heuristic ile colors + sizes yazar.
 *
 *   npx tsx scripts/seed-variations.ts
 *
 * Önkoşul: supabase/variations.sql uygulanmış olsun.
 */
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { isGarmentCategory, type GarmentCategory } from '../types/product';

loadEnv();

const SEED_LIMIT = 10;

interface ProductColor {
  name: string;
  hex: string;
}

interface CatalogRow {
  id: string;
  title: string;
  category: string;
}

interface ColorKeyword {
  name: string;
  hex: string;
  keys: string[];
}

const COLOR_KEYWORDS: ColorKeyword[] = [
  { name: 'Siyah', hex: '#111827', keys: ['siyah', 'black'] },
  { name: 'Beyaz', hex: '#FFFFFF', keys: ['beyaz', 'white'] },
  { name: 'Kahverengi', hex: '#92400E', keys: ['kahverengi', 'kahve', 'brown'] },
  { name: 'Gri', hex: '#6B7280', keys: ['gri', 'grey', 'gray', 'indigo'] },
  { name: 'Kırmızı', hex: '#DC2626', keys: ['kırmızı', 'kirmizi', 'red'] },
  { name: 'Mavi', hex: '#2563EB', keys: ['mavi', 'blue', 'navy'] },
  { name: 'Bej', hex: '#D6C4A8', keys: ['bej', 'beige', 'krem'] },
  { name: 'Yeşil', hex: '#16A34A', keys: ['yeşil', 'yesil', 'green'] },
  { name: 'Pembe', hex: '#EC4899', keys: ['pembe', 'pink'] },
];

const SIZES_BY_CATEGORY: Partial<Record<GarmentCategory, string[]>> = {
  upper_body: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  lower_body: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  dresses: ['XS', 'S', 'M', 'L', 'XL'],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isCatalogRow = (value: unknown): value is CatalogRow => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.category === 'string'
  );
};

const inferColors = (title: string): ProductColor[] => {
  const haystack = title.toLocaleLowerCase('tr-TR');
  return COLOR_KEYWORDS.filter((entry) =>
    entry.keys.some((key) => haystack.includes(key)),
  ).map(({ name, hex }) => ({ name, hex }));
};

const sizesForCategory = (category: string): string[] => {
  if (!isGarmentCategory(category)) {
    return ['S', 'M', 'L'];
  }
  return SIZES_BY_CATEGORY[category] ?? [];
};

const requireEnv = (name: 'EXPO_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} .env içinde tanımlı olmalı.`);
  }
  return value;
};

const run = async (): Promise<void> => {
  const url = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client
    .from('products')
    .select('id, title, category')
    .limit(SEED_LIMIT);

  if (error) {
    throw new Error(`Ürünler okunamadı: ${error.message}`);
  }

  const rows = (data ?? []).filter(isCatalogRow);
  if (rows.length === 0) {
    console.log('Güncellenecek ürün yok.');
    return;
  }

  for (const row of rows) {
    const colors = inferColors(row.title);
    const sizes = sizesForCategory(row.category);
    const { error: updateError } = await client
      .from('products')
      .update({ colors, sizes })
      .eq('id', row.id);

    if (updateError) {
      throw new Error(`${row.id} güncellenemedi: ${updateError.message}`);
    }

    console.log(
      `seed ${row.id}: ${colors.map((item) => item.name).join(', ') || 'renk yok'} · ${sizes.join('/')}`,
    );
  }
};

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  console.error(message);
  process.exitCode = 1;
});
