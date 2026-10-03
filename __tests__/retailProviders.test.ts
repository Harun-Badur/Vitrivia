import {
  detectCatalogProvider,
  extractCatalogExternalId,
  extractRetailMetadata,
  inferCatalogCategory,
} from '../scripts/lib/retailProviders';
import type { FeedProvider } from '../types/product';

const cases: Array<[FeedProvider, string, string]> = [
  ['boyner', 'https://www.boyner.com.tr/gomlek-p-15927675', '15927675'],
  ['mavi', 'https://www.mavi.com/ekru-kazak/p/1710949-70057', '1710949-70057'],
  ['lcw', 'https://www.lcw.com/erkek-tisort-o-5456822', '5456822'],
  ['defacto', 'https://www.defacto.com.tr/wide-leg-pantolon-3408872', '3408872'],
  ['flo', 'https://www.flo.com.tr/urun/capraz-canta-200210031', '200210031'],
];

describe('retail provider URL mapping', () => {
  it.each(cases)('maps %s host and product ID', (provider, url, id) => {
    expect(detectCatalogProvider(url)).toBe(provider);
    expect(extractCatalogExternalId(url, provider)).toBe(id);
  });

  it('keeps existing providers and rejects unrelated hosts', () => {
    expect(detectCatalogProvider('https://www.trendyol.com/brand/item-p-123')).toBe('trendyol');
    expect(extractCatalogExternalId('https://www.trendyol.com/brand/item-p-123', 'trendyol')).toBe('123');
    expect(detectCatalogProvider('https://www.hepsiburada.com/urun-p-HBC123')).toBe('hepsiburada');
    expect(extractCatalogExternalId('https://www.hepsiburada.com/urun-p-HBC123', 'hepsiburada')).toBe('HBC123');
    expect(detectCatalogProvider('https://fake-mavi.com/item')).toBeNull();
    expect(extractCatalogExternalId('https://www.flo.com.tr/not-a-product-123', 'flo')).toBeNull();
  });

  it('classifies clear URL roles and leaves ambiguous items unclassified', () => {
    expect(inferCatalogCategory(cases[0][1])).toBe('upper_body');
    expect(inferCatalogCategory(cases[3][1])).toBe('lower_body');
    expect(inferCatalogCategory(cases[4][1])).toBe('bags');
    expect(inferCatalogCategory('https://www.trendyol.com/butik/etek-takim-p-123')).toBeNull();
    expect(inferCatalogCategory('https://www.mavi.com/urun/p/123')).toBeNull();
  });
});

describe('retail page metadata', () => {
  it('reads product JSON-LD title, price and gallery', () => {
    const html = '<script type="application/ld+json">' +
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Pamuklu Gömlek',
        brand: { name: 'Boyner' },
        offers: { price: '1.299,99' },
        image: ['/images/front.jpg', '/images/back.jpg'],
      }) + '</script>';
    expect(extractRetailMetadata(html, 'https://www.boyner.com.tr/gomlek-p-123')).toEqual({
      title: 'Pamuklu Gömlek',
      brand: 'Boyner',
      price: 1299.99,
      images: [
        'https://www.boyner.com.tr/images/front.jpg',
        'https://www.boyner.com.tr/images/back.jpg',
      ],
      imageSource: 'jsonld',
    });
  });

  it('reads product meta tags and rejects missing price or usable image', () => {
    const html = '<meta property="og:title" content="Kadın Ayakkabı">' +
      '<meta property="product:price:amount" content="799.90">' +
      '<meta property="og:image" content="https://cdn.example.com/shoe.jpg">';
    expect(extractRetailMetadata(html, 'https://www.flo.com.tr/urun/shoe-123')).toMatchObject({
      title: 'Kadın Ayakkabı',
      price: 799.9,
      images: ['https://cdn.example.com/shoe.jpg'],
      imageSource: 'og',
    });
    const missing = extractRetailMetadata('<meta property="og:image" content="/logo.svg">', 'https://www.mavi.com/item');
    expect(missing.price).toBeNull();
    expect(missing.images).toEqual([]);
    expect(extractRetailMetadata(
      '<meta property="product:price:amount" content="1.299">',
      'https://www.mavi.com/item',
    ).price).toBe(1299);
  });
});
