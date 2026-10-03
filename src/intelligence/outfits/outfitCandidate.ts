import { isOutfitRole, type OutfitRole, type Product } from '../../../types/product';
import { recommendationMemoValue, normalizedRecommendationToken } from '../../../lib/recommendationMemo';

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

/** Broad categories may contain subtypes that cannot fill their default role. */
export const isCatalogRoleCompatible = (product: Product, role: OutfitRole): boolean => {
  return recommendationMemoValue('roleCompatibilityMemo', JSON.stringify([
    'tr-TR', product.id, product.category, product.subcategory, role,
  ]), () => {

  if (product.category === 'lower_body' && (product.subcategory === undefined || product.subcategory === null ? undefined
      : normalizedRecommendationToken(product.subcategory, false, () => product.subcategory!.toLocaleLowerCase('tr-TR'))) === 'pareo') {
    return false;
  }
  const rolesByCategory: Record<Product['category'], readonly OutfitRole[]> = {
    upper_body: ['top', 'outerwear'],
    lower_body: ['bottom'],
    dresses: ['one_piece'],
    shoes: ['shoes'],
    bags: ['bag'],
    hats: ['hat'],
    accessories: ['accessory'],
  };
  return rolesByCategory[product.category].includes(role);

  });
};

export const isValidOutfitItems = (
  items: readonly OutfitCandidateItem[],
): boolean => {

  if (hasGenderConflict(items)) return false;
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
