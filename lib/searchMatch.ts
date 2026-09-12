import { COLOR_ALIASES } from './productAttributes';

/** Case-fold with Turkish locale (İ→i, I→ı handled by tr-TR). */
export const normalizeTr = (value: string): string =>
  value.trim().toLocaleLowerCase('tr-TR');

/** ASCII-ish fold for Turkish letters so kırmızı ↔ kirmizi. */
export const foldTr = (value: string): string =>
  normalizeTr(value)
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');

export const colorKeysForSlug = (slug: string): string[] => {
  const alias = COLOR_ALIASES.find((item) => item.slug === slug);
  if (!alias) {
    return [slug];
  }
  return [alias.slug, ...alias.keys];
};

export interface MatchableProductFields {
  title: string;
  brand: string;
  /** Attribute color slugs when present. */
  colorSlugs?: readonly string[];
  /** Display color names when present. */
  colorNames?: readonly string[];
  subcategory?: string;
}

/** Haystack for color / style / brand facet terms. */
export const facetHaystack = (fields: MatchableProductFields): string => {
  const colorBits = [
    ...(fields.colorSlugs ?? []),
    ...(fields.colorNames ?? []),
  ].join(' ');
  return foldTr(
    `${colorBits} ${fields.title} ${fields.brand} ${fields.subcategory ?? ''}`,
  );
};

export const termInHaystack = (term: string, hayFolded: string): boolean => {
  const needle = foldTr(term);
  if (needle.length === 0) {
    return true;
  }
  return hayFolded.includes(needle);
};

export const matchesColorFacet = (
  fields: MatchableProductFields,
  colorSlug: string,
): boolean => {
  const slugs = fields.colorSlugs ?? [];
  if (slugs.includes(colorSlug)) {
    return true;
  }
  const hay = facetHaystack(fields);
  return colorKeysForSlug(colorSlug).some((key) => termInHaystack(key, hay));
};

export const matchesStyleFacet = (
  fields: MatchableProductFields,
  style: string,
): boolean => termInHaystack(style, facetHaystack(fields));

export const matchesBrandFacet = (
  fields: MatchableProductFields,
  brand: string,
): boolean => termInHaystack(brand, facetHaystack(fields));

/** Remaining free-text: title contains only. */
export const matchesTextTitle = (title: string, text: string): boolean => {
  const needle = foldTr(text);
  if (needle.length === 0) {
    return true;
  }
  return foldTr(title).includes(needle);
};
