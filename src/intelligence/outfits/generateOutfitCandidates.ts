import { isOutfitRole, type OutfitRole, type Product } from '../../../types/product';
import { cooperativeSort, runCooperatively, runSynchronously, type CooperativeWorkOptions } from '../cooperativeWork';
import {
  hasGenderConflict,
  isCatalogRoleCompatible,
  isValidOutfitItems,
  OUTFIT_ROLE_ORDER,
  resolveWardrobeRole,
  type OutfitCandidate,
  type OutfitCandidateItem,
  type OutfitSourceType,
  type WardrobeItemForCandidate,
} from './outfitCandidate';

export interface OutfitCandidateInput<T extends WardrobeItemForCandidate> {
  wardrobeItems: readonly T[];
  catalogProducts: readonly Product[];
  /** Restrict generation to outfits containing this catalog item when supplied. */
  requiredCatalogProductId?: string;
  /** Keep only the highest optional-role tier when the caller needs the first rank. */
  maximalOnly?: boolean;
}

const roleIndex = (role: OutfitRole): number => OUTFIT_ROLE_ORDER.indexOf(role);
const sourceIndex = (source: OutfitSourceType): number =>
  source === 'wardrobe' ? 0 : 1;
const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareItems = <T extends WardrobeItemForCandidate>(
  left: OutfitCandidateItem<T>,
  right: OutfitCandidateItem<T>,
): number =>
  roleIndex(left.role) - roleIndex(right.role) ||
  sourceIndex(left.sourceType) - sourceIndex(right.sourceType) ||
  compareText(left.sourceId, right.sourceId);

/** Keeps only items with an explicit, unambiguous role and a stable source ID. */
export const normalizeOutfitItems = <T extends WardrobeItemForCandidate>(
  input: OutfitCandidateInput<T>,
): OutfitCandidateItem<T>[] => {
  const items: OutfitCandidateItem<T>[] = [];
  for (const wardrobeItem of input.wardrobeItems) {
    const role = resolveWardrobeRole(wardrobeItem);
    const sourceId = wardrobeItem.id.trim();
    if (role && sourceId) {
      items.push({ sourceType: 'wardrobe', sourceId, role, wardrobeItem });
    }
  }
  for (const product of input.catalogProducts) {
    const role = isOutfitRole(product.outfitRole) ? product.outfitRole : null;
    const sourceId = product.id.trim();
    if (role && sourceId && isCatalogRoleCompatible(product, role)) {
      items.push({ sourceType: 'catalog', sourceId, role, product });
    }
  }
  items.sort(compareItems);
  const rolesBySource = new Map<string, Set<OutfitRole>>();
  for (const item of items) {
    const key = JSON.stringify([item.sourceType, item.sourceId]);
    const roles = rolesBySource.get(key) ?? new Set<OutfitRole>();
    roles.add(item.role);
    rolesBySource.set(key, roles);
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify([item.sourceType, item.sourceId]);
    if (seen.has(key) || rolesBySource.get(key)?.size !== 1) return false;
    seen.add(key);
    return true;
  });
};

const OPTIONAL_ROLES: readonly OutfitRole[] = [
  'outerwear', 'shoes', 'bag', 'hat', 'accessory',
];

// Bound retained catalog/wardrobe snapshots; never key only by mutable arrays.
const preparationCache = new Map<string, {
  normalized: OutfitCandidateItem[];
  roleIndices: Map<OutfitRole, number[]>;
}>();
const preparationObjectIds = new WeakMap<object, number>();
let nextPreparationObjectId = 0;
const preparationObjectId = (object: object): number => {
  let id = preparationObjectIds.get(object);
  if (id === undefined) {
    id = ++nextPreparationObjectId;
    preparationObjectIds.set(object, id);
  }
  return id;
};

/** Anchor-independent preparation; return fresh wrappers/groups to protect the cache. */
export const prepareOutfitItems = <T extends WardrobeItemForCandidate>(input: OutfitCandidateInput<T>) => {
  // Preserve raw values and input order, including stable duplicate winners.
  // Product references stay live for ranking metadata that preparation does not read.
  const key = JSON.stringify([
    input.catalogProducts.map(product => [preparationObjectId(product), product.id,
      product.outfitRole, product.category, product.subcategory, product.gender]),
    input.wardrobeItems.map(item => [preparationObjectId(item), item.id, item.category, item.subcategory]),
  ]);
  let prepared = preparationCache.get(key);
  if (!prepared) {
    const normalized = normalizeOutfitItems(input);
    const roleIndices = new Map<OutfitRole, number[]>();
    normalized.forEach((item, index) => {
      const group = roleIndices.get(item.role) ?? [];
      group.push(index);
      roleIndices.set(item.role, group);
    });
    prepared = { normalized, roleIndices };
    if (preparationCache.size >= 8) preparationCache.delete(preparationCache.keys().next().value!);
    preparationCache.set(key, prepared);
  }
  // The key includes every source object's identity, so this generic binding is exact.
  const normalized = prepared.normalized.map(item => ({ ...item })) as OutfitCandidateItem<T>[];
  const byRole = new Map<OutfitRole, OutfitCandidateItem<T>[]>();
  for (const [role, indices] of prepared.roleIndices) {
    byRole.set(role, indices.map(index => normalized[index]));
  }
  return { normalized, byRole };
};

/** Search callbacks see valid leaves before IDs, colors, reasons or candidate objects exist. */
export interface OutfitCandidateSearch<T extends WardrobeItemForCandidate> {
  canExtend: (items: readonly OutfitCandidateItem<T>[],
    remaining: readonly (readonly OutfitCandidateItem<T>[])[], optionalCount: number) => boolean;
  accept: (items: readonly OutfitCandidateItem<T>[], optionalCount: number) => boolean;
}

