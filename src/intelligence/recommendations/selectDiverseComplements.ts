import type { Product, OutfitRole } from '../../../types/product';
import type { WardrobeItemForCandidate } from '../outfits/outfitCandidate';
import type { RankedOutfitCandidate } from '../outfits/outfitRanking';
import { catalogCompatibility, catalogSemanticKey, sameCatalogProduct } from '../outfits/catalogCompatibility';
import { runCooperatively, runSynchronously, type CooperativeWorkOptions } from '../cooperativeWork';

export interface ComplementSelection<T extends WardrobeItemForCandidate> {
  outfit: RankedOutfitCandidate<T>;
  products: Product[];
}

const NEAR_COMPATIBILITY_MARGIN = 0.12;
const EXPOSURE_PENALTY = 0.07;
const CATEGORY_REPEAT_PENALTY = 0.12;
const BRAND_REPEAT_PENALTY = 0.04;
const MAX_COMPLEMENTS = 3;

/** Retains an actual valid outfit containing every selected product, never a synthetic mix. */
function* selectionWork<T extends WardrobeItemForCandidate>(
  ranked: readonly RankedOutfitCandidate<T>[],
  anchor: Product,
  exposure: ReadonlyMap<string, number> = new Map(),
): Generator<void, ComplementSelection<T> | null, void> {
  const best = ranked[0];
  if (!best) return null;
  let compatible: RankedOutfitCandidate<T>[] = [];
  for (const entry of ranked) {
    if (entry.rankingValue.validRoles && entry.rankingValue.coreComplete &&
    entry.rankingValue.optionalRoleCount === best.rankingValue.optionalRoleCount &&
    entry.rankingValue.sharedStyleTags.length === best.rankingValue.sharedStyleTags.length &&
    (entry.rankingValue.compatibilityScore ?? 0) >= (best.rankingValue.compatibilityScore ?? 0) - NEAR_COMPATIBILITY_MARGIN) compatible.push(entry);
    yield;
  }
  const selected: Product[] = [], roles = new Set<OutfitRole>();
  const itemScores = new Map<Product, number>();
  for (let slot = 0; slot < MAX_COMPLEMENTS; slot++) {
    const choices = new Map<string, Product>();
    for (const entry of compatible) for (const item of entry.candidate.items) {

        if (item.sourceType === 'catalog' && !choices.has(item.sourceId) && !roles.has(item.role)) choices.set(item.sourceId, item.product);

      yield;
    }
    // Core completion comes first when the visible anchor is half of a two-piece outfit.
    const missingCoreRole = anchor.outfitRole === 'top' ? 'bottom' : anchor.outfitRole === 'bottom' ? 'top' : null;
    const uniqueChoices = [...choices.values()].filter((p) => !sameCatalogProduct(p, anchor) && !selected.some((chosen) => sameCatalogProduct(chosen, p)));
    const coreChoices = slot === 0 && missingCoreRole ? uniqueChoices.filter((p) => p.outfitRole === missingCoreRole) : [];
    const available = coreChoices.length ? coreChoices : uniqueChoices;
    let choice: Product | null = null, highest = -Infinity;
    for (const product of available) {
      let base = itemScores.get(product);
      if (base === undefined) {
        base = catalogCompatibility(anchor, product).score; itemScores.set(product, base);
      }
      const count = exposure.get(product.id) ?? 0;
      const previous = Number.isFinite(count) ? Math.max(0, count) : 0;
      const repeatCategory = selected.some((p) => p.category === product.category);
      const repeatBrand = selected.some((p) => p.brand.trim().toLocaleLowerCase('tr-TR') === product.brand.trim().toLocaleLowerCase('tr-TR'));
      const score = base - EXPOSURE_PENALTY * Math.log2(1 + previous)
        - Number(repeatCategory) * CATEGORY_REPEAT_PENALTY - Number(repeatBrand) * BRAND_REPEAT_PENALTY;
      if (score > highest || (score === highest && choice !== null && catalogSemanticKey(product) < catalogSemanticKey(choice))) { choice = product; highest = score; }
      yield;
    }
    if (!choice) break;
    const chosen = choice;
    selected.push(chosen);
    if (chosen.outfitRole) roles.add(chosen.outfitRole);
    const remaining: RankedOutfitCandidate<T>[] = [];
    for (const entry of compatible) {
      if (entry.candidate.items.some((item) => item.sourceType === 'catalog' && item.sourceId === chosen.id)) remaining.push(entry);
      yield;
    }
    compatible = remaining;
  }
  const outfit = compatible[0];
  return outfit ? { outfit, products: selected } : null;
}

export const selectDiverseComplements = <T extends WardrobeItemForCandidate>(
  ranked: readonly RankedOutfitCandidate<T>[], anchor: Product,
  exposure?: ReadonlyMap<string, number>,
): ComplementSelection<T> | null => runSynchronously(selectionWork(ranked, anchor, exposure));

export const selectDiverseComplementsAsync = <T extends WardrobeItemForCandidate>(
  ranked: readonly RankedOutfitCandidate<T>[], anchor: Product,
  exposure?: ReadonlyMap<string, number>, options?: CooperativeWorkOptions,
): Promise<ComplementSelection<T> | null> => runCooperatively(selectionWork(ranked, anchor, exposure), options);
