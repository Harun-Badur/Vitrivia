import { createElement, type ElementType, type ReactElement } from 'react';
import { TextInput } from 'react-native';
import { Image } from 'expo-image';
import FeedScreen from '../app/(tabs)/index';
import { complementaryProductsForDisplay } from '../components/DiscoverRecommendations';
import { loadDiscoverRecommendationPacket } from '../services/discoverRecommendationCacheService';
import { anchorContext } from '../src/recommendationCache/feedPacket';
import { serializeFinal } from '../src/recommendationCache/codec';
const getDiscoverRecommendations = jest.fn<Promise<ReturnType<typeof realService.getDiscoverRecommendations>>, [Parameters<typeof realService.getDiscoverRecommendations>[0], unknown?]>();
import { fetchRecommendationCatalog } from '../services/productService';
import { getSupabaseClient } from '../lib/supabase';
import { getProductRepository } from '../services/productRepository';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import type { Product } from '../types/product';

const mockLoadFeed = jest.fn();
const mockLoadMoreFeed = jest.fn();
const mockSwipeLeft = jest.fn();
const mockSwipeRight = jest.fn();
const mockUndoPass = jest.fn();
const mockSwipeCardRender = jest.fn();
const mockRouter = { push: jest.fn() };
const mockState = {
  currentProducts: [] as Product[],
  feedStatus: 'success',
  likedProducts: [],
  passedProductIds: [],
  passedStack: [],
  feedMode: 'personal',
  feedFallback: false,
  feedRelaxed: [],
  loadFeed: mockLoadFeed,
  loadMoreFeed: mockLoadMoreFeed,
  hasMore: false,
  isFetchingNext: false,
  setFeedMode: jest.fn(),
  swipeRight: mockSwipeRight,
  swipeLeft: mockSwipeLeft,
  undoPass: mockUndoPass,
};
let mockFocused = true;
let mockUser: { id: string } | null = null;
const mockIdleTasks = new Map<number, () => void>();
let mockIdleId = 0;

jest.mock('lucide-react-native', () => ({
  Search: () => null,
  SlidersHorizontal: () => null,
  X: () => null,
  Check: () => null,
  Plus: () => null,
}));
jest.mock('expo-image', () => ({
  Image: Object.assign('Image', { prefetch: jest.fn().mockResolvedValue(true) }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest
      .requireActual<typeof import('react')>('react')
      .useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (value: number) => jest.requireActual<typeof import('react')>('react').useRef({ value }).current,
  runOnUI: (callback: () => void) => callback,
}));
jest.mock('../hooks/useAuthContext', () => ({
  useAuthContext: () => ({ user: mockUser }),
}));
jest.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock('../lib/onboarding', () => ({
  hasSeenSwipeHint: jest.fn().mockResolvedValue(true),
  markSwipeHintSeen: jest.fn(),
}));
jest.mock('../lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../services/productService', () => ({
  fetchRecommendationCatalog: jest.fn(),
}));
jest.mock(
  '../src/intelligence/recommendations/getDiscoverRecommendations',
  () => ({
    getDiscoverRecommendationsAsync: jest.fn(), prepareDiscoverRankingAsync: jest.fn(), completeDiscoverRecommendationsAsync: jest.fn(),
  }),
);
jest.mock('../components/DiscoverRecommendations', () => ({
  __esModule: true,
  default: 'DiscoverRecommendations',
  complementaryProductsForDisplay: jest.requireActual('../src/intelligence/recommendations/complementaryProductsForDisplay').complementaryProductsForDisplay,
}));
jest.mock('../components/SwipeCard', () => ({
  __esModule: true,
  default: jest.requireActual<typeof import('react')>('react').memo((props: { product: Product; pageIndex: number; recommendations: readonly unknown[];
    selectedRecommendationProductIds: readonly string[]; onSelectRecommendation: (product: Product) => void }) => {
    mockSwipeCardRender(props.product.id);
    const react = jest.requireActual<typeof import('react')>('react');
    return react.createElement('SwipeCard', props, props.pageIndex === 0
      ? react.createElement('DiscoverRecommendations', {
        currentProductId: props.product.id, recommendations: props.recommendations,
        selectedProductIds: props.selectedRecommendationProductIds, onSelectProduct: props.onSelectRecommendation,
      }) : null);
  }),
  SWIPE_CARD_HEIGHT: 300,
  SWIPE_CARD_WIDTH: 320,
}));
jest.mock('../components/FeedModeSegment', () => 'FeedModeSegment');
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/FilterSheet', () => 'FilterSheet');
jest.mock('../components/SkeletonShimmer', () => 'SkeletonShimmer');
jest.mock('../components/SwipeHintOverlay', () => 'SwipeHintOverlay');
jest.mock('../components/VirtualTryOnModal', () => 'VirtualTryOnModal');

interface TestNode {
  props: Record<string, unknown>;
  parent: TestNode | null;
}

const renderer = jest.requireActual('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: ReactElement) => {
    root: {
      findByType: (type: ElementType | string) => TestNode;
      findAllByType: (type: string) => TestNode[];
    };
    update: (element: ReactElement) => void;
    unmount: () => void;
  };
};

