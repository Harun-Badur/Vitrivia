import { buildTryOnShareMessage } from '../lib/vtonShare';
import type { Product } from '../types/product';

const sample: Product = {
  id: 'p1',
  imageUrl: 'https://example.com/p.jpg',
  title: 'Keten Gömlek',
  price: 890,
  brand: 'Kabin',
  category: 'upper_body',
  garmentDescription: 'Gömlek',
  affiliateUrl: 'https://www.trendyol.com/p/1',
};

describe('buildTryOnShareMessage', () => {
  it('ürün adı ve affiliate linkini birleştirir', () => {
    expect(buildTryOnShareMessage(sample)).toBe(
      "Vitirify'da sanal denedim: Keten Gömlek → https://www.trendyol.com/p/1",
    );
  });

  it('link yoksa yalnızca ürün adını kullanır', () => {
    expect(
      buildTryOnShareMessage({ ...sample, affiliateUrl: undefined, productUrl: undefined }),
    ).toBe("Vitirify'da sanal denedim: Keten Gömlek");
  });
});
