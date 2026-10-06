import {
  createOutfitRankingTokenCache,
  evaluateOutfitCandidate,
  evaluateOutfitMinimum,
  readOutfitStyleTags,
  type OutfitRankingValue,
  type RankedOutfitCandidate,
} from './outfitRanking';
import type { OutfitCandidate, OutfitCandidateItem, WardrobeItemForCandidate } from './outfitCandidate';
import { hasCoreFootwear } from './outfitCandidate';
import type { Product } from '../../../types/product';
import { catalogCompatibility, catalogSemanticKey } from './catalogCompatibility';
import { cooperativeSort, runCooperatively, runSynchronously, type CooperativeWorkOptions } from '../cooperativeWork';
import { searchOutfitCandidatesAsync, type OutfitCandidateInput } from './generateOutfitCandidates';

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Hard structure first, then measured soft compatibility; never compare identifiers. */
const compareValues = (left: OutfitRankingValue, right: OutfitRankingValue,
  leftFootwear: boolean, rightFootwear: boolean): number =>
  Number(right.validRoles) - Number(left.validRoles) ||
  Number(right.coreComplete) - Number(left.coreComplete) ||
  left.missingCoreRoles.length - right.missingCoreRoles.length ||
  Number(rightFootwear) - Number(leftFootwear) ||
  right.optionalRoleCount - left.optionalRoleCount ||
  right.sharedStyleTags.length - left.sharedStyleTags.length ||
  (right.compatibilityScore ?? 0) - (left.compatibilityScore ?? 0) ||
  right.sharedColors.length - left.sharedColors.length;

const compareEvaluated = (
  left: { candidate: OutfitCandidate; rankingValue: OutfitRankingValue },
  right: { candidate: OutfitCandidate; rankingValue: OutfitRankingValue },
  cache: WeakMap<object, string>,
): number =>
  compareValues(left.rankingValue, right.rankingValue,
    hasCoreFootwear(left.candidate.items), hasCoreFootwear(right.candidate.items)) ||
  compareSemantics(left.candidate, right.candidate, cache);

const semanticItemKey = (item: OutfitCandidateItem, cache: WeakMap<object, string>): string => {
  const cached = cache.get(item);
  if (cached !== undefined) { return cached; }
  const key = item.sourceType === 'catalog' ? catalogSemanticKey(item.product)
    : JSON.stringify([item.role, item.wardrobeItem.category, item.wardrobeItem.subcategory]);
  cache.set(item, key);
  return key;
};

const compareSemantics = (left: OutfitCandidate, right: OutfitCandidate, cache: WeakMap<object, string>): number => {
  for (let index = 0; index < Math.min(left.items.length, right.items.length); index++) {
    const compared = compareText(semanticItemKey(left.items[index], cache), semanticItemKey(right.items[index], cache));
    if (compared) return compared;
  }
  return left.items.length - right.items.length;
};

const compatibilityForItems = (items: readonly OutfitCandidateItem[], anchor?: Product, cache?: WeakMap<Product, number>): number => {

  const products = items.flatMap((item) => item.sourceType === 'catalog' ? [item.product] : []);
  if (anchor) {
    const complements = products.filter((product) => product.id !== anchor.id);
    const scores = complements.map((product) => {
      const cached = cache?.get(product);
      if (cached !== undefined) { return cached; }
      const score = catalogCompatibility(anchor, product).score;
      cache?.set(product, score);
      return score;
    });
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  }
  let sum = 0, pairs = 0;
  for (let left = 0; left < products.length; left++) {
    for (let right = left + 1; right < products.length; right++) {
      sum += catalogCompatibility(products[left], products[right]).score;
      pairs++;
    }
  }
  return pairs ? sum / pairs : 0;

};

const compatibilityValue = (candidate: OutfitCandidate, anchor?: Product, cache?: WeakMap<Product, number>): number =>
  compatibilityForItems(candidate.items, anchor, cache);

function* rankingWork<T extends WardrobeItemForCandidate>(
  candidates: readonly OutfitCandidate<T>[],
  anchor?: Product,
  cooperative = false,
): Generator<void, RankedOutfitCandidate<T>[], void> {
  const tokenCache = createOutfitRankingTokenCache();
  const compatibilityCache = new WeakMap<Product, number>();
  const semanticCache = new WeakMap<object, string>();
  const entries: Omit<RankedOutfitCandidate<T>, 'rank'>[] = [];
  for (const candidate of candidates) {
    const evaluated = evaluateOutfitCandidate(candidate, tokenCache);
    entries.push({ candidate, ...evaluated, rankingValue: { ...evaluated.rankingValue, compatibilityScore: compatibilityValue(candidate, anchor, compatibilityCache) } });
    yield;
  }
  const compare = (left: typeof entries[number], right: typeof entries[number]): number =>
    compareEvaluated(left, right, semanticCache);
  const sorted = cooperative ? yield* cooperativeSort(entries, compare) : entries.sort(compare);
  const ranked: RankedOutfitCandidate<T>[] = [];
  for (const [index, entry] of sorted.entries()) {
    ranked.push({ ...entry, rank: index + 1 });
    yield;
  }
  return ranked;
}

