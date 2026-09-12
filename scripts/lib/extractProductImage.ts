import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FeedProvider } from '../../types/product';

const execFileAsync = promisify(execFile);

const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ACCEPT_HTML =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';

const MIN_USABLE_HTML_BYTES = 20_000;

const PRODUCT_CDN_PATTERN =
  /dsmcdn\.com|trendyol|hepsiburada\.net|productimages/i;

const REJECT_IMAGE_PATTERN =
  /logo|banner|icon|favicon|splash|apple-icon|sfweb|carelabel|charts|storefront|footer|\.svg(?:\?|$)/i;

export type ProductImageSource =
  | 'og'
  | 'jsonld'
  | 'next_data'
  | 'img'
  | 'fallback';

export interface ExtractedProductImage {
  imageUrl: string;
  source: ProductImageSource;
  httpStatus: number;
}

export interface ExtractedProductImages extends ExtractedProductImage {
  /** Ordered, deduped gallery URLs (max 6). Empty when only fallback applies. */
  imageUrls: string[];
}

const MAX_GALLERY_IMAGES = 6;

interface FetchHtmlResult {
  html: string;
  httpStatus: number;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': CHROME_USER_AGENT,
  Accept: ACCEPT_HTML,
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

const unescapeHtml = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const normalizeImageUrl = (raw: string): string | null => {
  const trimmed = unescapeHtml(raw.trim());
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('http://')) {
    return `https://${trimmed.slice('http://'.length)}`;
  }
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  return `https:${trimmed}`;
};

const isProductImageUrl = (raw: string): boolean => {
  const normalized = normalizeImageUrl(raw);
  if (!normalized) {
    return false;
  }
  if (!PRODUCT_CDN_PATTERN.test(normalized)) {
    return false;
  }
  if (REJECT_IMAGE_PATTERN.test(normalized)) {
    return false;
  }
  return true;
};


/** Collect valid product CDN URLs, dedupe preserve order, optional cap. */
const collectProductImages = (
  candidates: string[],
  cap = MAX_GALLERY_IMAGES,
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    if (!isProductImageUrl(candidate)) {
      continue;
    }
    const normalized = normalizeImageUrl(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
};

const mergeUniqueUrls = (
  buckets: string[][],
  cap = MAX_GALLERY_IMAGES,
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const bucket of buckets) {
    for (const url of bucket) {
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);
      out.push(url);
      if (out.length >= cap) {
        return out;
      }
    }
  }
  return out;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const collectImageFieldValue = (value: unknown, acc: string[]): void => {
  if (typeof value === 'string') {
    acc.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageFieldValue(item, acc));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const nested = [value.contentUrl, value.url, value.src, value['@id']];
  nested.forEach((item) => collectImageFieldValue(item, acc));
};

const collectJsonLdImageFields = (value: unknown, acc: string[]): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdImageFields(item, acc));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if ('image' in value) {
    collectImageFieldValue(value.image, acc);
  }
  Object.entries(value).forEach(([key, nested]) => {
    if (key === 'image') {
      return;
    }
    collectJsonLdImageFields(nested, acc);
  });
};

const collectStringUrls = (value: unknown, acc: string[]): void => {
  if (typeof value === 'string') {
    acc.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringUrls(item, acc));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  Object.values(value).forEach((nested) => collectStringUrls(nested, acc));
};

const parseJsonSafe = (raw: string): unknown | null => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const collectOgImages = ($: CheerioAPI): string[] => {
  const candidates: string[] = [];
  $('meta[property="og:image"]').each((_index, element) => {
    const content = $(element).attr('content');
    if (content) {
      candidates.push(content);
    }
  });
  $('meta[name="og:image"]').each((_index, element) => {
    const content = $(element).attr('content');
    if (content) {
      candidates.push(content);
    }
  });
  return collectProductImages(candidates);
};

const collectJsonLdImages = ($: CheerioAPI): string[] => {
  const candidates: string[] = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    const parsed = parseJsonSafe($(element).text());
    if (parsed === null) {
      return;
    }
    collectJsonLdImageFields(parsed, candidates);
  });
  return collectProductImages(candidates);
};

const collectNextDataImages = ($: CheerioAPI): string[] => {
  const raw = $('#__NEXT_DATA__').text();
  if (!raw) {
    return [];
  }
  const parsed = parseJsonSafe(raw);
  if (parsed === null) {
    return [];
  }
  const strings: string[] = [];
  collectStringUrls(parsed, strings);
  const marketplaceHits = strings.filter(
    (value) => /dsmcdn|trendyol/i.test(value) && isProductImageUrl(value),
  );
  return collectProductImages(marketplaceHits);
};

