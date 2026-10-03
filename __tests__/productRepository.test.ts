import { ProductRepository, productsById } from '../services/productRepository';
import { getSupabaseClient } from '../lib/supabase';
import type { Product } from '../types/product';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { hydrateFinal, serializeFinal } from '../src/recommendationCache/codec';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const top: Product = { id: 'top', title: 'Top', category: 'upper_body', outfitRole: 'top',
  price: 100, brand: 'Brand', imageUrl: 'top.jpg', garmentDescription: 'Top' };
const bottom: Product = { ...top, id: 'bottom', title: 'Bottom', category: 'lower_body', outfitRole: 'bottom' };

describe('canonical Product repository', () => {
  it('batches unique misses and resolves repeated IDs to the same cached object', async () => {
    const load = jest.fn(async () => [{ ...top }, { ...bottom }]);
    const repository = new ProductRepository(load);
    const first = await repository.productsById(['top', 'bottom', 'top']);
    const second = await repository.productsById(['bottom', 'top']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(['top', 'bottom']);
    expect(first.get('top')).toBe(second.get('top'));
    expect(first.get('bottom')).toBe(second.get('bottom'));
  });

  it('coalesces overlapping requests and retries errors and absent IDs', async () => {
    const load = jest.fn(async (ids: readonly string[]) => ids.includes('top') ? [{ ...top }] : []);
    const repository = new ProductRepository(load);
    const [first, second] = await Promise.all([
      repository.productsById(['top']), repository.productsById(['top', 'missing']),
    ]);
    expect(load.mock.calls.map(([ids]) => ids)).toEqual([['top'], ['missing']]);
    expect(first.get('top')).toBe(second.get('top'));
    expect(second.has('missing')).toBe(false);
    load.mockRejectedValueOnce(new Error('offline'));
    await expect(repository.productsById(['missing'])).rejects.toThrow('offline');
    await expect(repository.productsById(['missing'])).resolves.toEqual(new Map());
  });

  it('refreshes catalog fields in place, including removal of obsolete optional fields', async () => {
    const repository = new ProductRepository(async () => []);
    const canonical = repository.register([{ ...top, previousPrice: 200 }])[0];
    const updated = repository.register([{ ...top, price: 150 }])[0];
    expect(updated).toBe(canonical);
    expect(canonical.price).toBe(150);
    expect(canonical.previousPrice).toBeUndefined();
    expect((await repository.productsById(['top'])).get('top')).toBe(canonical);
  });

  it('hydrates recommendation product ID references to the feed objects without embedding product data', async () => {
    const repository = new ProductRepository(async () => []);
    const catalog = repository.register([{ ...top }, { ...bottom }]);
    const context = { input: { catalogProducts: catalog, wardrobeItems: [],
      requiredCatalogProductId: 'top', firstOnly: true } };
    const recommendations = getDiscoverRecommendations(context.input);
    expect(recommendations.length).toBeGreaterThan(0);
    const serialized = serializeFinal(recommendations, context);
    for (const field of ['imageUrl', 'price', 'brand', 'garmentDescription']) {
      expect(serialized).not.toContain(`"${field}"`);
    }
    const result = hydrateFinal(serialized, context);
    expect(result.status).toBe('hit');
    if (result.status !== 'hit') throw new Error('Hydration failed');
    const feed = await repository.productsById(['top', 'bottom']);
    for (const entry of result.value) {
      for (const item of entry.candidate.items) {
        if (item.sourceType === 'catalog') expect(item.product).toBe(feed.get(item.sourceId));
      }
      for (const product of entry.displayProducts ?? []) expect(product).toBe(feed.get(product.id));
    }
  });

  it('loads bulk misses from products and enriches attributes through the existing adapter', async () => {
    const queries: [string, readonly string[]][] = [];
    const client = { from: (table: string) => ({ select: () => ({ in: async (_column: string, ids: readonly string[]) => {
      queries.push([table, ids]);
      return { error: null, data: table === 'products' ? [{ id: 'top', provider: 'defacto', external_id: '1',
        title: 'Top', brand: 'Brand', price: 100, currency: 'TRY', image_url: 'top.jpg',
        product_url: 'https://example.com', category: 'upper_body', affiliate_url: null }]
        : [{ product_id: 'top', gender: 'women', outfit_role: 'top' }] };
    } }) }) };
    jest.mocked(getSupabaseClient).mockReturnValue(client as never);
    const first = await productsById(['top', 'top']);
    const second = await productsById(['top']);
    expect(queries).toEqual([['products', ['top']], ['product_attributes', ['top']]]);
    expect(first.get('top')).toMatchObject({ price: 100, brand: 'Brand', gender: 'women' });
    expect(first.get('top')).toBe(second.get('top'));
  });

  it('bounds bulk lookup batches and isolates identity maps when the backend client changes', async () => {
    const queryIds: string[][] = [];
    const createClient = () => ({ from: () => ({ select: () => ({ in: async (_column: string, ids: string[]) => {
      queryIds.push(ids);
      return { data: [], error: null };
    } }) }) });
    jest.mocked(getSupabaseClient).mockReturnValue(createClient() as never);
    const ids = Array.from({ length: 81 }, (_, index) => `id-${index}`);
    await expect(productsById(ids)).resolves.toEqual(new Map());
    expect(queryIds.map(batch => batch.length)).toEqual([80, 1]);
    jest.mocked(getSupabaseClient).mockReturnValue(createClient() as never);
    await productsById(['top']);
    expect(queryIds.at(-1)).toEqual(['top']);
  });
});
