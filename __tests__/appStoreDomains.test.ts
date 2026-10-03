import { MOCK_PRODUCTS } from '../data/mockProducts';
import { useAppStore } from '../store/useAppStore';
import type { LikedProduct } from '../types/product';
import { fetchFeedProducts } from '../services/productService';
import { deleteLikedProduct, fetchLikedProducts, fetchPassedProductIds } from '../services/likeService';
import { DEFAULT_FEED_MODE } from '../types/recommendation';

jest.mock('../services/productService', () => ({
  fetchFeedProducts: jest.fn(),
}));
jest.mock('../services/likeService', () => ({
  fetchLikedProducts: jest.fn(),
  fetchPassedProductIds: jest.fn(),
  insertLikedProduct: jest.fn(),
  insertPassedProduct: jest.fn(),
  deleteLikedProduct: jest.fn(),
  updateLikedProductAlert: jest.fn(),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({
  recordSessionProductAction: jest.fn(),
  resetSessionIntent: jest.fn(),
}));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn() }));

const [first, second, third] = MOCK_PRODUCTS;
const liked: LikedProduct = {
  product: first,
  notifyOnPriceDrop: true,
  likedAt: '2026-01-01T00:00:00.000Z',
};

describe('app store domain state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({
      currentProducts: [],
      likedProducts: [],
      passedProductIds: [],
      passedStack: [],
      feedStatus: 'idle',
      feedSource: null,
      feedIsPersonalized: false,
      feedFallback: false,
      feedRelaxed: [],
      sessionUserId: null,
      sessionSyncStatus: 'idle',
    });
  });

  it('profile hydration removes favorites and passes from discovery', async () => {
    jest.mocked(fetchLikedProducts).mockResolvedValue([liked]);
    jest.mocked(fetchPassedProductIds).mockResolvedValue([second.id]);
    useAppStore.setState({ currentProducts: [first, second, third] });

    await useAppStore.getState().hydrateSession('user-1');

    expect(useAppStore.getState()).toMatchObject({
      sessionUserId: 'user-1',
      sessionSyncStatus: 'success',
      likedProducts: [liked],
      passedProductIds: [second.id],
      currentProducts: [third],
    });
  });

  it('feed loading excludes existing favorite and passed products', async () => {
    jest.mocked(fetchFeedProducts).mockResolvedValue({
      products: [first, second, third],
      source: 'mock',
      isPersonalized: false,
    });
    useAppStore.setState({
      likedProducts: [liked],
      passedProductIds: [second.id],
    });

    await useAppStore.getState().loadFeed(null);

    expect(useAppStore.getState()).toMatchObject({
      currentProducts: [third],
      feedStatus: 'success',
      feedSource: 'mock',
    });
  });

  it('pass, undo and like keep the flat screen API and separate state', () => {
    useAppStore.setState({ currentProducts: [first, second] });

    useAppStore.getState().swipeLeft(first);
    expect(useAppStore.getState()).toMatchObject({
      currentProducts: [second],
      passedProductIds: [first.id],
      passedStack: [first],
      likedProducts: [],
    });

    expect(useAppStore.getState().undoPass()).toBe(true);
    expect(useAppStore.getState()).toMatchObject({
      currentProducts: [first, second],
      passedProductIds: [],
      passedStack: [],
    });

    useAppStore.getState().swipeRight(first);
    expect(useAppStore.getState().currentProducts).toEqual([second]);
    expect(useAppStore.getState().likedProducts[0].product).toBe(first);
    expect(useAppStore.getState().passedProductIds).toEqual([]);
  });

  it('try-on sync adds a favorite once without changing discovery or pass state', () => {
    useAppStore.setState({ currentProducts: [first], passedProductIds: [second.id] });

    useAppStore.getState().addLikedProductLocally(first);
    useAppStore.getState().addLikedProductLocally(first);

    expect(useAppStore.getState().likedProducts).toHaveLength(1);
    expect(useAppStore.getState().likedProducts[0]).toMatchObject({
      product: first,
      notifyOnPriceDrop: true,
    });
    expect(useAppStore.getState().currentProducts).toEqual([first]);
    expect(useAppStore.getState().passedProductIds).toEqual([second.id]);
  });

  it('session reset clears user data while retaining the current feed', () => {
    useAppStore.setState({
      sessionUserId: 'user-1',
      sessionSyncStatus: 'success',
      currentProducts: [third],
      likedProducts: [liked],
      passedProductIds: [second.id],
      passedStack: [second],
      feedIsPersonalized: true,
      feedFallback: true,
      feedRelaxed: ['category'],
    });

    useAppStore.getState().resetSession();

    expect(useAppStore.getState()).toMatchObject({
      sessionUserId: null,
      sessionSyncStatus: 'idle',
      currentProducts: [third],
      likedProducts: [],
      passedProductIds: [],
      passedStack: [],
      feedIsPersonalized: false,
      feedMode: DEFAULT_FEED_MODE,
      feedFallback: false,
      feedRelaxed: [],
    });
  });

  it('removes a favorite through the existing service without changing discovery', async () => {
    jest.mocked(deleteLikedProduct).mockResolvedValueOnce(undefined);
    useAppStore.setState({ sessionUserId: 'user-1', currentProducts: [third], likedProducts: [liked] });
    await useAppStore.getState().unlikeProduct(first.id);
    expect(deleteLikedProduct).toHaveBeenCalledWith('user-1', first.id);
    expect(useAppStore.getState().likedProducts).toEqual([]);
    expect(useAppStore.getState().currentProducts).toEqual([third]);
  });

  it('restores a favorite after a failed removal without changing discovery', async () => {
    jest.mocked(deleteLikedProduct).mockRejectedValueOnce(new Error('offline'));
    const secondLike = { ...liked, product: second };
    useAppStore.setState({ sessionUserId: 'user-1', currentProducts: [third], likedProducts: [liked, secondLike] });
    await expect(useAppStore.getState().unlikeProduct(first.id)).rejects.toThrow('offline');
    expect(useAppStore.getState().likedProducts).toEqual([liked, secondLike]);
    expect(useAppStore.getState().currentProducts).toEqual([third]);
  });
});