const collectImgTagImages = (
  $: CheerioAPI,
  provider: FeedProvider,
  cap = MAX_GALLERY_IMAGES,
): string[] => {
  const candidates: string[] = [];
  $('img').each((_index, element) => {
    const node = $(element);
    const src = node.attr('src');
    const dataSrc = node.attr('data-src');
    if (src) {
      candidates.push(src);
    }
    if (dataSrc) {
      candidates.push(dataSrc);
    }
  });

  if (provider === 'hepsiburada') {
    const hbHits = candidates.filter((value) =>
      /productimages|hepsiburada\.net/i.test(value),
    );
    return collectProductImages(hbHits, cap);
  }

  return collectProductImages(candidates, cap);
};

const isUsableHtml = (html: string, httpStatus: number): boolean =>
  httpStatus >= 200 &&
  httpStatus < 300 &&
  html.length >= MIN_USABLE_HTML_BYTES;

const fetchHtmlViaNode = async (productUrl: string): Promise<FetchHtmlResult> => {
  try {
    const response = await fetch(productUrl, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
    const html = await response.text();
    return { html, httpStatus: response.status };
  } catch {
    return { html: '', httpStatus: 0 };
  }
};

const fetchHtmlViaCurl = async (productUrl: string): Promise<FetchHtmlResult> => {
  const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kabin-product-html-'));
  const filePath = path.join(dir, 'page.html');
  try {
    const { stdout } = await execFileAsync(
      curlBin,
      [
        '-sS',
        '-L',
        '--max-time',
        '30',
        '-A',
        CHROME_USER_AGENT,
        '-H',
        'Accept-Language: tr-TR,tr;q=0.9,en;q=0.8',
        '-H',
        `Accept: ${ACCEPT_HTML}`,
        '-o',
        filePath,
        '-w',
        '%{http_code}',
        productUrl,
      ],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    const html = await readFile(filePath, 'utf8');
    const httpStatus = Number.parseInt(stdout.trim(), 10);
    return {
      html,
      httpStatus: Number.isNaN(httpStatus) ? 0 : httpStatus,
    };
  } catch {
    return { html: '', httpStatus: 0 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const fetchProductHtml = async (productUrl: string): Promise<FetchHtmlResult> => {
  const nodeResult = await fetchHtmlViaNode(productUrl);
  if (isUsableHtml(nodeResult.html, nodeResult.httpStatus)) {
    return nodeResult;
  }
  const curlResult = await fetchHtmlViaCurl(productUrl);
  if (isUsableHtml(curlResult.html, curlResult.httpStatus)) {
    return curlResult;
  }
  return nodeResult.html.length >= curlResult.html.length
    ? nodeResult
    : curlResult;
};

export const extractProductImages = async (
  productUrl: string,
  provider: FeedProvider,
  fallbackUrl: string,
): Promise<ExtractedProductImages> => {
  const { html, httpStatus } = await fetchProductHtml(productUrl);
  const $ = cheerio.load(html);

  const ogImages = collectOgImages($);
  const jsonLdImages = collectJsonLdImages($);
  const nextDataImages =
    provider === 'trendyol' ? collectNextDataImages($) : [];
  const imgTagImages = collectImgTagImages($, provider);

  const imageUrls = mergeUniqueUrls([
    ogImages,
    jsonLdImages,
    nextDataImages,
    imgTagImages,
  ]);

  let source: ProductImageSource = 'fallback';
  if (ogImages.length > 0) {
    source = 'og';
  } else if (jsonLdImages.length > 0) {
    source = 'jsonld';
  } else if (nextDataImages.length > 0) {
    source = 'next_data';
  } else if (imgTagImages.length > 0) {
    source = 'img';
  }

  if (imageUrls.length === 0) {
    return {
      imageUrls: [],
      imageUrl: fallbackUrl,
      source: 'fallback',
      httpStatus,
    };
  }

  return {
    imageUrls,
    imageUrl: imageUrls[0] ?? fallbackUrl,
    source,
    httpStatus,
  };
};

/** Single-image compatible wrapper over extractProductImages. */
export const extractProductImage = async (
  productUrl: string,
  provider: FeedProvider,
  fallbackUrl: string,
): Promise<ExtractedProductImage> => {
  const extracted = await extractProductImages(
    productUrl,
    provider,
    fallbackUrl,
  );
  return {
    imageUrl: extracted.imageUrl,
    source: extracted.source,
    httpStatus: extracted.httpStatus,
  };
};
