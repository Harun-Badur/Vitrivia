/** Normalization shared by the legacy product filter and future search entry points. */
export const normalizeSearch = (value: string): string =>
  value.trim().toLocaleLowerCase('tr-TR');

export const matchesProductQuery = (
  product: { brand: string; title: string },
  normalizedQuery: string,
): boolean =>
  normalizeSearch(`${product.brand} ${product.title}`).includes(normalizedQuery);