export const rankOutfitCandidates = <T extends WardrobeItemForCandidate>(
  candidates: readonly OutfitCandidate<T>[], anchor?: Product,
): RankedOutfitCandidate<T>[] => runSynchronously(rankingWork(candidates, anchor));

export const rankOutfitCandidatesAsync = <T extends WardrobeItemForCandidate>(
  candidates: readonly OutfitCandidate<T>[], anchor?: Product, options?: CooperativeWorkOptions,
): Promise<RankedOutfitCandidate<T>[]> => runCooperatively(rankingWork(candidates, anchor, true), options);

interface DiversityBoundary {
  footwear: number;
  optionalCount: number;
  styleCount: number;
  compatibility: number;
}

/**
 * Exact firstOnly search: generation guarantees valid/complete core roles. Diversity
 * admits the best core-footwear tier first, then its optional/style tier and
 * compatibility >= best - 0.12.
 * Colors, reasons and semantic ties therefore cannot change admission, but are
 * still evaluated by the original stable ranking for every retained candidate.
 * Full ranking of arbitrary input remains the reference path above.
 */
export const rankDiversityCandidatesAsync = async <T extends WardrobeItemForCandidate>(
  input: OutfitCandidateInput<T>, anchor: Product, options?: CooperativeWorkOptions,
): Promise<RankedOutfitCandidate<T>[]> => {
  const tokens = createOutfitRankingTokenCache();
  const scores = new WeakMap<Product, number>();
  const score = (product: Product): number => {
    const cached = scores.get(product);
    if (cached !== undefined) return cached;
    const value = catalogCompatibility(anchor, product).score;
    scores.set(product, value);
    return value;
  };
  type Remaining = readonly (readonly OutfitCandidateItem<T>[])[];
  const futures = new WeakMap<Remaining, { footwear: boolean; capacity: number; sums: number[]; tags: Map<string, number> }>();
  const future = (groups: Remaining) => {
    const cached = futures.get(groups);
    if (cached) return cached;
    let sums = [0], capacity = 0, footwear = false;
    const tags = new Map<string, number>();
    for (const group of groups) {
      if (group.length === 0) continue;
      footwear ||= group.some(item => item.role === 'shoes');
      capacity++;
      let zero = false, maximum = -Infinity;
      const roleTags = new Set<string>();
      for (const item of group) {
        if (item.sourceType === 'wardrobe') {
          zero = true;
          readOutfitStyleTags(item, tokens).forEach(tag => roleTags.add(tag));
        } else if (item.product.id === anchor.id) zero = true;
        else maximum = Math.max(maximum, score(item.product));
      }
      for (const tag of roleTags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      // Relax gender/style/co-occurrence constraints. For each possible number
      // of catalog complements retain the largest achievable sum, including
      // wardrobe alternatives (zero added sum AND zero added denominator).
      const next = Array<number>(sums.length + 1).fill(-Infinity);
      for (let count = 0; count < sums.length; count++) {
        if (zero) next[count] = Math.max(next[count], sums[count]);
        if (maximum !== -Infinity) next[count + 1] = Math.max(next[count + 1], sums[count] + maximum);
      }
      sums = next;
    }
    const value = { footwear, capacity, sums, tags };
    futures.set(groups, value);
    return value;
  };
  const styleUpper = (items: readonly OutfitCandidateItem<T>[], remaining: ReturnType<typeof future>): number => {
    if (input.wardrobeItems.length === 0) return 0;
    const possible = new Map(remaining.tags);
    for (const item of items) {
      if (item.sourceType !== 'wardrobe') continue;
      for (const tag of new Set(readOutfitStyleTags(item, tokens))) possible.set(tag, (possible.get(tag) ?? 0) + 1);
    }
    // A tag can be shared only if at least two distinct selected/future roles
    // can carry it. Unioning alternatives deliberately overestimates feasibility.
    let count = 0;
    for (const occurrences of possible.values()) if (occurrences >= 2) count++;
    return count;
  };
  const compatibilityUpper = (items: readonly OutfitCandidateItem<T>[], remaining: ReturnType<typeof future>): number => {
    let sum = 0, count = 0;
    for (const item of items) if (item.sourceType === 'catalog' && item.product.id !== anchor.id) {
      sum += score(item.product);
      count++;
    }
    let maximum = 0;
    for (let extra = 0; extra < remaining.sums.length; extra++) {
      if (remaining.sums[extra] === -Infinity) continue;
      const size = count + extra;
      maximum = Math.max(maximum, size ? (sum + remaining.sums[extra]) / size : 0);
    }
    // At most seven bounded additions; retain all boundary/equal cases despite rounding.
    return maximum + 1e-12;
  };
  let best: DiversityBoundary | null = null;
  const minimum = (items: readonly OutfitCandidateItem<T>[], optionalCount: number): DiversityBoundary => ({
    footwear: Number(hasCoreFootwear(items)),
    optionalCount,
    styleCount: evaluateOutfitMinimum(items, tokens).sharedStyleTags.length,
    compatibility: compatibilityForItems(items, anchor, scores),
  });
  const searchInput = { ...input, maximalOnly: true };
  // Pass one visits lightweight leaves, never constructing candidate objects or sorting them.
  await searchOutfitCandidatesAsync(searchInput, {
    canExtend: (items, groups, optionalCount) => {
      if (!best) return true;
      const remaining = future(groups), capacity = optionalCount + remaining.capacity;
      const footwear = Number(hasCoreFootwear(items) || remaining.footwear);
      if (footwear !== best.footwear) return footwear > best.footwear;
      if (capacity !== best.optionalCount) return capacity > best.optionalCount;
      const styles = styleUpper(items, remaining);
      if (styles !== best.styleCount) return styles > best.styleCount;
      return compatibilityUpper(items, remaining) >= best.compatibility;
    },
    accept: (items, optionalCount) => {
      const value = minimum(items, optionalCount);
      if (!best || value.footwear > best.footwear ||
        (value.footwear === best.footwear && (value.optionalCount > best.optionalCount ||
          (value.optionalCount === best.optionalCount && (value.styleCount > best.styleCount ||
            (value.styleCount === best.styleCount && value.compatibility > best.compatibility)))))) best = value;
      return false;
    },
  }, options);
  if (best === null) {
    return [];
  }
  const boundary: DiversityBoundary = best;
  const threshold = boundary.compatibility - 0.12;
  // Pass two retains the complete diversity band, not a fixed number of winners.
  const candidates = await searchOutfitCandidatesAsync(searchInput, {
    canExtend: (items, groups, optionalCount) => {
      const remaining = future(groups), capacity = optionalCount + remaining.capacity;
      if (Number(hasCoreFootwear(items) || remaining.footwear) < boundary.footwear) return false;
      if (capacity < boundary.optionalCount || styleUpper(items, remaining) < boundary.styleCount) return false;
      // If excess roles appear possible, skipping is still allowed: do not apply this bound.
      return capacity > boundary.optionalCount || compatibilityUpper(items, remaining) >= threshold;
    },
    accept: (items, optionalCount) => {
      if (Number(hasCoreFootwear(items)) !== boundary.footwear || optionalCount !== boundary.optionalCount) return false;
      const value = minimum(items, optionalCount);
      return value.styleCount === boundary.styleCount && value.compatibility >= threshold;
    },
  }, options);
  // ID ordering before a stable rank sort is unchanged, including genuinely equal evidence.
  return rankOutfitCandidatesAsync(candidates, anchor, options);
};

/** Same ordering as rankOutfitCandidates, without sorting when only rank 1 is used. */
export const rankTopOutfitCandidate = <T extends WardrobeItemForCandidate>(
  candidates: readonly OutfitCandidate<T>[],
  anchor?: Product,
): RankedOutfitCandidate<T>[] => {
  let best: (Omit<RankedOutfitCandidate<T>, 'rank'>) | null = null;
  const tokenCache = createOutfitRankingTokenCache();
  const compatibilityCache = new WeakMap<Product, number>();
  const semanticCache = new WeakMap<object, string>();
  for (const candidate of candidates) {
    const evaluated = evaluateOutfitCandidate(candidate, tokenCache);
    const entry = { candidate, ...evaluated, rankingValue: { ...evaluated.rankingValue, compatibilityScore: compatibilityValue(candidate, anchor, compatibilityCache) } };
    if (best === null || compareEvaluated(entry, best, semanticCache) < 0) best = entry;
  }
  return best === null ? [] : [{ ...best, rank: 1 }];
};
