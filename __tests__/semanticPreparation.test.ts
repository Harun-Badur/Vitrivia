import type { Product } from '../types/product';
import { getDisplayPrice } from '../types/product';
import { catalogSemanticKey } from '../src/intelligence/outfits/catalogCompatibility';
import { createRecommendationMemo, normalizedRecommendationToken, withRecommendationMemo } from '../lib/recommendationMemo';

const product = (): Product => ({ id: 'semantic-test', outfitRole: 'top', category: 'upper_body',
  gender: 'women', subcategory: ' GÖMLEK ', brand: ' İSTANBUL ', title: 'Semantic TEST',
  price: 100, currentPrice: 90, fit: 'Regular', colorSlugs: ['BEYAZ', 'SİYAH'],
  imageUrl: 'test', garmentDescription: 'test' });
// Original semantic expression, deliberately independent of all caches.
const reference = (p: Product): string => {
  const token = (value: string | undefined) => value == null ? '' : value.trim().toLocaleLowerCase('tr-TR');
  return JSON.stringify([p.outfitRole, p.category, p.gender, token(p.subcategory), token(p.brand),
    token(p.title), getDisplayPrice(p), [...(p.colorSlugs ?? [])].map(token).sort(), token(p.fit)]);
};

describe('shared string and semantic preparation', () => {
  it('shares normalization across scopes, separates trim and retains empty results', () => {
    const raw = ' UNIQUE-İ-NORMALIZATION ';
    const calculate = jest.fn(() => raw.trim().toLocaleLowerCase('tr-TR'));
    for (let index = 0; index < 2; index++) withRecommendationMemo(createRecommendationMemo(), () =>
      expect(normalizedRecommendationToken(raw, true, calculate)).toBe('unıque-i-normalızatıon'));
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(normalizedRecommendationToken(raw, false, () => raw.toLocaleLowerCase('tr-TR'))).toBe(' unıque-i-normalızatıon ');
    const empty = jest.fn(() => '');
    normalizedRecommendationToken('   ', true, empty);
    normalizedRecommendationToken('   ', true, empty);
    expect(empty).toHaveBeenCalledTimes(1);
  });

  it('skips color sorting and JSON serialization on semantic hits across scopes', () => {
    const p = product();
    const expected = reference(p);
    withRecommendationMemo(createRecommendationMemo(), () => expect(catalogSemanticKey(p)).toBe(expected));
    const sort = jest.spyOn(Array.prototype, 'sort');
    const stringify = jest.spyOn(JSON, 'stringify');
    let actual: string;
    try {
      actual = withRecommendationMemo(createRecommendationMemo(), () => catalogSemanticKey(p));
      expect(sort).not.toHaveBeenCalled();
      expect(stringify).not.toHaveBeenCalled();
    } finally { sort.mockRestore(); stringify.mockRestore(); }
    expect(actual!).toBe(expected);
  });

  it('invalidates every relevant scalar field and checks actual same-ID metadata', () => {
    const p = product();
    const edits: Partial<Product>[] = [{ outfitRole: 'outerwear' }, { category: 'bags' },
      { gender: 'men' }, { subcategory: 'Jean' }, { brand: 'Other' }, { title: 'Other Title' },
      { currentPrice: 20 }, { currentPrice: undefined, price: 70 }, { fit: 'Slim' }];
    expect(catalogSemanticKey(p)).toBe(reference(p));
    for (const edit of edits) {
      Object.assign(p, edit);
      expect(catalogSemanticKey(p)).toBe(reference(p));
    }
    const other = { ...p, title: 'Distinct same-ID product' };
    expect(catalogSemanticKey(other)).toBe(reference(other));
    expect(catalogSemanticKey(p)).toBe(reference(p));
  });

  it('detects in-place color edits, insertion, deletion, order and replacement without mutating inputs', () => {
    const p = product();
    const verify = () => {
      const before = [...(p.colorSlugs ?? [])];
      expect(catalogSemanticKey(p)).toBe(reference(p));
      expect(p.colorSlugs ?? []).toEqual(before);
    };
    verify();
    p.colorSlugs![0] = 'KIRMIZI'; verify();
    p.colorSlugs!.push('MAVİ'); verify();
    p.colorSlugs!.splice(1, 1); verify();
    p.colorSlugs!.reverse(); verify();
    p.colorSlugs = ['BEJ']; verify();
    p.colorSlugs = undefined; verify();
    p.colorSlugs = []; verify();
  });
});
