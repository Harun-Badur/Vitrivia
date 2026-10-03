export interface ImageDimensions {
  width: number;
  height: number;
}

export type DiscoverImageSlot = 'main' | 'recommendation';

export interface DiscoverImageFit {
  width: number;
  height: number;
  left: number;
  top: number;
  scale: number;
  position: 'center' | 'center-top';
  visibleWidthFraction: number;
  visibleHeightFraction: number;
}

// Approved hero frame: 853px wide, information panel begins at about 1150px.
export const DISCOVER_MAIN_IMAGE_RATIO = 853 / 1150;
export const DISCOVER_MAIN_COMPACT_RATIO = 0.95;
export const DISCOVER_INFO_MIN_HEIGHT = 80;
export const DISCOVER_INFO_MAX_HEIGHT = 96;
export const DISCOVER_RECOMMENDATION_IMAGE_RATIO = 3 / 4;
const SQUARE_IMAGE_THRESHOLD = 0.9;
const LONG_PORTRAIT_THRESHOLD = 0.625;
const MAX_BORDER_TRIM_SCALE = 1.04;
const LONG_PORTRAIT_TOP_ANCHOR = 0.45;

export const hasImageDimensions = (size: ImageDimensions): boolean =>
  Number.isFinite(size.width) &&
  Number.isFinite(size.height) &&
  size.width > 0 &&
  size.height > 0;

/** Geometry only: no claim to detect white pixels, a face, or garment boundaries. */
export function getDiscoverImageFit(
  source: ImageDimensions,
  viewport: ImageDimensions,
  slot: DiscoverImageSlot,
): DiscoverImageFit | null {
  if (!hasImageDimensions(source) || !hasImageDimensions(viewport)) return null;
  const sourceRatio = source.width / source.height;
  // Cover with a single scale; never independently resize width and height.
  const fillScale = Math.max(
    viewport.width / source.width,
    viewport.height / source.height,
  );
  // A small symmetric trim reduces peripheral whitespace in square/wide assets.
  // Never add zoom to portraits, where it would unnecessarily cut head/feet.
  const borderTrim =
    sourceRatio >= SQUARE_IMAGE_THRESHOLD ? MAX_BORDER_TRIM_SCALE : 1;
  const scale = fillScale * borderTrim;
  const width = source.width * scale;
  const height = source.height * scale;
  const position =
    slot === 'main' && sourceRatio <= LONG_PORTRAIT_THRESHOLD
      ? 'center-top'
      : 'center';
  const anchorY = position === 'center-top' ? LONG_PORTRAIT_TOP_ANCHOR : 0.5;
  return {
    width,
    height,
    scale,
    left: (viewport.width - width) / 2,
    top: (viewport.height - height) * anchorY,
    position,
    visibleWidthFraction: viewport.width / width,
    visibleHeightFraction: viewport.height / height,
  };
}
