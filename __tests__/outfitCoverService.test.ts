import { fetchOutfitCoverParts } from '../services/outfitCoverService';
import type { SavedOutfit } from '../types/wardrobe';
const mockFrom = jest.fn();
jest.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
const outfit: SavedOutfit = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'İlişkili',
  wardrobeItemIds: [],
  catalogProductIds: [],
  createdAt: '2026-09-28',
};
describe('read-only outfit cover resolution', () => {
  beforeEach(() => jest.clearAllMocks());
  it('reads outfit_items in position order and selects the correct source relation', async () => {
    const order = jest.fn().mockResolvedValue({
      error: null,
      data: [
        {
          id: '1',
          source_type: 'wardrobe',
          wardrobe_item_id: 'owned',
          product_id: null,
          wardrobe_item: { image_url: 'file:///owned.jpg' },
          product: null,
        },
        {
          id: '2',
          source_type: 'catalog',
          wardrobe_item_id: null,
          product_id: 'product',
          product: { image_url: 'https://example.com/product.jpg' },
          wardrobe_item: null,
        },
      ],
    });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });
    const parts = await fetchOutfitCoverParts(outfit, []);
    expect(mockFrom).toHaveBeenCalledWith('outfit_items');
    expect(eq).toHaveBeenCalledWith('outfit_id', outfit.id);
    expect(order).toHaveBeenCalledWith('position', { ascending: true });
    expect(parts.map((part) => [part.source, part.imageUrl])).toEqual([
      ['wardrobe', 'file:///owned.jpg'],
      ['catalog', 'https://example.com/product.jpg'],
    ]);
  });
  it('resolves uncached local outfit product IDs without querying local wardrobe IDs as UUIDs', async () => {
    const queryIn = jest
      .fn()
      .mockResolvedValue({
        error: null,
        data: [{ id: 'missing', image_url: 'https://example.com/missing.jpg' }],
      });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({ in: queryIn }),
    });
    const parts = await fetchOutfitCoverParts(
      { ...outfit, id: 'outfit-local' },
      [
        {
          key: 'wardrobe:local-owned',
          source: 'wardrobe',
          sourceId: 'local-owned',
          imageUrl: 'file:///owned.jpg',
        },
        { key: 'catalog:missing', source: 'catalog', sourceId: 'missing' },
      ],
    );
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(queryIn).toHaveBeenCalledWith('id', ['missing']);
    expect(parts[1].imageUrl).toBe('https://example.com/missing.jpg');
  });
});
