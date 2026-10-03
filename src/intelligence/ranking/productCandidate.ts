import { preparedProductAttributes } from '../style/productStyle';
import { getDisplayPrice, hasCatalogPriceDrop, type Product } from '../../../types/product';
import type { ScoringCandidate } from '../../../types/recommendation';

export const toScoringCandidate = (product: Product): ScoringCandidate => {
  const inferred = preparedProductAttributes(product);
  const createdAtMs = product.createdAt ? Date.parse(product.createdAt) : 0;
  return {
    id: product.id,
    brand: product.brand,
    brandSlug: product.brandSlug ?? inferred.brand_slug,
    category: product.category,
    subcategory: product.subcategory ?? inferred.subcategory,
    fit: product.fit ?? inferred.fit,
    colors:
      product.colorSlugs && product.colorSlugs.length > 0
        ? product.colorSlugs
        : inferred.colors,
    priceBand: product.priceBand ?? inferred.price_band,
    price: getDisplayPrice(product),
    gender: product.gender ?? inferred.gender,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
    impressionCount: product.impressionCount ?? 0,
    deal: hasCatalogPriceDrop(product) ? 1 : 0,
  };
};