function* candidateWork<T extends WardrobeItemForCandidate>(
  input: OutfitCandidateInput<T>, cooperative = false, search?: OutfitCandidateSearch<T>,
): Generator<void, OutfitCandidate<T>[], void> {
  const { normalized, byRole } = prepareOutfitItems(input);
  const required = input.requiredCatalogProductId
    ? normalized.find((item) => item.sourceType === 'catalog' &&
      item.sourceId === input.requiredCatalogProductId)
    : undefined;
  if (input.requiredCatalogProductId && !required) return [];
  const remainingGroups = OPTIONAL_ROLES.map(role => required?.role === role
    ? [required] : byRole.get(role) ?? []);
  const suffixGroups = Array.from({ length: OPTIONAL_ROLES.length + 1 }, (_, index) => remainingGroups.slice(index));

  const bases: OutfitCandidateItem<T>[][] = [];
  // Restrict only the core alternatives that the required role already excludes.
  // Singleton groups preserve the original order of all retained pairs.
  const tops = required?.role === 'one_piece' ? []
    : required?.role === 'top' ? [required] : byRole.get('top') ?? [];
  const bottoms = required?.role === 'bottom' ? [required] : byRole.get('bottom') ?? [];
  for (const top of tops) {
    for (const bottom of bottoms) {
      yield;
      if (!hasGenderConflict([top, bottom])) bases.push([top, bottom]);
    }
  }
  const onePieces = required?.role === 'top' || required?.role === 'bottom' ? []
    : required?.role === 'one_piece' ? [required] : byRole.get('one_piece') ?? [];
  for (const onePiece of onePieces) {
    bases.push([onePiece]);
  }

  const candidates = new Map<string, OutfitCandidate<T>>();
  let highestOptionalCount = -1;
  const remainingOptionalCapacity = Array<number>(OPTIONAL_ROLES.length + 1).fill(0);
  for (let index = OPTIONAL_ROLES.length - 1; index >= 0; index--) {
    remainingOptionalCapacity[index] = remainingOptionalCapacity[index + 1] +
      Number((byRole.get(OPTIONAL_ROLES[index])?.length ?? 0) > 0);
  }
  const collect = (items: OutfitCandidateItem<T>[], optionalCount: number): void => {
    if (input.maximalOnly && optionalCount < highestOptionalCount) return;
    if (!isValidOutfitItems(items)) return;
    if (input.maximalOnly && optionalCount > highestOptionalCount) {
      candidates.clear();
      highestOptionalCount = optionalCount;
    }
    if (search && !search.accept(items, optionalCount)) return;
    const ordered = [...items].sort(compareItems);
    const id = JSON.stringify(ordered.map((item) => [item.sourceType, item.sourceId, item.role]));
    if (candidates.has(id)) return;
    candidates.set(id, {
      id,
      items: ordered,
      roles: ordered.map((item) => item.role),
      sources: (['wardrobe', 'catalog'] as const).filter((source) =>
        ordered.some((item) => item.sourceType === source)),
    });
  };
  function* extend(
    items: OutfitCandidateItem<T>[], optionalIndex: number, optionalCount: number,
  ): Generator<void, void, void> {
    yield;
    if (input.maximalOnly &&
        optionalCount + remainingOptionalCapacity[optionalIndex] < highestOptionalCount) return;
    if (search && !search.canExtend(items, suffixGroups[optionalIndex], optionalCount)) return;
    if (optionalIndex === OPTIONAL_ROLES.length) {
      collect(items, optionalCount);
      return;
    }
    const role = OPTIONAL_ROLES[optionalIndex];
    if (required?.role === role) {
      const next = [...items, required];
      if (!hasGenderConflict(next)) yield* extend(next, optionalIndex + 1, optionalCount + 1);
      return;
    }
    function* withRole(): Generator<void, void, void> {
      for (const item of byRole.get(role) ?? []) {
        const next = [...items, item];
        if (!hasGenderConflict(next)) yield* extend(next, optionalIndex + 1, optionalCount + 1);
      }
    }
    if (input.maximalOnly) {
      yield* withRole();
      yield* extend(items, optionalIndex + 1, optionalCount);
    } else {
      yield* extend(items, optionalIndex + 1, optionalCount);
      yield* withRole();
    }
  }
  for (const base of bases) yield* extend(base, 0, 0);
  const values = [...candidates.values()];
  const compare = (left: OutfitCandidate<T>, right: OutfitCandidate<T>): number => compareText(left.id, right.id);
  return cooperative ? yield* cooperativeSort(values, compare) : values.sort(compare);
}

export const generateOutfitCandidates = <T extends WardrobeItemForCandidate>(
  input: OutfitCandidateInput<T>,
): OutfitCandidate<T>[] => runSynchronously(candidateWork(input));

export const generateOutfitCandidatesAsync = <T extends WardrobeItemForCandidate>(
  input: OutfitCandidateInput<T>, options?: CooperativeWorkOptions,
): Promise<OutfitCandidate<T>[]> => runCooperatively(candidateWork(input, true), options);

export const searchOutfitCandidatesAsync = <T extends WardrobeItemForCandidate>(
  input: OutfitCandidateInput<T>, search: OutfitCandidateSearch<T>, options?: CooperativeWorkOptions,
): Promise<OutfitCandidate<T>[]> => runCooperatively(candidateWork(input, true, search), options);
