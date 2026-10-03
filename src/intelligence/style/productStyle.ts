import { inferProductAttributes, type InferredProductAttributes } from '../../../lib/productAttributes';
import {
  getDisplayPrice,
  isOutfitRole,
  type GarmentCategory,
  type OutfitRole,
  type Product,
  type ProductGender,
} from '../../../types/product';

export interface ProductAttributeRow {
  product_id: string;
  gender: string | null;
  colors: unknown;
  fit: string | null;
  subcategory: string | null;
  brand_slug: string | null;
  price_band: string | null;
  outfit_role?: string | null;
}

const OUTFIT_ROLE_BY_CATEGORY: Readonly<Record<GarmentCategory, OutfitRole>> = {
  upper_body: 'top',
  lower_body: 'bottom',
  dresses: 'one_piece',
  shoes: 'shoes',
  bags: 'bag',
  hats: 'hat',
  accessories: 'accessory',
};

/** Explicit metadata wins; only known catalog categories receive a fallback role. */
export const resolveCatalogOutfitRole = (
  category: GarmentCategory,
  explicitRole: unknown,
): OutfitRole | null =>
  isOutfitRole(explicitRole) ? explicitRole : OUTFIT_ROLE_BY_CATEGORY[category] ?? null;

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
};

const isProductGender = (value: string): value is ProductGender =>
  value === 'women' || value === 'men' || value === 'unisex';

// Product objects are immutable in the catalog pipeline; scope reuse to their lifetime.
const inferredByProduct = new WeakMap<Product, { key: string; attributes: InferredProductAttributes }>();
export const preparedProductAttributes = (product: Product): InferredProductAttributes => {
  const price = getDisplayPrice(product);
  const names = product.colors?.map(color => color.name);
  const key = JSON.stringify([product.title, product.brand, price, product.category, names]);
  const cached = inferredByProduct.get(product);
  if (cached?.key === key) return cached.attributes;
  const attributes = inferProductAttributes({ title: product.title, brand: product.brand,
    price, category: product.category, existingColorNames: names });
  inferredByProduct.set(product, { key, attributes });
  return attributes;
};

export const enrichProduct = (
  product: Product,
  attr: ProductAttributeRow | undefined,
): Product => {
  const inferred = preparedProductAttributes(product);
  const colorSlugs =
    attr !== undefined && parseStringArray(attr.colors).length > 0
      ? parseStringArray(attr.colors)
      : inferred.colors;
  const genderRaw = attr?.gender ?? inferred.gender;
  const enriched: Product = {
    ...product,
    gender: isProductGender(genderRaw) ? genderRaw : inferred.gender,
    colorSlugs,
    fit: attr?.fit ?? inferred.fit,
    subcategory: attr?.subcategory ?? inferred.subcategory,
    brandSlug: attr?.brand_slug ?? inferred.brand_slug,
    priceBand: attr?.price_band ?? inferred.price_band,
    outfitRole: resolveCatalogOutfitRole(
      product.category,
      isOutfitRole(attr?.outfit_role) ? attr.outfit_role : product.outfitRole,
    ),
  };
  const prepared = inferredByProduct.get(product);
  if (prepared) inferredByProduct.set(enriched, prepared);
  return enriched;
};

const GENDER_MEN_TOKENS = ['erkek', 'oğlan', 'oglan'] as const;
const GENDER_WOMEN_TOKENS = ['kadın', 'kadin', 'kız', 'kiz'] as const;

const titleHasToken = (title: string, token: string): boolean => {
  const haystack = title.toLocaleLowerCase('tr-TR');
  const needle = token.toLocaleLowerCase('tr-TR');
  const start = haystack.indexOf(needle);
  if (start < 0) {
    return false;
  }
  const before = start === 0 ? '' : haystack[start - 1];
  const afterIndex = start + needle.length;
  const after = afterIndex >= haystack.length ? '' : haystack[afterIndex];
  const isBoundary = (char: string): boolean =>
    char.length === 0 || /[^a-z0-9ğüşöçı]/i.test(char);
  return isBoundary(before ?? '') && isBoundary(after ?? '');
};

export const inferGenderFromTitle = (title: string): ProductGender => {
  if (GENDER_MEN_TOKENS.some((token) => titleHasToken(title, token))) {
    return 'men';
  }
  if (GENDER_WOMEN_TOKENS.some((token) => titleHasToken(title, token))) {
    return 'women';
  }
  return 'unisex';
};
