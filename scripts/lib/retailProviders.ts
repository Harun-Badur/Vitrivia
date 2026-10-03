import * as cheerio from 'cheerio';
import type { FeedProvider, GarmentCategory } from '../../types/product';

const NEW_PROVIDERS = ['boyner', 'mavi', 'lcw', 'defacto', 'flo'] as const;
export type RetailProvider = (typeof NEW_PROVIDERS)[number];

export const isRetailProvider = (provider: FeedProvider): provider is RetailProvider =>
  (NEW_PROVIDERS as readonly string[]).includes(provider);

export const detectCatalogProvider = (url: string): FeedProvider | null => {
  const host = new URL(url).hostname.toLowerCase();
  const matches = (domain: string): boolean =>
    host === domain || host.endsWith('.' + domain);
  if (matches('trendyol.com')) return 'trendyol';
  if (matches('hepsiburada.com')) return 'hepsiburada';
  if (matches('boyner.com.tr')) return 'boyner';
  if (matches('mavi.com')) return 'mavi';
  if (matches('lcw.com')) return 'lcw';
  if (matches('defacto.com.tr')) return 'defacto';
  if (matches('flo.com.tr')) return 'flo';
  return null;
};

export const extractCatalogExternalId = (
  url: string,
  provider: FeedProvider,
): string | null => {
  const pathname = new URL(url).pathname;
  if (provider === 'trendyol') return pathname.match(/-p-(\d+)$/i)?.[1] ?? null;
  if (provider === 'hepsiburada') {
    return pathname.match(/-p(?:m)?-([A-Za-z0-9]+)$/i)?.[1] ?? null;
  }
  if (provider === 'mavi') {
    return pathname.match(/\/p\/([A-Za-z0-9-]+)\/?$/i)?.[1] ?? null;
  }
  if (provider === 'lcw') return pathname.match(/-o-(\d+)$/i)?.[1] ?? null;
  if (provider === 'boyner') return pathname.match(/-p-(\d+)$/i)?.[1] ?? null;
  if (provider === 'defacto') return pathname.match(/-(\d+)$/)?.[1] ?? null;
  if (provider === 'flo' && pathname.startsWith('/urun/')) {
    return pathname.match(/-(\d+)$/)?.[1] ?? null;
  }
  return null;
};

export const inferCatalogCategory = (url: string): GarmentCategory | null => {
  const path = new URL(url).pathname.toLocaleLowerCase('tr-TR');
  const hits = new Set<GarmentCategory>();
  if (/takim|takım/.test(path) && /etek|elbise/.test(path)) return null;
  if (/ceket|mont|kaban|palto|hirka|hırka|sweatshirt|hoodie|kazak|tisort|tişört|atlet|gomlek|gömlek|bluz|triko/.test(path)) hits.add('upper_body');
  if (/pantolon|jean|etek|(?:^|[-/])(?:sort|şort)(?:[-/]|$)/.test(path)) hits.add('lower_body');
  if (/elbise/.test(path)) hits.add('dresses');
  if (/ayakkabi|ayakkabı|sneaker|babet|espadril|terlik|(?:^|[-/])bot(?:[-/]|$)/.test(path)) hits.add('shoes');
  if (/gozlu|gözlü|sunglasses|kemer|atki|atkı|kolye|bileklik|kupe|küpe|aksesuar/.test(path)) hits.add('accessories');
  if (/(?:^|[-/])(?:canta|çanta)(?:si|sı)?(?:[-/]|$)/.test(path)) hits.add('bags');
  if (/sapka|şapka|bere/.test(path)) hits.add('hats');
  return hits.size === 1 ? [...hits][0] : null;
};

const parsePrice = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  let normalized = value.replace(/[^\d.,]/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const result = Number(normalized);
  return Number.isFinite(result) && result > 0 ? result : null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const findProduct = (value: unknown): Record<string, unknown> | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const type = record['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return record;
  for (const nested of Object.values(record)) {
    const found = findProduct(nested);
    if (found) return found;
  }
  return null;
};

const imageStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(imageStrings);
  const record = asRecord(value);
  return record ? imageStrings(record.url ?? record.contentUrl) : [];
};

export interface RetailMetadata {
  title: string;
  brand: string | null;
  price: number | null;
  images: string[];
  imageSource: 'jsonld' | 'og';
}

export const extractRetailMetadata = (html: string, productUrl: string): RetailMetadata => {
  const $ = cheerio.load(html);
  let product: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_index, element) => {
    if (product) return;
    try {
      product = findProduct(JSON.parse($(element).text()) as unknown);
    } catch {
      // Malformed JSON-LD is ignored; product-specific meta tags may still work.
    }
  });
  const productData = product as Record<string, unknown> | null;
  const offers = productData?.offers;
  const offer = asRecord(Array.isArray(offers) ? offers[0] : offers);
  const brandValue = productData?.brand;
  const brand = typeof brandValue === 'string'
    ? brandValue
    : asRecord(brandValue)?.name;
  const price = parsePrice(
    offer?.price ??
    asRecord(offer?.priceSpecification)?.price ??
    $('meta[property="product:price:amount"]').attr('content') ??
    $('meta[itemprop="price"]').attr('content'),
  );
  const title = String(
    productData?.name ?? $('meta[property="og:title"]').attr('content') ?? '',
  ).trim();
  const candidates = [
    ...imageStrings(productData?.image),
    ...$('meta[property="og:image"]').map((_index, element) => $(element).attr('content')).get(),
  ];
  const images = [...new Set(candidates.flatMap((raw) => {
    try {
      const image = new URL(raw, productUrl);
      return image.protocol === 'https:' && !/logo|icon|banner|placeholder|\.svg(?:$|\?)/i.test(image.href)
        ? [image.href]
        : [];
    } catch {
      return [];
    }
  }))].slice(0, 6);
  return {
    title,
    brand: typeof brand === 'string' ? brand.trim() || null : null,
    price,
    images,
    imageSource: imageStrings(productData?.image).length > 0 ? 'jsonld' : 'og',
  };
};
