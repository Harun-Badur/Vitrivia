import {
  ingestCatalogLink,
  persistIngestionResult,
  type CatalogMetadata,
} from '../scripts/lib/catalogIngestion';

const boynerUrl = 'https://www.boyner.com.tr/gomlek-p-15927675';
const maviUrl = 'https://www.mavi.com/ekru-kazak/p/1710949-70057';
const validMeta: CatalogMetadata = {
  httpStatus: 200,
  softBlocked: false,
  title: 'Pamuklu Gömlek',
  brand: 'Marka',
  price: 1299,
  imageUrls: ['https://images.example.com/product.jpg'],
  imageSource: 'jsonld',
};
const emptySets = () => ({ ids: new Set<string>(), urls: new Set<string>() });
const link = (url = boynerUrl) => ({
  url, categoryRaw: 'upper_body', gender: null, brandHint: '',
});

describe('provider-independent catalog ingestion', () => {
  it('normalizes real provider URL, ID, metadata and category without a fallback product', async () => {
    const result = await ingestCatalogLink(link(), emptySets(), emptySets(), async () => validMeta);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.product).toMatchObject({
      provider: 'boyner', external_id: '15927675', title: validMeta.title,
      brand: validMeta.brand, price: validMeta.price,
      image_url: validMeta.imageUrls[0], product_url: boynerUrl,
      category: 'upper_body',
    });
  });

  it('deduplicates by provider + external ID and canonical URL before fetching', async () => {
    const existing = emptySets();
    existing.ids.add('boyner-15927675');
    const fetchMeta = jest.fn(async () => validMeta);
    const byId = await ingestCatalogLink(link(), existing, emptySets(), fetchMeta);
    expect(byId).toMatchObject({ status: 'duplicate', reason: 'already_in_catalog' });
    existing.ids.clear();
    existing.urls.add(boynerUrl);
    const byUrl = await ingestCatalogLink(link(`${boynerUrl}?utm_source=x`), existing, emptySets(), fetchMeta);
    expect(byUrl).toMatchObject({ status: 'duplicate', reason: 'already_in_catalog' });
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it('skips HTTP 403 and missing trusted title, price or image', async () => {
    for (const [metadata, reason] of [
      [{ ...validMeta, httpStatus: 403 }, 'http_403'],
      [{ ...validMeta, title: 'Trendyol' }, 'no_usable_title'],
      [{ ...validMeta, price: null }, 'no_usable_price'],
      [{ ...validMeta, imageUrls: [] }, 'no_usable_image'],
    ] as Array<[CatalogMetadata, string]>) {
      const result = await ingestCatalogLink(link(maviUrl), emptySets(), emptySets(), async () => metadata);
      expect(result).toMatchObject({ status: 'skipped', reason });
    }
  });

  it('does not call the insert callback in dry-run; real mode can call it', async () => {
    const ready = await ingestCatalogLink(link(), emptySets(), emptySets(), async () => validMeta);
    const insert = jest.fn(async () => ({ status: 'inserted' as const, provider: 'boyner' as const, url: boynerUrl }));
    expect((await persistIngestionResult(ready, true, insert)).status).toBe('ready');
    expect(insert).not.toHaveBeenCalled();
    expect((await persistIngestionResult(ready, false, insert)).status).toBe('inserted');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('does not invent a brand when page metadata omits it', async () => {
    const result = await ingestCatalogLink(link(), emptySets(), emptySets(), async () => ({
      ...validMeta, brand: null,
    }));
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.product.brand).toBeNull();
      expect(result.product.garment_description).toBe(validMeta.title);
    }
  });

  it('reports an insert error per URL without throwing', async () => {
    const ready = await ingestCatalogLink(link(), emptySets(), emptySets(), async () => validMeta);
    const result = await persistIngestionResult(ready, false, async () => { throw new Error('write failed'); });
    expect(result).toMatchObject({ status: 'failed', reason: 'insert_error:write failed' });
  });

  it('continues with the next link after a metadata error', async () => {
    const seen = emptySets();
    const failed = await ingestCatalogLink(link(), emptySets(), seen, async () => { throw new Error('offline'); });
    const next = await ingestCatalogLink(link(maviUrl), emptySets(), seen, async () => validMeta);
    expect(failed).toMatchObject({ status: 'failed', reason: 'metadata_fetch_error:offline' });
    expect(next.status).toBe('ready');
  });
});
