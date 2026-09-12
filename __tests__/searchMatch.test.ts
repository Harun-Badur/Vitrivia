import {
  applyFilterMaskProgressive,
  productMatchesFilters,
} from '../lib/feedFilter';
import {
  foldTr,
  matchesBrandFacet,
  matchesColorFacet,
  matchesTextTitle,
  normalizeTr,
} from '../lib/searchMatch';
import { searchRelaxBannerText } from '../lib/searchRelaxMessage';
import type { Product } from '../types/product';

const base = (overrides: Partial<Product>): Product => ({
  id: '1',
  imageUrl: 'https://example.com/x.jpg',
  title: 'Siyah Bluz',
  price: 499,
  brand: 'Zara',
  category: 'upper_body',
  garmentDescription: 'Zara Siyah Bluz',
  colorSlugs: ['siyah'],
  colors: [{ name: 'Siyah', hex: '#000000' }],
  ...overrides,
});

describe('searchMatch normalize', () => {
  it('folds Turkish letters', () => {
    expect(foldTr('Kırmızı')).toBe('kirmizi');
    expect(foldTr('İstanbul')).toContain('i');
    expect(normalizeTr('ŞĞÜ')).toBe('şğü');
  });
});

describe('facet matching layers', () => {
  it('matches color via attributes, title, or brand haystack', () => {
    expect(
      matchesColorFacet(
        {
          title: 'Günlük elbise',
          brand: 'Mango',
          colorSlugs: ['kirmizi'],
        },
        'kirmizi',
      ),
    ).toBe(true);

    expect(
      matchesColorFacet(
        {
          title: 'Kırmızı Elbise',
          brand: 'Mango',
          colorSlugs: [],
        },
        'kirmizi',
      ),
    ).toBe(true);

    expect(
      matchesColorFacet(
        {
          title: 'Elbise',
          brand: 'Kırmızı House',
          colorSlugs: [],
        },
        'kirmizi',
      ),
    ).toBe(true);
  });

  it('matches text on title only', () => {
    expect(matchesTextTitle('Oversize Sweat', 'sweat')).toBe(true);
    expect(matchesTextTitle('Elbise', 'zara')).toBe(false);
    expect(
      matchesBrandFacet(
        { title: 'Elbise', brand: 'Zara', colorSlugs: [] },
        'zara',
      ),
    ).toBe(true);
  });
});

describe('progressive relax', () => {
  it('drops color first and reports relaxed without fallback', () => {
    const products = [
      base({
        id: 'd1',
        title: 'Midi Elbise',
        category: 'dresses',
        colorSlugs: ['siyah'],
        colors: [{ name: 'Siyah', hex: '#000' }],
      }),
    ];
    const masked = applyFilterMaskProgressive(
      products,
      { category: 'dresses', color: 'kirmizi' },
      (p) => p,
    );
    expect(masked.items).toHaveLength(1);
    expect(masked.relaxed).toEqual(['color']);
    expect(masked.fallback).toBe(false);
  });

  it('sets fallback when soft ladder empties', () => {
    const products = [
      base({
        id: 'u1',
        title: 'Kot Pantolon',
        category: 'lower_body',
        colorSlugs: ['mavi'],
      }),
    ];
    const masked = applyFilterMaskProgressive(
      products,
      { category: 'dresses', color: 'kirmizi', text: 'olmayan' },
      (p) => p,
    );
    expect(masked.items).toHaveLength(0);
    expect(masked.fallback).toBe(true);
    expect(masked.relaxed).toEqual(['color', 'text']);
  });

  it('keeps brand as non-relaxed facet term', () => {
    const product = base({ brand: 'Mango', title: 'Bluz' });
    expect(
      productMatchesFilters(product, { brand: 'Zara' }),
    ).toBe(false);
    expect(
      productMatchesFilters(product, { brand: 'Mango' }),
    ).toBe(true);
  });
});

describe('searchRelaxBannerText', () => {
  it('uses personal fallback copy', () => {
    expect(
      searchRelaxBannerText({ category: 'dresses' }, ['color', 'text'], true),
    ).toBe('Eşleşme yok — benzerlerini gösteriyoruz');
  });

  it('describes color relax with remaining category', () => {
    expect(
      searchRelaxBannerText({ category: 'dresses', color: 'kirmizi' }, ['color'], false),
    ).toBe('Renk eşleşmedi — elbise sonuçları gösteriliyor');
  });
});
