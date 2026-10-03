import type { ProductFilters } from '../filters/productFilters';
import { filterProducts } from '../filters/productFilters';
import type { WardrobeItemForCandidate } from '../outfits/outfitCandidate';
import type { OutfitCandidateInput } from '../outfits/generateOutfitCandidates';
import { generateOutfitCandidates, generateOutfitCandidatesAsync } from '../outfits/generateOutfitCandidates';
import { generateWardrobeCatalogOutfits } from '../outfits/generateWardrobeCatalogOutfits';
import { rankOutfitCandidates, rankOutfitCandidatesAsync, rankDiversityCandidatesAsync } from '../outfits/rankOutfitCandidates';
import type { OutfitDiscoverRecommendation } from './discoverRecommendation';
import { selectDiverseComplements, selectDiverseComplementsAsync } from './selectDiverseComplements';
import type { CooperativeWorkOptions } from '../cooperativeWork';
import { createRecommendationMemo } from '../../../lib/recommendationMemo';

export interface DiscoverRecommendationInput<T extends WardrobeItemForCandidate>
  extends OutfitCandidateInput<T> {
  /** Existing hard catalog filters; omitted fields remain the caller's responsibility. */
  catalogFilters?: Pick<ProductFilters, 'query' | 'category' | 'gender' | 'size'>;
  /** Discover cards consume only the first ranked outfit. */
  firstOnly?: boolean;
  /** Counts of complements already shown in this caller's recommendation session. */
  recommendationExposure?: ReadonlyMap<string, number>;
}

/** Pure orchestration point for Discover's future outfit recommendation feed. */
const prepareInput = <T extends WardrobeItemForCandidate>(
  input: DiscoverRecommendationInput<T>,
) => {
  const catalogProducts = input.catalogFilters
    ? filterProducts([...input.catalogProducts], input.catalogFilters)
    : input.catalogProducts;
  const requiredProduct = input.requiredCatalogProductId
    ? catalogProducts.find((product) => product.id === input.requiredCatalogProductId)
    : undefined;
  const compatibleProducts = requiredProduct?.gender === 'women'
    ? catalogProducts.filter((product) => product.gender !== 'men')
    : requiredProduct?.gender === 'men'
      ? catalogProducts.filter((product) => product.gender !== 'women')
      : catalogProducts;

  const outfitInput = {
    wardrobeItems: input.wardrobeItems,
    catalogProducts: compatibleProducts,
    requiredCatalogProductId: input.requiredCatalogProductId,
    maximalOnly: input.firstOnly,
  };
  return { outfitInput, requiredProduct };
};

export const getDiscoverRecommendations = <T extends WardrobeItemForCandidate>(
  input: DiscoverRecommendationInput<T>,
): OutfitDiscoverRecommendation<T>[] => {
  const { outfitInput, requiredProduct } = prepareInput(input);
  if (input.firstOnly && requiredProduct) {
    const ranked = rankOutfitCandidates(generateOutfitCandidates(outfitInput), requiredProduct);
    const selection = selectDiverseComplements(ranked, requiredProduct, input.recommendationExposure);
    return selection ? [{ type: 'outfit', ...selection.outfit, rank: 1,
      sources: selection.outfit.candidate.sources, displayProducts: selection.products }] : [];
  }
  const ranked = generateWardrobeCatalogOutfits(outfitInput);
  return (input.firstOnly ? ranked.slice(0, 1) : ranked).map((entry) => ({
    type: 'outfit',
    ...entry,
    sources: entry.candidate.sources,
  }));
};

/** Exposure-independent pool, with its computation memo retained for selection. */
export const prepareDiscoverRankingAsync = async <T extends WardrobeItemForCandidate>(
  input: DiscoverRecommendationInput<T>, options?: CooperativeWorkOptions,
) => {
  const workOptions: CooperativeWorkOptions = {
    ...options,
    recommendationMemo: createRecommendationMemo(),
  };
  const { outfitInput, requiredProduct } = prepareInput(input);
  const diverse = !!(input.firstOnly && requiredProduct);
  const ranked = diverse
    ? await rankDiversityCandidatesAsync(outfitInput, requiredProduct!, workOptions)
    : await rankOutfitCandidatesAsync(await generateOutfitCandidatesAsync(outfitInput, workOptions),
      requiredProduct, workOptions);
  return { ranked, requiredProduct, diverse, firstOnly: input.firstOnly,
    recommendationMemo: workOptions.recommendationMemo };
};

export type PreparedDiscoverRanking<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> =
  Awaited<ReturnType<typeof prepareDiscoverRankingAsync<T>>>;

/** Changed exposure repeats only selection, never candidate generation or ranking. */
export const completeDiscoverRecommendationsAsync = async <T extends WardrobeItemForCandidate>(
  prepared: PreparedDiscoverRanking<T>, exposure?: ReadonlyMap<string, number>, options?: CooperativeWorkOptions,
): Promise<OutfitDiscoverRecommendation<T>[]> => {
  const { ranked, requiredProduct } = prepared;
  if (prepared.diverse && requiredProduct) {
    const selection = await selectDiverseComplementsAsync(ranked, requiredProduct, exposure,
      { ...options, recommendationMemo: prepared.recommendationMemo });
    return selection ? [{ type: 'outfit', ...selection.outfit, rank: 1,
      sources: selection.outfit.candidate.sources, displayProducts: selection.products }] : [];
  }
  return (prepared.firstOnly ? ranked.slice(0, 1) : ranked).map(entry => ({
    type: 'outfit', ...entry, sources: entry.candidate.sources,
  }));
};

/** Preserves the original full-pipeline API for existing callers. */
export const getDiscoverRecommendationsAsync = async <T extends WardrobeItemForCandidate>(
  input: DiscoverRecommendationInput<T>, options?: CooperativeWorkOptions,
): Promise<OutfitDiscoverRecommendation<T>[]> => completeDiscoverRecommendationsAsync(
  await prepareDiscoverRankingAsync(input, options), input.recommendationExposure, options,
);
