import type { SoftFilterKey } from './feedFilter';
import {
  CATEGORY_CHIP_LABELS,
  COLOR_CHIP_LABELS,
  type FeedQueryFilters,
} from './feedQuery';
import { GARMENT_CATEGORY_LABEL } from '../types/product';

const RELAX_LABEL: Record<SoftFilterKey, string> = {
  color: 'Renk',
  style: 'Stil',
  text: 'Metin',
};

const remainingSummary = (filters: FeedQueryFilters, relaxed: SoftFilterKey[]): string => {
  const dropped = new Set(relaxed);
  const parts: string[] = [];
  if (filters.category) {
    parts.push(
      CATEGORY_CHIP_LABELS[filters.category] ??
        GARMENT_CATEGORY_LABEL[filters.category],
    );
  }
  if (filters.color && !dropped.has('color')) {
    parts.push(COLOR_CHIP_LABELS[filters.color] ?? filters.color);
  }
  if (filters.style && !dropped.has('style')) {
    parts.push(filters.style);
  }
  if (filters.brand) {
    parts.push(filters.brand);
  }
  if (filters.text && filters.text.trim().length > 0 && !dropped.has('text')) {
    parts.push(filters.text.trim());
  }
  if (parts.length === 0) {
    return 'sonuçlar';
  }
  if (parts.length === 1) {
    return `${parts[0]} sonuçları`;
  }
  return `${parts.join(' · ')} sonuçları`;
};

/**
 * Banner copy when soft facets were relaxed or personal fallback applied.
 * Never returns empty when either signal is present.
 */
export const searchRelaxBannerText = (
  filters: FeedQueryFilters,
  relaxed: readonly string[],
  fallback: boolean,
): string | null => {
  if (fallback) {
    return 'Eşleşme yok — benzerlerini gösteriyoruz';
  }
  const soft = relaxed.filter(
    (key): key is SoftFilterKey =>
      key === 'color' || key === 'style' || key === 'text',
  );
  if (soft.length === 0) {
    return null;
  }
  const primary = soft[0] ?? 'color';
  const label = RELAX_LABEL[primary];
  return `${label} eşleşmedi — ${remainingSummary(filters, soft)} gösteriliyor`;
};
