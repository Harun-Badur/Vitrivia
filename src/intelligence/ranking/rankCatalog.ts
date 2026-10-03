import { rerankForDiversity } from '../../../lib/diversity';
import { applyFeedMode, rankCandidates } from '../../../lib/scoring';
import type { Product } from '../../../types/product';
import type {
  FeedMode,
  RecsScoringConfig,
  SessionIntent,
  StyleProfileSnapshot,
} from '../../../types/recommendation';
import { toScoringCandidate } from './productCandidate';

export const rankCatalog = (
  catalog: Product[],
  userId: string,
  intent: SessionIntent,
  limit: number,
  mode: FeedMode,
  config: RecsScoringConfig,
  profile: StyleProfileSnapshot,
  nowMsOverride?: number,
): Product[] => {
  const rankedConfig = applyFeedMode(config, mode);
  const candidates = catalog
    .map(toScoringCandidate)
    .filter((candidate) => {
      if (
        intent.constraints.category !== null &&
        candidate.category !== intent.constraints.category
      ) {
        return false;
      }
      if (intent.constraints.gender !== null) {
        if (
          candidate.gender !== intent.constraints.gender &&
          candidate.gender !== 'unisex'
        ) {
          return false;
        }
      }
      return true;
    });

  const nowMs = nowMsOverride ?? Date.now();
  const scored = rankCandidates(
    candidates,
    profile,
    intent,
    rankedConfig,
    nowMs,
    userId,
  );
  const ranked = rerankForDiversity(
    scored,
    intent,
    rankedConfig,
    profile,
    limit,
    nowMs,
  );
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const ordered = ranked.flatMap((item) => {
    const product = byId.get(item.candidate.id);
    return product ? [product] : [];
  });
  return ordered.length > 0 ? ordered : catalog.slice(0, limit);
};
