import fs from 'fs';
import path from 'path';
import type { Product } from '../types/product';
import { createRecommendationMemo, recommendationMemoValue, withRecommendationMemo } from '../lib/recommendationMemo';
import { runCooperatively } from '../src/intelligence/cooperativeWork';
import { isCatalogRoleCompatible } from '../src/intelligence/outfits/outfitCandidate';
import { catalogCompatibility, catalogSemanticKey } from '../src/intelligence/outfits/catalogCompatibility';
import { evaluateOutfitCandidate } from '../src/intelligence/outfits/outfitRanking';
const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/recommendation-catalog.snapshot.json'), 'utf8'));

describe('recommendation-local memoization', () => {
  it('caches false/empty values and restores the scope after errors', () => {
    const memo = createRecommendationMemo();
    let calls = 0;
    const read = () => recommendationMemoValue('test', 'same', () => { calls++; return false; });
    withRecommendationMemo(memo, () => { expect(read()).toBe(false); expect(read()).toBe(false); });
    expect(calls).toBe(1);
    expect(() => withRecommendationMemo(memo, () => { throw new Error('test'); })).toThrow('test');
    read();
    expect(calls).toBe(2);
  });

  it('isolates interleaved async jobs and releases the context between yields', async () => {
    const counts = [0, 0];
    function* work(index: number) {
      for (let step = 0; step < 30; step++) {
        expect(recommendationMemoValue('test', 'same', () => { counts[index]++; return index; })).toBe(index);
        yield;
      }
      return index;
    }
    expect(await Promise.all(counts.map((_, index) => runCooperatively(work(index), {
      budgetMs: 1, recommendationMemo: createRecommendationMemo(),
    })))).toEqual([0, 1]);
    expect(counts).toEqual([1, 1]);
    expect(recommendationMemoValue('test', 'same', () => 9)).toBe(9);
  });

  it('keeps independent nested scopes', () => {
    const one = createRecommendationMemo(), two = createRecommendationMemo();
    withRecommendationMemo(one, () => {
      expect(recommendationMemoValue('test', 'same', () => 1)).toBe(1);
      withRecommendationMemo(two, () => expect(recommendationMemoValue('test', 'same', () => 2)).toBe(2));
      expect(recommendationMemoValue('test', 'same', () => 3)).toBe(1);
    });
  });

  it('keys role results by ID, role and raw category/subcategory without trimming the pareo rule', () => {
    const product = { ...catalog.find(p => p.outfitRole === 'bottom')! };
    withRecommendationMemo(createRecommendationMemo(), () => {
      expect(isCatalogRoleCompatible(product, 'bottom')).toBe(true);
      expect(isCatalogRoleCompatible(product, 'top')).toBe(false);
      product.subcategory = 'PAREO';
      expect(isCatalogRoleCompatible(product, 'bottom')).toBe(false);
      product.subcategory = ' PAREO ';
      expect(isCatalogRoleCompatible(product, 'bottom')).toBe(true);
    });
  });

  it('invalidates compatibility evidence including price, colors and same-ID objects', () => {
    const anchor = catalog[0], product = { ...catalog[1], colorSlugs: [...(catalog[1].colorSlugs ?? [])] };
    const changed = { ...product, currentPrice: 1, brand: anchor.brand, colorSlugs: ['beyaz'], fit: 'test-fit' };
    const expected = catalogCompatibility(anchor, changed);
    withRecommendationMemo(createRecommendationMemo(), () => {
      catalogCompatibility(anchor, product);
      expect(catalogCompatibility(anchor, changed)).toEqual(expected);
      Object.assign(product, changed);
      expect(catalogCompatibility(anchor, product)).toEqual(expected);
    });
  });

  it('invalidates semantic keys after relevant metadata changes', () => {
    const product = { ...catalog[0] };
    const changed = { ...product, title: 'İSTANBUL', currentPrice: 1, colorSlugs: ['BEYAZ'], fit: 'regular' };
    const expected = catalogSemanticKey(changed);
    withRecommendationMemo(createRecommendationMemo(), () => {
      catalogSemanticKey(product);
      Object.assign(product, changed);
      expect(catalogSemanticKey(product)).toBe(expected);
    });
  });

  it('keys shared tokens by their actual sets and returns independent arrays', () => {
    const items = [
      { sourceType: 'wardrobe' as const, sourceId: 'owned-top', role: 'top' as const,
        wardrobeItem: { id: 'owned-top', category: 'top', color: 'BEYAZ', style_tags: ['CASUAL'] } },
      { sourceType: 'wardrobe' as const, sourceId: 'owned-bottom', role: 'bottom' as const,
        wardrobeItem: { id: 'owned-bottom', category: 'bottom', color: 'BEYAZ', style_tags: ['CASUAL'] } },
    ];
    const candidate = { id: 'owned-pair', items, roles: ['top', 'bottom'] as const, sources: ['wardrobe'] as const };
    const evaluate = () => evaluateOutfitCandidate({ ...candidate, roles: [...candidate.roles], sources: [...candidate.sources] });
    withRecommendationMemo(createRecommendationMemo(), () => {
      const first = evaluate();
      first.rankingValue.sharedColors.push('mutated-result');
      expect(evaluate().rankingValue.sharedColors).toEqual(['beyaz']);
      items[1].wardrobeItem.color = 'SİYAH';
      items[1].wardrobeItem.style_tags = ['FORMAL'];
      const next = evaluate();
      expect(next.rankingValue.sharedColors).toEqual([]);
      expect(next.rankingValue.sharedStyleTags).toEqual([]);
    });
  });
});