const top = { ...MOCK_PRODUCTS[0], id: 'real-top', outfitRole: 'top' as const };
const bottom = {
  ...MOCK_PRODUCTS[1],
  id: 'real-bottom',
  category: 'lower_body' as const,
  outfitRole: 'bottom' as const,
};
const shoes = {
  ...MOCK_PRODUCTS[2],
  id: 'real-shoes',
  category: 'shoes' as const,
  outfitRole: 'shoes' as const,
};
const jacket = {
  ...MOCK_PRODUCTS[3],
  id: 'real-jacket',
  outfitRole: 'outerwear' as const,
};
const bag = {
  ...MOCK_PRODUCTS[3],
  id: 'real-bag',
  category: 'bags' as const,
  outfitRole: 'bag' as const,
};
const catalog = [top, bottom, shoes, jacket, bag];
jest.mock('../services/discoverRecommendationCacheService', () => ({ loadDiscoverRecommendationPacket: jest.fn() }));
const realService = jest.requireActual<
  typeof import('../src/intelligence/recommendations/getDiscoverRecommendations')
>('../src/intelligence/recommendations/getDiscoverRecommendations');

describe('Discover recommendation wiring', () => {
  let tree: ReturnType<typeof renderer.create> | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(async (request, _owner, signal, publish) => {
      const exposure = new Map(request.exposure);
      const entries = [];
      for (const anchor of request.anchors) {
        if (request.shownAnchorIds.includes(anchor.id)) continue;
        const context = anchorContext(request.candidatePool, anchor, request.wardrobeItems, exposure);
        const result = await getDiscoverRecommendations(context.input, { signal });
        entries.push({ anchorProductId: anchor.id, exposure: [...exposure], serialized: serializeFinal(result, context) });
        for (const product of complementaryProductsForDisplay(result, anchor.id)) exposure.set(product.id, (exposure.get(product.id) ?? 0) + 1);
      }
      publish({ sessionId: request.sessionId, generation: request.generation, contextFingerprint: request.contextFingerprint, entries });
    });
    jest.mocked(Image.prefetch).mockResolvedValue(true);
    mockIdleTasks.clear();
    global.requestIdleCallback = jest.fn(callback => {
      const id = ++mockIdleId;
      mockIdleTasks.set(id, () => callback({ didTimeout: false, timeRemaining: () => 50 }));
      return id;
    });
    global.cancelIdleCallback = jest.fn(id => { mockIdleTasks.delete(id); });
    mockFocused = true;
    mockUser = null;
    mockState.feedStatus = 'success';
    mockState.hasMore = false;
    mockState.isFetchingNext = false;
    mockState.currentProducts = catalog;
    jest.mocked(getSupabaseClient).mockReturnValue(null);
    jest.mocked(fetchRecommendationCatalog).mockResolvedValue(catalog);
    jest
      .mocked(getDiscoverRecommendations)
      .mockImplementation(async input => realService.getDiscoverRecommendations(input));
  });

  afterEach(async () => {
    if (tree)
      await renderer.act(() => {
        tree?.unmount();
      });
    tree = null;
  });

  const flushIdle = async (): Promise<void> => {
    while (mockIdleTasks.size > 0) {
      await renderer.act(async () => {
        const [id, callback] = [...mockIdleTasks][0];
        mockIdleTasks.delete(id);
        callback();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  };

  const mount = async (prepare = true): Promise<ReturnType<typeof renderer.create>> => {
    await renderer.act(async () => {
      tree = renderer.create(createElement(FeedScreen));
      await Promise.resolve();
      await Promise.resolve();
    });
    if (prepare) await flushIdle();
    return tree!;
  };

  it('does not start the optional catalog while the initial feed is loading', async () => {
    mockState.feedStatus = 'loading';
    await mount(false);
    expect(fetchRecommendationCatalog).not.toHaveBeenCalled();
    expect(getDiscoverRecommendations).not.toHaveBeenCalled();
    mockState.feedStatus = 'success';
  });

  it('starts no continuation while blurred and retains the five-product trigger on focus', async () => {
    mockFocused = false;
    mockState.hasMore = true;
    mockState.currentProducts = [bottom];
    const view = await mount(false);
    expect(mockLoadMoreFeed).not.toHaveBeenCalled();
    mockFocused = true;
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    expect(mockLoadMoreFeed).toHaveBeenCalledTimes(1);
  });

  it('passes complete ranked recommendations and three real catalog references to the UI', async () => {
    const view = await mount();
    const props = view.root.findByType('DiscoverRecommendations').props;
    const result = props.recommendations as ReturnType<
      typeof realService.getDiscoverRecommendations
    >;
    expect(getDiscoverRecommendations).toHaveBeenCalledWith({
      wardrobeItems: [],
      catalogProducts: catalog,
      requiredCatalogProductId: top.id,
      firstOnly: true,
      recommendationExposure: new Map(),
    }, { signal: expect.objectContaining({ aborted: expect.any(Boolean) }) });
    expect(props.currentProductId).toBe(top.id);
    expect(result[0]).toMatchObject({
      type: 'outfit',
      rank: 1,
      rankingValue: { coreComplete: true },
      sources: ['catalog'],
    });
    expect(result[0].reasons).toContainEqual({
      code: 'core_complete',
      form: 'two_piece',
    });
    expect(result[0].candidate.items.some((item) => item.product === top)).toBe(
      true,
    );
    expect(complementaryProductsForDisplay(result, top.id)).toHaveLength(3);
    expect(
      result[0].candidate.items.every((item) => item.sourceType === 'catalog'),
    ).toBe(true);
  });

  it('delivers three canonical complements to SwipeCard through the real service when the cache misses', async () => {
    const query = { select: jest.fn(), eq: jest.fn(), in: jest.fn(), abortSignal: jest.fn(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }) };
    for (const method of [query.select, query.eq, query.in, query.abortSignal]) method.mockReturnValue(query);
    const client = { from: jest.fn(() => query), rpc: jest.fn(), channel: jest.fn() };
    jest.mocked(getSupabaseClient).mockReturnValue(client as never);
    mockState.currentProducts = [top];
    const actualTransport = jest.requireActual<typeof import('../services/discoverRecommendationCacheService')>(
      '../services/discoverRecommendationCacheService');
    const mockedEngine = jest.requireMock<typeof import('../src/intelligence/recommendations/getDiscoverRecommendations')>(
      '../src/intelligence/recommendations/getDiscoverRecommendations');
    jest.mocked(mockedEngine.getDiscoverRecommendationsAsync).mockImplementation(async input => realService.getDiscoverRecommendations(input));
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(actualTransport.loadDiscoverRecommendationPacket);
    const view = await mount();
    const swipeCard = view.root.findAllByType('SwipeCard')[0];
    const recommendations = swipeCard.props.recommendations as ReturnType<typeof realService.getDiscoverRecommendations>;
    const expected = realService.getDiscoverRecommendations(anchorContext(catalog, top, [], new Map()).input);
    expect(recommendations).toStrictEqual(expected);
    expect(recommendations[0].displayProducts).toHaveLength(3);
    const products = complementaryProductsForDisplay(recommendations, top.id);
    const resolved = await getProductRepository().productsById(products.map(product => product.id));
    products.forEach(product => expect(product).toBe(resolved.get(product.id)));
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).toBe(recommendations);
    expect(client.rpc).not.toHaveBeenCalled(); expect(client.channel).not.toHaveBeenCalled();
  });

  it('finds a catalog bottom when the visible feed contains only a top', async () => {
    mockState.currentProducts = [top];
    const view = await mount();
    const result = view.root.findByType('DiscoverRecommendations').props
      .recommendations as ReturnType<
      typeof realService.getDiscoverRecommendations
    >;
    expect(complementaryProductsForDisplay(result, top.id)).toContain(bottom);
    expect(
      jest.mocked(getDiscoverRecommendations).mock.lastCall?.[0]
        .catalogProducts,
    ).toEqual(catalog);
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(top);
    expect(mockState.currentProducts).toEqual([top]);
  });

  it('finds a catalog top when the visible feed contains only a bottom', async () => {
    mockState.currentProducts = [bottom];
    const view = await mount();
    const result = view.root.findByType('DiscoverRecommendations').props
      .recommendations as ReturnType<
      typeof realService.getDiscoverRecommendations
    >;
    expect(complementaryProductsForDisplay(result, bottom.id)).toContain(top);
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(bottom);
  });

  it('passes real wardrobe rows while preserving their full source references', async () => {
    mockUser = { id: 'user-1' };
    mockState.currentProducts = [top];
    jest
      .mocked(fetchRecommendationCatalog)
      .mockResolvedValue([top, shoes, jacket, bag]);
    const wardrobeRow = {
      id: 'wardrobe-jeans',
      user_id: 'user-1',
      category: 'bottom',
      color: 'black',
    };
    const eq = jest
      .fn()
      .mockResolvedValue({ data: [wardrobeRow], error: null });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    jest.mocked(getSupabaseClient).mockReturnValue({ from } as never);
    const view = await mount();
    expect(from).toHaveBeenCalledWith('wardrobe_items');
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
    const result = view.root.findByType('DiscoverRecommendations').props
      .recommendations as ReturnType<
      typeof realService.getDiscoverRecommendations
    >;
    expect(
      result.some((entry) =>
        entry.candidate.items.some(
          (item) =>
            item.sourceType === 'wardrobe' && item.wardrobeItem === wardrobeRow,
        ),
      ),
    ).toBe(true);
  });

  it('keeps the empty result and main product card when there is no recommendation', async () => {
    jest.mocked(getDiscoverRecommendations).mockResolvedValue([]);
    const view = await mount();
    expect(
      view.root.findByType('DiscoverRecommendations').props.recommendations,
    ).toEqual([]);
    expect(view.root.findAllByType('SwipeCard')).toHaveLength(3);
  });

  it('keeps the empty result and feed when the catalog candidate pool is empty', async () => {
    jest.mocked(fetchRecommendationCatalog).mockResolvedValue([]);
    const view = await mount();
    expect(
      view.root.findByType('DiscoverRecommendations').props.recommendations,
    ).toEqual([]);
    expect(getDiscoverRecommendations).not.toHaveBeenCalled();
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(top);
  });

  it('keeps the feed available when the candidate catalog request fails', async () => {
    jest
      .mocked(fetchRecommendationCatalog)
      .mockRejectedValue(new Error('catalog unavailable'));
    const view = await mount();
    expect(
      view.root.findByType('DiscoverRecommendations').props.recommendations,
    ).toEqual([]);
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(top);
  });

  it('isolates recommendation errors from the current feed and interactions', async () => {
    jest.mocked(getDiscoverRecommendations).mockImplementation(() => {
      throw new Error('test failure');
    });
    const view = await mount();
    expect(
      view.root.findByType('DiscoverRecommendations').props.recommendations,
    ).toEqual([]);
    const card = view.root.findAllByType('SwipeCard')[0];
    expect(card.props.product).toBe(top);
    (card.props.onPass as (product: Product) => void)(top);
    expect(mockSwipeLeft).toHaveBeenCalledWith(top);
    expect(card.props.onUndoPass).toEqual(expect.any(Function));
    expect(card.props.onVirtualTryOn).toEqual(expect.any(Function));
    expect(card.props.onBuy).toEqual(expect.any(Function));
  });

  it('does not rerender product pages or calculate recommendations when search input alone changes', async () => {
    const view = await mount();
    const calls = jest.mocked(getDiscoverRecommendations).mock.calls.length;
    const cardRenders = mockSwipeCardRender.mock.calls.length;
    await renderer.act(() => {
      (view.root.findByType(TextInput).props.onChangeText as (value: string) => void)('tişört');
    });
    expect(getDiscoverRecommendations).toHaveBeenCalledTimes(calls);
    expect(mockSwipeCardRender).toHaveBeenCalledTimes(cardRenders);
  });

  it('binds recommendations inside the product page rather than a separate stationary section', async () => {
    const view = await mount();
    const card = view.root.findAllByType('SwipeCard')[0];
    const section = view.root.findByType('DiscoverRecommendations');
    let ancestor = card.parent;
    let deck: TestNode | null = null;
    while (ancestor) {
      if (
        typeof ancestor.props.onLayout === 'function' &&
        ancestor.props.collapsable === false
      ) {
        deck = ancestor;
        break;
      }
      ancestor = ancestor.parent;
    }
    expect(deck).not.toBeNull();
    ancestor = section.parent;
    let insideProduct = false;
    while (ancestor) {
      if (ancestor === card) insideProduct = true;
      ancestor = ancestor.parent;
    }
    expect(insideProduct).toBe(true);
    expect(card.props.dragOffset).toBeDefined();
    expect(section.props.dragOffset).toBeUndefined();
    expect(section.props.pageHeight).toBeUndefined();
  });

  it('shows the empty state for B when its recommendation is unavailable, never A cards', async () => {
    mockState.currentProducts = [top, bottom];
    jest.mocked(getDiscoverRecommendations).mockImplementation(async (input) =>
      input.requiredCatalogProductId === bottom.id ? [] : realService.getDiscoverRecommendations(input));
    const view = await mount();
    const firstProps = view.root.findByType('DiscoverRecommendations').props;
    expect(
      complementaryProductsForDisplay(
        firstProps.recommendations as ReturnType<
          typeof realService.getDiscoverRecommendations
        >,
        firstProps.currentProductId as string,
      ).length,
    ).toBeGreaterThan(0);
    jest
      .mocked(getDiscoverRecommendations)
      .mockImplementation(async (input) =>
        input.requiredCatalogProductId === bottom.id
          ? []
          : realService.getDiscoverRecommendations(input),
      );
    mockState.currentProducts = [bottom];
    await renderer.act(() => {
      view.update(createElement(FeedScreen));
    });
    const props = view.root.findByType('DiscoverRecommendations').props;
    expect(props.currentProductId).toBe(bottom.id);
    expect(props.recommendations).toEqual([]);
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(bottom);
  });
});
