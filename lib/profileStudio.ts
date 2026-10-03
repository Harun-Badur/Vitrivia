import {
  GARMENT_SIZES,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  STYLE_TAGS,
  STUDIO_COLORS,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
  type GarmentSize,
  type StyleTag,
  type StudioProfilePatch,
} from '../types/profile';

const STYLE_TAG_VALUES: readonly StyleTag[] = STYLE_TAGS.map(
  (entry) => entry.value,
);

export const clampHeightCm = (value: number): number =>
  Math.min(HEIGHT_CM_MAX, Math.max(HEIGHT_CM_MIN, Math.round(value)));

export const clampWeightKg = (value: number): number =>
  Math.min(WEIGHT_KG_MAX, Math.max(WEIGHT_KG_MIN, Math.round(value)));

export const isGarmentSize = (value: unknown): value is GarmentSize =>
  typeof value === 'string' &&
  (GARMENT_SIZES as readonly string[]).includes(value);

export const isStyleTag = (value: unknown): value is StyleTag =>
  typeof value === 'string' &&
  (STYLE_TAG_VALUES as readonly string[]).includes(value);

export const parseStyleTags = (value: unknown): StyleTag[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isStyleTag);
};

export function parseStudioPreferences(
  value: unknown,
): Pick<
  StudioProfilePatch,
  'favoriteBrands' | 'preferredColors' | 'priceRange'
> {
  const data =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const strings = (input: unknown): string[] =>
    Array.isArray(input)
      ? [
          ...new Set(
            input
              .filter(
                (item): item is string =>
                  typeof item === 'string' && !!item.trim(),
              )
              .map((item) => item.trim()),
          ),
        ]
      : [];
  const range = data.priceRange as { min?: unknown; max?: unknown } | undefined;
  return {
    favoriteBrands: strings(data.favoriteBrands),
    preferredColors: strings(data.preferredColors).filter((value) =>
      STUDIO_COLORS.some((color) => color.label === value),
    ),
    priceRange:
      range &&
      typeof range.min === 'number' &&
      typeof range.max === 'number' &&
      Number.isFinite(range.min) &&
      Number.isFinite(range.max) &&
      range.min >= 0 &&
      range.max >= range.min
        ? { min: range.min, max: range.max }
        : null,
  };
}
