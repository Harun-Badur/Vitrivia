import type { Product } from '../types/product';

export const buildTryOnShareMessage = (product: Product): string => {
  const storeUrl =
    product.affiliateUrl?.trim() || product.productUrl?.trim() || '';
  if (storeUrl.length === 0) {
    return `Vitirify'da sanal denedim: ${product.title}`;
  }
  return `Vitirify'da sanal denedim: ${product.title} → ${storeUrl}`;
};
