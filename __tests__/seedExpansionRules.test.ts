import {
  canonicalizeCatalogUrl,
  duplicateReason,
  inferExpansionOutfitRole,
  mapExpansionCategory,
  metadataSkipReason,
} from '../scripts/lib/seedExpansionRules';
import type { GarmentCategory, OutfitRole } from '../types/product';

describe('URL catalog expansion rules', () => {
  it.each([
    ['ÜST GİYİM', 'upper_body'],
    ['ALT GİYİM', 'lower_body'],
    ['ELBİSE', 'dresses'],
    ['shoes', 'shoes'],
    ['bags', 'bags'],
    ['hats', 'hats'],
    ['accessories', 'accessories'],
  ] as const)('accepts category %s as %s', (input, expected) => {
    expect(mapExpansionCategory(input)).toBe(expected);
  });

  it.each([
    ['lower_body', 'Pantolon', 'bottom'],
    ['dresses', 'Midi Elbise', 'one_piece'],
    ['shoes', 'Sneaker', 'shoes'],
    ['bags', 'Omuz Çantası', 'bag'],
    ['hats', 'Hasır Şapka', 'hat'],
    ['accessories', 'Kolye', 'accessory'],
    ['upper_body', 'Kadın Deri Ceket', 'outerwear'],
    ['upper_body', 'Pamuklu Tişört', 'top'],
  ] as const)('maps %s / %s to %s', (category, title, role) => {
    expect(inferExpansionOutfitRole(category, title, null)).toBe(role);
  });

  it('leaves uncertain or mixed upper-body products unclassified', () => {
    const cases: Array<[GarmentCategory, string, string | null, OutfitRole | null]> = [
      ['upper_body', 'Kadın Şık Ürün', 'tisort', null],
      ['upper_body', 'Kruvaze Takım Elbise', 'blazer', null],
      ['upper_body', 'Ceket Gömlek', null, null],
    ];
    for (const [category, title, subcategory, expected] of cases) {
      expect(inferExpansionOutfitRole(category, title, subcategory)).toBe(expected);
    }
  });

  it('deduplicates query variants, input IDs and existing catalog rows', () => {
    const canonical = canonicalizeCatalogUrl(
      'https://www.trendyol.com/brand/item-p-123?utm_source=x#details',
    );
    expect(canonical).toBe('https://www.trendyol.com/brand/item-p-123');
    expect(duplicateReason(
      'trendyol-123', canonical, new Set(), new Set([canonical]),
      new Set(), new Set(),
    )).toBe('duplicate_in_input');
    expect(duplicateReason(
      'trendyol-123', canonical, new Set(['trendyol-123']), new Set(),
      new Set(), new Set(),
    )).toBe('duplicate_in_input');
    expect(duplicateReason(
      'trendyol-123', canonical, new Set(), new Set(),
      new Set(['trendyol-123']), new Set(),
    )).toBe('already_in_catalog');
    expect(duplicateReason(
      'trendyol-123', canonical, new Set(), new Set(),
      new Set(), new Set([canonical]),
    )).toBe('already_in_catalog');
  });

  it('rejects missing title, price and image without inventing values', () => {
    const valid = {
      httpStatus: 200,
      softBlocked: false,
      title: 'Pamuklu Gömlek',
      price: 399,
      imageUrls: ['https://example.com/image.jpg'],
    };
    expect(metadataSkipReason(valid)).toBeNull();
    expect(metadataSkipReason({ ...valid, title: 'Trendyol' })).toBe('no_usable_title');
    expect(metadataSkipReason({ ...valid, price: null })).toBe('no_usable_price');
    expect(metadataSkipReason({ ...valid, imageUrls: [] })).toBe('no_usable_image');
    expect(metadataSkipReason({ ...valid, httpStatus: 404 })).toBe('http_404');
  });
});
