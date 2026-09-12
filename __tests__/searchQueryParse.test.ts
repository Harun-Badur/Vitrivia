import { parseSearchQuery } from '../lib/searchQueryParse';

describe('parseSearchQuery', () => {
  it('parses color + category + priceMax (altı)', () => {
    const { filters } = parseSearchQuery('kırmızı elbise 500 altı');
    expect(filters.color).toBe('kirmizi');
    expect(filters.category).toBe('dresses');
    expect(filters.priceMax).toBe(500);
    expect(filters.text).toBeUndefined();
  });

  it('parses priceMin (üstü) and range', () => {
    expect(parseSearchQuery('1000 üstü').filters.priceMin).toBe(1000);
    expect(parseSearchQuery('200-400').filters).toMatchObject({
      priceMin: 200,
      priceMax: 400,
    });
  });

  it('maps üst/alt/dış and keeps ayakkabı as text', () => {
    expect(parseSearchQuery('üst').filters.category).toBe('upper_body');
    expect(parseSearchQuery('alt').filters.category).toBe('lower_body');
    expect(parseSearchQuery('dış').filters.category).toBe('upper_body');
    expect(parseSearchQuery('ayakkabı kırmızı').filters).toMatchObject({
      color: 'kirmizi',
      text: 'ayakkabı',
    });
  });

  it('parses style tokens into style field', () => {
    expect(parseSearchQuery('midi saten elbise').filters).toMatchObject({
      category: 'dresses',
      style: 'midi',
    });
    // second style stays in text if style already set — first wins
    const { filters } = parseSearchQuery('maxi abiye');
    expect(filters.style).toBe('maxi');
  });

  it('matches brand from catalog list', () => {
    const { filters } = parseSearchQuery('siyah zara elbise', {
      brands: ['Zara', 'Mango'],
    });
    expect(filters.brand).toBe('Zara');
    expect(filters.color).toBe('siyah');
    expect(filters.category).toBe('dresses');
  });

  it('maps lacivert → navy slug and remainder → text', () => {
    const { filters } = parseSearchQuery('lacivert oversize sweat');
    expect(filters.color).toBe('navy');
    expect(filters.text).toMatch(/oversize/i);
  });

  it('returns empty filters for blank input', () => {
    expect(parseSearchQuery('   ').filters).toEqual({});
  });

  it('maps bluz to upper_body category', () => {
    expect(parseSearchQuery('siyah bluz').filters).toMatchObject({
      color: 'siyah',
      category: 'upper_body',
    });
  });
});
