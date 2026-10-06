import { isOutfitRole, type OutfitRole, type Product } from '../../../types/product';
import { normalizedRecommendationToken } from '../../../lib/recommendationMemo';

/** Fields already present on public.wardrobe_items that candidate generation needs. */
export interface WardrobeItemForCandidate {
  id: string;
  category: string;
  subcategory?: string | null;
}

export type OutfitSourceType = 'wardrobe' | 'catalog';

export type OutfitCandidateItem<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> =
  | {
      sourceType: 'wardrobe';
      sourceId: string;
      role: OutfitRole;
      wardrobeItem: T;
      product?: never;
    }
  | {
      sourceType: 'catalog';
      sourceId: string;
      role: OutfitRole;
      product: Product;
      wardrobeItem?: never;
    };

export interface OutfitCandidate<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> {
  id: string;
  items: OutfitCandidateItem<T>[];
  roles: OutfitRole[];
  sources: OutfitSourceType[];
}

export const OUTFIT_ROLE_ORDER: readonly OutfitRole[] = [
  'top', 'bottom', 'one_piece', 'outerwear', 'shoes', 'bag', 'hat', 'accessory',
];

const CATEGORY_ROLE: Readonly<Record<string, OutfitRole>> = {
  lower_body: 'bottom',
  dresses: 'one_piece',
  shoes: 'shoes',
  bags: 'bag',
  hats: 'hat',
  accessories: 'accessory',
};

const UPPER_SUBCATEGORY_ROLE: Readonly<Record<string, 'top' | 'outerwear'>> = {
  top: 'top',
  tisort: 'top',
  'tişört': 'top',
  't-shirt': 'top',
  gomlek: 'top',
  'gömlek': 'top',
  bluz: 'top',
  kazak: 'top',
  hoodie: 'top',
  sweatshirt: 'top',
  polo: 'top',
  atlet: 'top',
  outerwear: 'outerwear',
  ceket: 'outerwear',
  blazer: 'outerwear',
  mont: 'outerwear',
  kaban: 'outerwear',
  palto: 'outerwear',
  'hırka': 'outerwear',
  hirka: 'outerwear',
};

export const resolveWardrobeRole = (item: WardrobeItemForCandidate): OutfitRole | null => {
  const category = item.category.trim().toLocaleLowerCase('tr-TR');
  if (isOutfitRole(category)) return category;
  if (category === 'upper_body') {
    const subcategory = item.subcategory?.trim().toLocaleLowerCase('tr-TR') ?? '';
    return UPPER_SUBCATEGORY_ROLE[subcategory] ?? null;
  }
  return CATEGORY_ROLE[category] ?? null;
};

/** Reject only explicit gender conflicts; missing gender remains unknown. */
export const hasGenderConflict = (items: readonly OutfitCandidateItem[]): boolean => {
  let hasWomen = false;
  let hasMen = false;
  for (const item of items) {
    if (item.sourceType !== 'catalog') continue;
    hasWomen ||= item.product.gender === 'women';
    hasMen ||= item.product.gender === 'men';
  }
  return hasWomen && hasMen;
};

/** Unknown age/type stays unknown; title evidence must explicitly identify it. */
const hardEvidence = new WeakMap<Product, { title: string; subcategory: Product['subcategory'];
  age: 'child' | 'adult' | null; typeRole: OutfitRole | null }>();
const readHardEvidence = (product: Product) => {
  const cached = hardEvidence.get(product);
  if (cached?.title === product.title && cached.subcategory === product.subcategory) return cached;
  const title = product.title.toLocaleLowerCase('tr-TR');
  const child = /(?:^|[^\p{L}])(?:çocuk|cocuk|bebek|kids|baby|toddler)(?:$|[^\p{L}])/u.test(title);
  const adult = /(?:^|[^\p{L}])(?:kadın|kadin|erkek|yetişkin|yetiskin|women|men|adult)(?:$|[^\p{L}])/u.test(title);
  const subtype = product.subcategory?.trim().toLocaleLowerCase('tr-TR') ?? '';
  const declaredRole = UPPER_SUBCATEGORY_ROLE[subtype];
  // Require matching text as well as the subtype; inferred/missing metadata alone
  // cannot veto an authoritative role (for example a cardigan inferred as tisort).
  const explicitType = subtype && title.split(/[^\p{L}-]+/u).includes(subtype);
  const value = { title: product.title, subcategory: product.subcategory,
    age: child ? 'child' as const : adult ? 'adult' as const : null,
    typeRole: explicitType ? declaredRole ?? null : null };
  hardEvidence.set(product, value);
  return value;
};

