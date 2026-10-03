import type { Product } from '../../../types/product';
import type { DiscoverRecommendation } from './discoverRecommendation';

export const complementaryProductsForDisplay = (
  recommendations: readonly DiscoverRecommendation[],
  currentProductId: string | null,
): Product[] => {
  if (currentProductId === null) return [];
  const entry = recommendations.find((r) => r.type === 'outfit' && r.candidate.items.some((i) => i.sourceType === 'catalog' && i.sourceId === currentProductId));
  if (!entry || entry.type !== 'outfit') return [];
  const members = entry.candidate.items.flatMap((i) => i.sourceType === 'catalog' ? [i.product] : []);
  const candidates = entry.displayProducts ?? members;
  const seen = new Set([currentProductId]);
  return candidates.flatMap((p) => {
    if (seen.has(p.id) || !members.some((member) => member === p)) return [];
    seen.add(p.id);
    return [p];
  }).slice(0, 3);
};
