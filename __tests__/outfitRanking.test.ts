import type { OutfitCandidate, WardrobeItemForCandidate } from '../src/intelligence/outfits/outfitCandidate';
import { generateOutfitCandidates } from '../src/intelligence/outfits/generateOutfitCandidates';
import { rankOutfitCandidates } from '../src/intelligence/outfits/rankOutfitCandidates';
import type { OutfitRole, Product } from '../types/product';

const product = (id: string, role: OutfitRole, colorSlugs?: string[]): Product => ({
  id,
  imageUrl: 'https://example.com/item.jpg',
  title: id,
  price: 100,
  brand: 'Test',
  category: role === 'bottom' ? 'lower_body' : role === 'shoes' ? 'shoes' : 'upper_body',
  outfitRole: role,
  garmentDescription: id,
  colorSlugs,
});

interface TestWardrobeItem extends WardrobeItemForCandidate {
  color?: string;
  style_tags?: unknown;
}

const wardrobe = (
  id: string,
  category: string,
  metadata: Pick<TestWardrobeItem, 'color' | 'style_tags'> = {},
): TestWardrobeItem => ({ id, category, ...metadata });

describe('Outfit Ranking', () => {
  it('places a valid, more complete outfit above one missing a core role', () => {
    const [complete] = generateOutfitCandidates({
      wardrobeItems: [],
      catalogProducts: [product('top', 'top'), product('bottom', 'bottom'), product('shoes', 'shoes')],
    }).filter((candidate) => candidate.items.length === 3);
    const incomplete: OutfitCandidate = {
      id: 'missing-bottom',
      items: [complete.items[0]],
      roles: ['top'],
      sources: ['catalog'],
    };
    const ranked = rankOutfitCandidates([incomplete, complete]);
    expect(ranked[0].candidate).toBe(complete);
    expect(ranked[0].rankingValue.optionalRoleCount).toBe(1);
    expect(ranked[1].rankingValue.missingCoreRoles).toEqual(['bottom']);
    expect(ranked[1].reasons).toContainEqual({
      code: 'missing_core_roles', roles: ['bottom'],
    });
  });

  it('recognizes one_piece as a complete core and ranks its shoes variant higher', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [wardrobe('dress', 'one_piece')],
      catalogProducts: [product('shoes', 'shoes')],
    });
    const ranked = rankOutfitCandidates(candidates);
    expect(ranked[0].candidate.roles).toEqual(['one_piece', 'shoes']);
    expect(ranked[0].rankingValue.coreComplete).toBe(true);
    expect(ranked[0].reasons).toContainEqual({
      code: 'core_complete', form: 'one_piece',
    });
  });

  it('preserves a mixed wardrobe + catalog candidate and original references', () => {
    const top = wardrobe('w-top', 'top', { color: 'Siyah' });
    const bottom = product('c-bottom', 'bottom', ['siyah']);
    const [candidate] = generateOutfitCandidates({
      wardrobeItems: [top],
      catalogProducts: [bottom],
    });
    const [ranked] = rankOutfitCandidates([candidate]);
    expect(ranked.candidate).toBe(candidate);
    expect(ranked.candidate.items[0].wardrobeItem).toBe(top);
    expect(ranked.candidate.items[1].product).toBe(bottom);
    expect(ranked.reasons).toContainEqual({ code: 'mixed_sources' });
    expect(ranked.rankingValue.sharedColors).toEqual(['siyah']);
  });

  it('places a conflicting role combination last without claiming it is complete', () => {
    const [valid] = generateOutfitCandidates({
      wardrobeItems: [],
      catalogProducts: [product('top', 'top'), product('bottom', 'bottom')],
    });
    const [dress] = generateOutfitCandidates({
      wardrobeItems: [wardrobe('dress', 'one_piece')],
      catalogProducts: [],
    });
    const conflicting: OutfitCandidate = {
      id: 'conflicting',
      items: [...valid.items, ...dress.items],
      roles: ['top', 'bottom', 'one_piece'],
      sources: ['wardrobe', 'catalog'],
    };
    const ranked = rankOutfitCandidates([conflicting, valid]);
    expect(ranked[0].candidate).toBe(valid);
    expect(ranked[1].rankingValue.coreComplete).toBe(false);
    expect(ranked[1].reasons).toContainEqual({ code: 'invalid_role_combination' });
    expect(ranked[1].reasons.map((reason) => reason.code)).not.toContain('core_complete');
  });

  it('uses existing shared style and color metadata as explicit evidence', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [
        wardrobe('top-shared', 'top', { color: 'Siyah', style_tags: ['minimal'] }),
        wardrobe('top-other', 'top', { color: 'Mavi', style_tags: ['sport'] }),
        wardrobe('bottom', 'bottom', { color: 'siyah', style_tags: ['minimal'] }),
      ],
      catalogProducts: [],
    });
    const ranked = rankOutfitCandidates(candidates);
    expect(ranked[0].candidate.items[0].sourceId).toBe('top-shared');
    expect(ranked[0].rankingValue.sharedStyleTags).toEqual(['minimal']);
    expect(ranked[0].rankingValue.sharedColors).toEqual(['siyah']);
    expect(ranked[0].reasons).toContainEqual({
      code: 'shared_style_tags', tags: ['minimal'],
    });
  });

  it('stays safe when style or color metadata is missing or ambiguous', () => {
    const [candidate] = generateOutfitCandidates({
      wardrobeItems: [wardrobe('top', 'top', { style_tags: ['minimal', 4, null] })],
      catalogProducts: [product('bottom', 'bottom')],
    });
    const [ranked] = rankOutfitCandidates([candidate]);
    expect(ranked.rankingValue.sharedStyleTags).toEqual([]);
    expect(ranked.rankingValue.sharedColors).toEqual([]);
    expect(ranked.reasons.map((reason) => reason.code)).not.toContain('shared_style_tags');
    expect(ranked.reasons.map((reason) => reason.code)).not.toContain('shared_colors');
  });

  it('produces the same ranking for repeated and reversed input', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [],
      catalogProducts: [
        product('top-b', 'top'),
        product('top-a', 'top'),
        product('bottom', 'bottom'),
        product('shoes', 'shoes'),
      ],
    });
    const first = rankOutfitCandidates(candidates);
    const second = rankOutfitCandidates([...candidates].reverse());
    expect(first.map(({ candidate, rank, rankingValue, reasons }) =>
      ({ id: candidate.id, rank, rankingValue, reasons }))).toEqual(
      second.map(({ candidate, rank, rankingValue, reasons }) =>
        ({ id: candidate.id, rank, rankingValue, reasons })),
    );
  });

  it('breaks equal-value ties by semantic metadata rather than candidate ID', () => {
    const candidates = generateOutfitCandidates({
      wardrobeItems: [],
      catalogProducts: [
        { ...product('top-z', 'top'), title: 'Alpha' },
        { ...product('top-a', 'top'), title: 'Zulu' },
        product('bottom', 'bottom'),
      ],
    });
    const ranked = rankOutfitCandidates([...candidates].reverse());
    expect(ranked[0].rankingValue).toEqual(ranked[1].rankingValue);
    expect(ranked[0].candidate.items[0].sourceId).toBe('top-z');
  });
});
