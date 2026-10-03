import type { Product } from '../../../types/product';
import type {
  OutfitSourceType,
  WardrobeItemForCandidate,
} from '../outfits/outfitCandidate';
import type { RankedOutfitCandidate } from '../outfits/outfitRanking';

export interface OutfitDiscoverRecommendation<T extends WardrobeItemForCandidate = WardrobeItemForCandidate>
  extends RankedOutfitCandidate<T> {
  type: 'outfit';
  sources: OutfitSourceType[];
  /** Engine-selected, co-occurring complements in display priority order. */
  displayProducts?: readonly Product[];
}

/** Contract for a future adapter of the existing product recommendation feed. */
export interface CatalogDiscoverRecommendation {
  type: 'product';
  product: Product;
  rank: number;
  rankingValue: number;
  reasons: string[];
  sources: ['catalog'];
}

export type DiscoverRecommendation<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> =
  | OutfitDiscoverRecommendation<T>
  | CatalogDiscoverRecommendation;
