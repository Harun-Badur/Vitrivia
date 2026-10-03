import type { LikedProduct, Product } from '../types/product';

export const removeProduct = (products: Product[], productId: string): Product[] =>
  products.filter((item) => item.id !== productId);

/** Restore only the failed swipe, keeping other swipes made in the meantime. */
export const restoreProduct = (products: Product[], product: Product): Product[] =>
  products.some((item) => item.id === product.id)
    ? products
    : [product, ...products];

export const excludeSeen = (
  products: Product[],
  likedProducts: LikedProduct[],
  passedProductIds: string[],
): Product[] => {
  const seen = new Set([
    ...likedProducts.map((item) => item.product.id),
    ...passedProductIds,
  ]);
  return products.filter((item) => !seen.has(item.id));
};
