import type { OutfitRole } from '../../../types/product';
import { recommendationMemoValue, normalizedRecommendationToken } from '../../../lib/recommendationMemo';
import {
  isValidOutfitItems,
  type OutfitCandidate,
  type OutfitCandidateItem,
  type WardrobeItemForCandidate,
} from './outfitCandidate';

export interface OutfitRankingValue {
  validRoles: boolean;
  coreComplete: boolean;
  missingCoreRoles: OutfitRole[];
  optionalRoleCount: number;
  sharedStyleTags: string[];
  sharedColors: string[];
  compatibilityScore?: number;
}

export type OutfitRankingReason =
  | { code: 'core_complete'; form: 'one_piece' | 'two_piece' }
  | { code: 'missing_core_roles'; roles: OutfitRole[] }
  | { code: 'invalid_role_combination' }
  | { code: 'optional_roles'; roles: OutfitRole[] }
  | { code: 'shared_style_tags'; tags: string[] }
  | { code: 'shared_colors'; colors: string[] }
  | { code: 'mixed_sources' };

export interface RankedOutfitCandidate<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> {
  candidate: OutfitCandidate<T>;
  rank: number;
  rankingValue: OutfitRankingValue;
  reasons: OutfitRankingReason[];
}

const OPTIONAL_ROLES: readonly OutfitRole[] = [
  'outerwear', 'shoes', 'bag', 'hat', 'accessory',
];

const normalizeToken = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return normalizedRecommendationToken(value, true, () => {

  const token = value.trim().toLocaleLowerCase('tr-TR');
  return token;

  }) || null;
};

const stringTokens = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const token = normalizeToken(item);
        return token ? [token] : [];
      })
    : [];

type WardrobeMetadata = WardrobeItemForCandidate & {
  color?: unknown;
  secondary_colors?: unknown;
  style_tags?: unknown;
};

const itemStyleTags = (item: OutfitCandidateItem): string[] => {

  if (item.sourceType === 'catalog') return [];
  const wardrobeItem = item.wardrobeItem as WardrobeMetadata;
  return stringTokens(wardrobeItem.style_tags);

};

const itemColors = (item: OutfitCandidateItem): string[] => {

  if (item.sourceType === 'catalog') {
    return [
      ...stringTokens(item.product.colorSlugs),
      ...stringTokens(item.product.colors?.map((color) => color.name)),
    ];
  }
  const wardrobeItem = item.wardrobeItem as WardrobeMetadata;
  const primary = normalizeToken(wardrobeItem.color);
  return [
    ...(primary ? [primary] : []),
    ...stringTokens(wardrobeItem.secondary_colors),
  ];

};

const sharedTokens = (
  items: readonly OutfitCandidateItem[],
  readTokens: (item: OutfitCandidateItem) => string[],
): string[] => {
  const tokens = items.map(item => readTokens(item));
  const key = JSON.stringify(['tr-TR', items.map((item, index) => [
    item.sourceType, item.sourceId, item.role, tokens[index],
  ])]);
  return [...recommendationMemoValue('sharedTokensMemo', key, () => {

  const occurrences = new Map<string, number>();
  for (const itemTokens of tokens) {
    for (const token of new Set(itemTokens)) {
      occurrences.set(token, (occurrences.get(token) ?? 0) + 1);
    }
  }
  return [...occurrences]
    .filter(([, count]) => count > 1)
    .map(([token]) => token)
    .sort();

  })];
};

export interface OutfitRankingTokenCache {
  styleTags: WeakMap<object, string[]>;
  colors: WeakMap<object, string[]>;
}

export const createOutfitRankingTokenCache = (): OutfitRankingTokenCache => ({
  styleTags: new WeakMap(),
  colors: new WeakMap(),
});

const cachedTokens = (
  item: OutfitCandidateItem,
  cache: WeakMap<object, string[]>,
  readTokens: (item: OutfitCandidateItem) => string[],
): string[] => {
  const cached = cache.get(item);
  if (cached) { return cached; }
  const tokens = readTokens(item);
  cache.set(item, tokens);
  return tokens;
};

export const readOutfitStyleTags = (item: OutfitCandidateItem, cache: OutfitRankingTokenCache): string[] =>
  cachedTokens(item, cache.styleTags, itemStyleTags);

/** These are the only ranking fields used to define the diversity admission tier. */
export const evaluateOutfitMinimum = (
  items: readonly OutfitCandidateItem[], cache: OutfitRankingTokenCache,
): { sharedStyleTags: string[] } => ({
  sharedStyleTags: sharedTokens(items, item => readOutfitStyleTags(item, cache)),
});

/** Reads only metadata already attached to candidate items; never infers from text. */
export const evaluateOutfitCandidate = <T extends WardrobeItemForCandidate>(
  candidate: OutfitCandidate<T>,
  tokenCache?: OutfitRankingTokenCache,
): { rankingValue: OutfitRankingValue; reasons: OutfitRankingReason[] } => {
  const roles = new Set(candidate.items.map((item) => item.role));
  const hasOnePiece = roles.has('one_piece');
  const hasTwoPiece = roles.has('top') && roles.has('bottom');
  const coreComplete = hasOnePiece
    ? !roles.has('top') && !roles.has('bottom')
    : hasTwoPiece;
  const missingCoreRoles: OutfitRole[] = hasOnePiece
    ? []
    : (['top', 'bottom'] as const).filter((role) => !roles.has(role));
  const validRoles = isValidOutfitItems(candidate.items);
  const optionalRoles = OPTIONAL_ROLES.filter((role) => roles.has(role));
  const sharedStyleTags = sharedTokens(candidate.items, tokenCache
    ? (item) => cachedTokens(item, tokenCache.styleTags, itemStyleTags)
    : itemStyleTags);
  const sharedColors = sharedTokens(candidate.items, tokenCache
    ? (item) => cachedTokens(item, tokenCache.colors, itemColors)
    : itemColors);
  const reasons: OutfitRankingReason[] = [];

  if (!validRoles) reasons.push({ code: 'invalid_role_combination' });
  if (validRoles && coreComplete) {
    reasons.push({ code: 'core_complete', form: hasOnePiece ? 'one_piece' : 'two_piece' });
  } else if (missingCoreRoles.length > 0) {
    reasons.push({ code: 'missing_core_roles', roles: missingCoreRoles });
  }
  if (optionalRoles.length > 0) reasons.push({ code: 'optional_roles', roles: optionalRoles });
  if (sharedStyleTags.length > 0) {
    reasons.push({ code: 'shared_style_tags', tags: sharedStyleTags });
  }
  if (sharedColors.length > 0) reasons.push({ code: 'shared_colors', colors: sharedColors });
  if (candidate.items.some((item) => item.sourceType === 'wardrobe') &&
      candidate.items.some((item) => item.sourceType === 'catalog')) {
    reasons.push({ code: 'mixed_sources' });
  }

  return {
    rankingValue: {
      validRoles,
      coreComplete,
      missingCoreRoles,
      optionalRoleCount: optionalRoles.length,
      sharedStyleTags,
      sharedColors,
    },
    reasons,
  };
};
