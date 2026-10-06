import type { OutfitRole, Product } from '../types/product';
import { generateOutfitCandidates } from '../src/intelligence/outfits/generateOutfitCandidates';
import { isValidOutfitItems, type OutfitCandidate } from '../src/intelligence/outfits/outfitCandidate';
import { rankOutfitCandidates, rankDiversityCandidatesAsync } from '../src/intelligence/outfits/rankOutfitCandidates';
import { getDiscoverRecommendations, getDiscoverRecommendationsAsync } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';

const product = (id: string, role: OutfitRole, extra: Partial<Product> = {}): Product => ({
  id, title: id, brand: 'Test', imageUrl: `https://example.com/${id}.jpg`,
  garmentDescription: id, price: 1000, outfitRole: role, gender: 'women',
  category: role === 'bottom' ? 'lower_body' : role === 'one_piece' ? 'dresses'
    : role === 'shoes' ? 'shoes' : role === 'bag' ? 'bags'
      : role === 'hat' ? 'hats' : role === 'accessory' ? 'accessories' : 'upper_body', ...extra,
});
const candidate = (products: Product[]): OutfitCandidate => ({
  id: products.map(p => p.id).join(','), roles: products.map(p => p.outfitRole!), sources: ['catalog'],
  items: products.map(p => ({ sourceType: 'catalog', sourceId: p.id, role: p.outfitRole!, product: p })),
});

describe('core footwear before optional coverage', () => {
  it.each(['top', 'bottom', 'one_piece'] as const)('%s core with shoes outranks more optional roles without shoes', role => {
    const anchor = product('anchor', role);
    const core = role === 'one_piece' ? [anchor] : [anchor, product('other', role === 'top' ? 'bottom' : 'top')];
    const complete = candidate([...core, product('shoes', 'shoes')]);
    const optional = candidate([...core, product('coat', 'outerwear'), product('bag', 'bag'),
      product('hat', 'hat'), product('belt', 'accessory')]);
    expect(isValidOutfitItems(optional.items)).toBe(true);
    expect(rankOutfitCandidates([optional, complete], anchor)[0].candidate).toBe(complete);
  });

  it.each(['top', 'bottom', 'one_piece', 'shoes'] as const)('%s shows core members before a higher scoring belt', async role => {
    const anchor = product('anchor', role);
    const pool = [product('top', 'top', { price: 100000, brand: 'Other' }),
      product('bottom', 'bottom', { price: 100000, brand: 'Other' }),
      product('shoes', 'shoes', { price: 100000, brand: 'Other' }), product('belt', 'accessory'),
      product('bag', 'bag'), product('dress', 'one_piece')].filter(p => p.outfitRole !== role);
    const input = { wardrobeItems: [], catalogProducts: [anchor, ...pool],
      requiredCatalogProductId: anchor.id, firstOnly: true };
    const expected = role === 'top' ? ['bottom', 'shoes'] : role === 'bottom' ? ['top', 'shoes']
      : role === 'one_piece' ? ['shoes'] : ['top', 'bottom'];
    const sync = getDiscoverRecommendations(input);
    expect(complementaryProductsForDisplay(sync, anchor.id).slice(0, expected.length).map(p => p.outfitRole)).toEqual(expected);
    expect(await getDiscoverRecommendationsAsync(input)).toEqual(sync);
  });

  it('retains the footwear tier even when age conflicts give the shoeless tier more optional roles', async () => {
    const anchor = product('anchor', 'one_piece', { title: 'Elbise' });
    const shoes = product('shoes', 'shoes', { title: 'Kadın Ayakkabı' });
    const children = ['outerwear', 'bag', 'hat', 'accessory'].map((role, i) =>
      product(`child-${i}`, role as OutfitRole, { title: `Çocuk parça ${i}` }));
    const input = { wardrobeItems: [], catalogProducts: [anchor, shoes, ...children], requiredCatalogProductId: anchor.id };
    const maximal = generateOutfitCandidates({ ...input, maximalOnly: true });
    expect(maximal).toHaveLength(1);
    expect(maximal[0].roles).toEqual(['one_piece', 'shoes']);
    const bounded = await rankDiversityCandidatesAsync(input, anchor);
    expect(bounded.map(entry => entry.candidate)).toEqual(maximal);
  });

  it('rejects explicit adult/child conflicts but allows unknown age and child/child outfits', () => {
    const anchor = product('adult', 'top', { title: 'Kadın Tişört' });
    const bottom = product('bottom', 'bottom', { title: 'Kadın Pantolon' });
    const child = product('child', 'hat', { title: 'Kız Çocuk Şapka' });
    const unknown = product('unknown', 'hat', { title: 'Şapka' });
    const generated = generateOutfitCandidates({ wardrobeItems: [], catalogProducts: [anchor, bottom, child, unknown],
      requiredCatalogProductId: anchor.id });
    expect(generated.some(c => c.items.some(i => i.sourceId === 'child'))).toBe(false);
    expect(generated.some(c => c.items.some(i => i.sourceId === 'unknown'))).toBe(true);
    expect(isValidOutfitItems(candidate([product('child-top', 'top', { title: 'Erkek Çocuk Tişört' }),
      product('child-bottom', 'bottom', { title: 'Erkek Çocuk Pantolon' })]).items)).toBe(true);
  });

  it('rejects corroborated subtype/role conflicts without guessing from incomplete metadata', () => {
    const invalid = product('invalid', 'top', { title: 'Kadın mont', subcategory: 'mont' });
    const unknown = product('unknown', 'outerwear', { title: 'Kadın Hırka', subcategory: 'tisort' });
    const bottom = product('bottom', 'bottom');
    const top = product('top', 'top');
    const generated = generateOutfitCandidates({ wardrobeItems: [], catalogProducts: [invalid, unknown, bottom, top] });
    expect(generated.some(c => c.items.some(i => i.sourceId === 'invalid'))).toBe(false);
    expect(generated.some(c => c.items.some(i => i.sourceId === 'unknown'))).toBe(true);
  });

  it('rechecks hard evidence after in-place metadata changes without losing prepared item reuse', () => {
    const top = product('top', 'top', { title: 'Kadın Tişört' });
    const bottom = product('bottom', 'bottom', { title: 'Kadın Pantolon' });
    const hat = product('hat', 'hat', { title: 'Şapka' });
    const input = { wardrobeItems: [], catalogProducts: [top, bottom, hat], requiredCatalogProductId: top.id };
    expect(generateOutfitCandidates(input).some(c => c.roles.includes('hat'))).toBe(true);
    hat.title = 'Kız Çocuk Şapka';
    expect(generateOutfitCandidates(input).some(c => c.roles.includes('hat'))).toBe(false);
  });

  it('prioritizes available shoes when the other core role is supplied by the wardrobe', () => {
    const anchor = product('top', 'top');
    const result = getDiscoverRecommendations({ requiredCatalogProductId: anchor.id, firstOnly: true,
      wardrobeItems: [{ id: 'owned-bottom', category: 'bottom' }],
      catalogProducts: [anchor, product('shoes', 'shoes', { price: 100000, brand: 'Other' }),
        product('bag', 'bag'), product('belt', 'accessory')] });
    expect(complementaryProductsForDisplay(result, anchor.id)[0].outfitRole).toBe('shoes');
  });
});
