import type { WardrobeItemForCandidate } from './outfitCandidate';
import {
  generateOutfitCandidates,
  type OutfitCandidateInput,
} from './generateOutfitCandidates';
import type { RankedOutfitCandidate } from './outfitRanking';
import { rankOutfitCandidates } from './rankOutfitCandidates';

/** Builds and ranks source-independent outfits without changing either engine. */
export const generateWardrobeCatalogOutfits = <T extends WardrobeItemForCandidate>(
  input: OutfitCandidateInput<T>,
): RankedOutfitCandidate<T>[] =>
  rankOutfitCandidates(generateOutfitCandidates(input),
    input.catalogProducts.find((product) => product.id === input.requiredCatalogProductId));
