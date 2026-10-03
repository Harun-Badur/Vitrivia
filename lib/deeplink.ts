import { logger } from './logger';
import type { FeedProvider } from '../types/product';

export type { FeedProvider };

export interface BuildAffiliateUrlParams {
  provider: FeedProvider;
  productUrl: string;
  tag?: string;
}

const parseAffiliateTags = (): Record<string, string> => {
  const raw =
    process.env.EXPO_PUBLIC_AFFILIATE_TAGS_JSON ??
    process.env.AFFILIATE_TAGS_JSON;

  if (!raw || raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }

    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        tags[key] = value.trim();
      }
    }
    return tags;
  } catch (error) {
    logger.error('AFFILIATE_TAGS_JSON çözümlenemedi', { error });
    return {};
  }
};

const appendQueryParam = (
  productUrl: string,
  name: string,
  value: string,
): string => {
  try {
    const url = new URL(productUrl);
    url.searchParams.set(name, value);
    return url.toString();
  } catch (error) {
    logger.error('Affiliate URL oluşturulamadı', { error, productUrl });
    const separator = productUrl.includes('?') ? '&' : '?';
    return `${productUrl}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  }
};

export const buildAffiliateUrl = (
  provider: FeedProvider,
  productUrl: string,
  tag?: string,
): string => {
  const tags = parseAffiliateTags();
  const resolvedTag = tag?.trim() || tags[provider];

  if (!resolvedTag) {
    return productUrl;
  }

  switch (provider) {
    case 'amazon':
      return appendQueryParam(productUrl, 'tag', resolvedTag);
    case 'trendyol':
      return appendQueryParam(productUrl, 'adjust_t', resolvedTag);
    case 'hepsiburada':
      return appendQueryParam(productUrl, 'wt_alid', resolvedTag);
    case 'mock':
      return appendQueryParam(productUrl, 'aff_id', resolvedTag);
    default:
      return productUrl;
  }
};
