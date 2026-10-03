import { applyLocalFilters } from '../src/intelligence/filters/localFeedFilters';
import { filterProducts } from '../src/intelligence/filters/productFilters';
import {
  DEFAULT_RECS_CONFIG,
  emptySessionIntent,
  emptyStyleProfile,
} from '../lib/scoring';
import { toScoringCandidate } from '../src/intelligence/ranking/productCandidate';
import { rankCatalog } from '../src/intelligence/ranking/rankCatalog';
import { selectLocalFeed } from '../src/intelligence/recommendations/feedFallback';
import type { Product } from '../types/product';

const product: Product = {
  id: 'coat-1',
  imageUrl: 'https://example.com/coat.jpg',
  title: 'Kadın Siyah Ceket',
  price: 1200,
  currentPrice: 900,
  previousPrice: 1200,
  brand: 'Örnek',
  category: 'upper_body',
  garmentDescription: 'Örnek Kadın Siyah Ceket',
  sizes: ['M'],
  colorSlugs: ['siyah'],
};

describe('extracted intelligence rules', () => {
  it('keeps Turkish text, gender and size filtering together', () => {
    const products = [product, { ...product, id: 'coat-2', sizes: ['L'] }];
    expect(filterProducts(products, { query: 'ÖRNEK', gender: 'women', size: 'M' })).toEqual([
      product,
    ]);
  });

  it('relaxes a soft color facet without dropping a hard category', () => {
    const other = { ...product, id: 'dress-1', category: 'dresses' as const };
    expect(applyLocalFilters([other, product], {
      category: 'upper_body',
      color: 'mavi',
    })).toEqual({ products: [product], fallback: false, relaxed: ['color'] });
  });

  it('uses the display price and deal signal for ranking candidates', () => {
    const candidate = toScoringCandidate(product);
    expect(candidate.price).toBe(900);
    expect(candidate.deal).toBe(1);
    expect(candidate.gender).toBe('women');
  });

  it('keeps the existing personal fallback when a hard filter finds nothing', () => {
    const selected = selectLocalFeed([product], { category: 'dresses' }, 20);
    expect(selected.products).toEqual([product]);
    expect(selected.fallback).toBe(true);
    expect(selected.relaxed).toEqual([]);
  });

  it('keeps category constraints before local ranking', () => {
    const intent = emptySessionIntent();
    intent.constraints.category = 'upper_body';
    const dress = { ...product, id: 'dress-1', category: 'dresses' as const };
    const ranked = rankCatalog(
      [dress, product],
      'user-1',
      intent,
      2,
      'personal',
      DEFAULT_RECS_CONFIG,
      emptyStyleProfile('user-1'),
      Date.UTC(2026, 8, 24),
    );
    expect(ranked.map((item) => item.id)).toEqual(['coat-1']);
  });
});
