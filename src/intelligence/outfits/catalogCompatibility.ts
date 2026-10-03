import { getDisplayPrice, type Product } from '../../../types/product';
import { recommendationMemoValue, normalizedRecommendationToken } from '../../../lib/recommendationMemo';

export interface CatalogCompatibility {
  score: number;
  color: number;
  price: number;
  brand: number;
  fit: number;
  style: number;
}

const WEIGHTS = { color: 0.3, price: 0.35, brand: 0.1, fit: 0.1, style: 0.15 };
const NEUTRAL_COLORS = new Set(['siyah', 'beyaz', 'gri', 'bej', 'krem', 'navy']);
const STYLE_BY_SUBCATEGORY: Readonly<Record<string, string>> = {
  jean: 'casual', tisort: 'casual', polo: 'casual', hoodie: 'casual',
  sweatshirt: 'casual', sneaker: 'casual', sort: 'casual',
  blazer: 'tailored', gomlek: 'tailored',
};
const token = (value: string | undefined): string =>
  value === undefined || value === null ? '' : normalizedRecommendationToken(value, true,
    () => value.trim().toLocaleLowerCase('tr-TR'));

/** Soft evidence only; these weights are explicit heuristics, not learned style labels. */
export const catalogCompatibility = (anchor: Product, product: Product): CatalogCompatibility => {
  const evidence = (entry: Product) => [entry.id, entry.outfitRole, entry.colorSlugs,
    getDisplayPrice(entry), entry.brand, entry.fit, entry.subcategory];
  return recommendationMemoValue('catalogCompatibilityMemo', JSON.stringify([
    'tr-TR', evidence(anchor), evidence(product),
  ]), () => {

  const left = new Set(anchor.colorSlugs?.map(token) ?? []);
  const right = product.colorSlugs?.map(token) ?? [];
  const color = right.some((color) => left.has(color)) ? 1
    : left.size > 0 && right.length > 0 &&
      ([...left].some((color) => NEUTRAL_COLORS.has(color)) || right.some((color) => NEUTRAL_COLORS.has(color))) ? 0.5 : 0;
  const anchorPrice = getDisplayPrice(anchor), productPrice = getDisplayPrice(product);
  const price = Number.isFinite(anchorPrice) && Number.isFinite(productPrice) && anchorPrice > 0 && productPrice > 0
    ? Math.min(anchorPrice, productPrice) / Math.max(anchorPrice, productPrice) : 0;
  const anchorBrand = token(anchor.brand), productBrand = token(product.brand);
  const brand = anchorBrand !== '' && anchorBrand !== 'kabin' && anchorBrand === productBrand ? 1 : 0;
  const fit = anchor.fit && product.fit && anchor.fit === product.fit ? 1 : 0;
  const anchorStyle = STYLE_BY_SUBCATEGORY[token(anchor.subcategory)];
  const productStyle = STYLE_BY_SUBCATEGORY[token(product.subcategory)];
  const style = anchorStyle && productStyle && anchorStyle === productStyle ? 1 : 0;
  return { color, price, brand, fit, style,
    score: color * WEIGHTS.color + price * WEIGHTS.price + brand * WEIGHTS.brand + fit * WEIGHTS.fit + style * WEIGHTS.style };

  });
};

/** Semantic ordering for genuinely equal evidence; identifiers are intentionally excluded. */
export const catalogSemanticKey = (product: Product): string => recommendationMemoValue('semanticKeyMemo', JSON.stringify([
  'tr-TR', product.id, product.outfitRole, product.category, product.gender, product.subcategory,
  product.brand, product.title, getDisplayPrice(product), product.colorSlugs, product.fit,
]), () => JSON.stringify([
  product.outfitRole, product.category, product.gender, token(product.subcategory),
  token(product.brand), token(product.title), getDisplayPrice(product),
  [...(product.colorSlugs ?? [])].map(token).sort(), token(product.fit),
]));

export const sameCatalogProduct = (left: Product, right: Product): boolean => {

  if (left.id === right.id) return true;
  if (left.productUrl && right.productUrl) {
    try {
      const canonical = (raw: string): string => {
        const url = new URL(raw);
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
      };
      if (canonical(left.productUrl) === canonical(right.productUrl)) return true;
    } catch {
      // Malformed URLs are compared using actual metadata instead.
    }
  }
  return catalogSemanticKey(left) === catalogSemanticKey(right) && left.imageUrl === right.imageUrl;

};