/** Structural core is unchanged; footwear completion precedes optional coverage. */
export const hasCoreFootwear = (items: readonly OutfitCandidateItem[]): boolean =>
  items.some(item => item.role === 'shoes') && (items.some(item => item.role === 'one_piece') ||
    (items.some(item => item.role === 'top') && items.some(item => item.role === 'bottom')));

export const hasHardConflict = (items: readonly OutfitCandidateItem[]): boolean => {
  let child = false, adult = false, women = false, men = false;
  for (const item of items) {
    if (item.sourceType !== 'catalog') continue;
    const evidence = readHardEvidence(item.product);
    if (evidence.typeRole && evidence.typeRole !== item.role) return true;
    child ||= evidence.age === 'child';
    adult ||= evidence.age === 'adult';
    women ||= item.product.gender === 'women';
    men ||= item.product.gender === 'men';
  }
  return (child && adult) || (women && men);
};

// Shared across anchors using the same catalog objects. Raw evidence is checked on
// every read, including in-place edits; weak keys do not retain discarded catalogs.
const catalogRoleCompatibility = new WeakMap<Product, {
  category: Product['category'];
  subcategory: Product['subcategory'];
  roles: Map<OutfitRole, boolean>;
}>();

/** Broad categories may contain subtypes that cannot fill their default role. */
export const isCatalogRoleCompatible = (product: Product, role: OutfitRole): boolean => {
  let prepared = catalogRoleCompatibility.get(product);
  if (!prepared || prepared.category !== product.category || prepared.subcategory !== product.subcategory) {
    prepared = { category: product.category, subcategory: product.subcategory, roles: new Map() };
    catalogRoleCompatibility.set(product, prepared);
  }
  const cached = prepared.roles.get(role);
  if (cached !== undefined) return cached;

  let compatible: boolean;
  if (product.category === 'lower_body' && (product.subcategory === undefined || product.subcategory === null ? undefined
      : normalizedRecommendationToken(product.subcategory, false, () => product.subcategory!.toLocaleLowerCase('tr-TR'))) === 'pareo') {
    compatible = false;
  } else {
    const rolesByCategory: Record<Product['category'], readonly OutfitRole[]> = {
      upper_body: ['top', 'outerwear'],
      lower_body: ['bottom'],
      dresses: ['one_piece'],
      shoes: ['shoes'],
      bags: ['bag'],
      hats: ['hat'],
      accessories: ['accessory'],
    };
    compatible = rolesByCategory[product.category].includes(role);
  }
  prepared.roles.set(role, compatible);
  return compatible;
};

export const isValidOutfitItems = (
  items: readonly OutfitCandidateItem[],
): boolean => {

  if (hasHardConflict(items)) return false;
  const roles = new Set<OutfitRole>();
  const sourceIds = new Set<string>();
  for (const item of items) {
    if (item.sourceType === 'catalog' && !isCatalogRoleCompatible(item.product, item.role)) {
      return false;
    }
    const sourceKey = JSON.stringify([item.sourceType, item.sourceId]);
    if (roles.has(item.role) || sourceIds.has(sourceKey)) return false;
    roles.add(item.role);
    sourceIds.add(sourceKey);
  }
  const hasOnePiece = roles.has('one_piece');
  const hasTwoPiece = roles.has('top') && roles.has('bottom');
  return hasOnePiece
    ? !roles.has('top') && !roles.has('bottom')
    : hasTwoPiece;

};
