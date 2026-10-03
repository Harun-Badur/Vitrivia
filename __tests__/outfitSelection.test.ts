import {
  canCreateOutfit,
  choiceSlot,
  selectedOutfitCandidate,
  type OutfitChoice,
} from '../lib/outfitSelection';
import { MOCK_PRODUCTS } from '../data/mockProducts';

const top: OutfitChoice = {
  key: 'catalog:top',
  source: 'catalog',
  item: { ...MOCK_PRODUCTS[0], id: 'top', category: 'upper_body' },
};
const bottom: OutfitChoice = {
  key: 'wardrobe:bottom',
  source: 'wardrobe',
  item: {
    id: 'bottom',
    title: 'Pantolonum',
    category: 'lower_body',
    imageUrl: 'file:///bottom.jpg',
    brand: '',
    createdAt: '2026-09-28',
  },
};
const shoes: OutfitChoice = {
  key: 'catalog:shoes',
  source: 'catalog',
  item: { ...MOCK_PRODUCTS[0], id: 'shoes', category: 'shoes' },
};
describe('manual outfit selection uses the existing engine', () => {
  it('requires the existing top and bottom core, with optional shoes', () => {
    expect(canCreateOutfit({ upper_body: top })).toBe(false);
    expect(canCreateOutfit({ upper_body: top, lower_body: bottom })).toBe(true);
    const result = selectedOutfitCandidate({
      upper_body: top,
      lower_body: bottom,
      shoes,
    });
    expect(
      result.items.map((item) => `${item.sourceType}:${item.sourceId}`),
    ).toEqual(['catalog:top', 'wardrobe:bottom', 'catalog:shoes']);
    expect(result.roles).toEqual(['top', 'bottom', 'shoes']);
    expect(top.item).toEqual({
      ...MOCK_PRODUCTS[0],
      id: 'top',
      category: 'upper_body',
    });
  });
  it('rejects missing or incorrectly slotted pieces', () => {
    expect(() => selectedOutfitCandidate({ upper_body: top })).toThrow(
      'Üst ve Alt',
    );
    expect(() =>
      selectedOutfitCandidate({ upper_body: shoes, lower_body: bottom }),
    ).toThrow('kategorisi');
  });
  it('maps bags and hats into the accessory slot', () => {
    expect(
      choiceSlot({ ...top, item: { ...top.item, category: 'bags' } }),
    ).toBe('accessories');
    expect(
      choiceSlot({ ...top, item: { ...top.item, category: 'hats' } }),
    ).toBe('accessories');
  });
});
