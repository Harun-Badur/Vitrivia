import { createElement, type ElementType, type ReactElement } from 'react';
import { Image } from 'expo-image';
import FeedScreen from '../app/(tabs)/index';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { prepareDiscoverRankingAsync, completeDiscoverRecommendationsAsync } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { fetchRecommendationCatalog } from '../services/productService';
import { getSupabaseClient } from '../lib/supabase';
import { loadDiscoverRecommendationPacket } from '../services/discoverRecommendationCacheService';
import { anchorContext, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { serializeFinal } from '../src/recommendationCache/codec';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import { getProductImages, type Product } from '../types/product';

const mockLoadFeed = jest.fn();
const mockLoadMoreFeed = jest.fn();
const mockSwipeLeft = jest.fn();
const mockSwipeRight = jest.fn();
const mockUndoPass = jest.fn();
const mockSwipeCardRender = jest.fn();
const mockRouter = { push: jest.fn() };
jest.mock('../services/discoverRecommendationCacheService', () => ({ loadDiscoverRecommendationPacket: jest.fn() }));
const mockState = {
  feedPreparationRevision: 1,
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
    prepareDiscoverRankingAsync: jest.fn(), completeDiscoverRecommendationsAsync: jest.fn(),
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
const realService = jest.requireActual<
  typeof import('../src/intelligence/recommendations/getDiscoverRecommendations')
>('../src/intelligence/recommendations/getDiscoverRecommendations');


jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', StatusBar: {
    setBarStyle: jest.fn(), pushStackEntry: jest.fn(), popStackEntry: jest.fn(),
  },
  StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {}, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn(), trackFeedImpression: jest.fn() }));
jest.mock('../services/deeplinkService', () => ({ getRedirectLabel: () => '', openProductPage: jest.fn() }));

describe('Discover cache-only wiring', () => {
  let tree: ReturnType<typeof renderer.create>;
  let publish: (packet: RecommendationFeedPacket) => void;
  let packet: RecommendationFeedPacket;
  const settle = () => renderer.act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  const mount = async () => { await renderer.act(async () => { tree = renderer.create(createElement(FeedScreen)); }); await settle(); };
  const update = async (products: Product[]) => { mockState.currentProducts = products; await renderer.act(() => tree.update(createElement(FeedScreen))); await settle(); };
  const current = () => tree.root.findByType('DiscoverRecommendations').props.recommendations as ReturnType<typeof realService.getDiscoverRecommendations>;
  beforeEach(() => {
    global.requestIdleCallback = jest.fn(callback => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; });
    global.cancelIdleCallback = jest.fn();
    jest.clearAllMocks(); mockFocused = true; mockUser = null; mockState.currentProducts = catalog;
    mockState.feedStatus = 'success'; mockState.feedPreparationRevision = 1;
    jest.mocked(getSupabaseClient).mockReturnValue(null); jest.mocked(fetchRecommendationCatalog).mockResolvedValue(catalog);
    jest.mocked(prepareDiscoverRankingAsync).mockImplementation(() => { throw new Error('Engine forbidden in Discover'); });
    jest.mocked(completeDiscoverRecommendationsAsync).mockImplementation(() => { throw new Error('Engine forbidden in Discover'); });
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(async (request, _owner, _signal, callback) => {
      publish = callback;
      const exposure = new Map(request.exposure); const entries = [];
      for (const anchor of request.anchors) {
        const context = anchorContext(request.candidatePool, anchor, request.wardrobeItems, exposure);
        const result = realService.getDiscoverRecommendations(context.input);
        entries.push({ anchorProductId: anchor.id, exposure: [...exposure], serialized: serializeFinal(result, context) });
        for (const product of complementaryProductsForDisplay(result, anchor.id)) exposure.set(product.id, (exposure.get(product.id) ?? 0) + 1);
      }
      packet = { sessionId: request.sessionId, generation: request.generation, contextFingerprint: request.contextFingerprint, entries };
    });
  });
  afterEach(async () => { if (tree) await renderer.act(() => tree.unmount()); });
  it('uses empty on miss and prepared memory results on hit; rapid swipe/undo start no engine or network', async () => {
    await mount(); expect(current()).toEqual([]);
    await renderer.act(() => publish(packet));
    const first = current(); expect(first.length).toBeGreaterThan(0);
    const calls = jest.mocked(loadDiscoverRecommendationPacket).mock.calls.length;
    await update(catalog.slice(1)); expect(current().length).toBeGreaterThan(0);
    await update(catalog.slice(2)); expect(current().length).toBeGreaterThan(0);
    await update(catalog); expect(current()).toBe(first);
    await update(catalog.slice(3));
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(calls);
    expect(prepareDiscoverRankingAsync).not.toHaveBeenCalled(); expect(completeDiscoverRecommendationsAsync).not.toHaveBeenCalled();
  });
  it('rejects predicted exposure after a rapid swipe past unseen anchors', async () => {
    await mount(); await update(catalog.slice(2)); await renderer.act(() => publish(packet));
    expect(current()).toEqual([]);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong context, stale generation and changed product snapshots', async () => {
    await mount(); await renderer.act(() => publish({ ...packet, contextFingerprint: 'wrong' })); expect(current()).toEqual([]);
    await renderer.act(() => publish({ ...packet, generation: 0 })); expect(current()).toEqual([]);
    await renderer.act(() => publish(packet));
    await update([{ ...top, title: 'Changed snapshot' }, ...catalog.slice(1)]); expect(current()).toEqual([]);
  });
  it('keeps the pending request and its valid publication when a feed batch is appended', async () => {
    await mount(); const old = packet, oldPublish = publish;
    const signal = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0][2];
    mockState.feedPreparationRevision++; await update([...catalog, { ...bag, id: 'appended' }]);
    expect(signal.aborted).toBe(false);
    await renderer.act(() => oldPublish(old)); expect(current().length).toBeGreaterThan(0);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(1);
  });
  it('cancels a real user context change and rejects the old publication', async () => {
    await mount(); const old = packet, oldPublish = publish;
    const signal = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0][2];
    mockUser = { id: 'new-owner' }; await update(catalog);
    expect(signal.aborted).toBe(true);
    await renderer.act(() => oldPublish(old)); expect(current()).toEqual([]);
  });
  it('still cancels when the feed is replaced through a loading transition', async () => {
    await mount(); const old = packet, oldPublish = publish;
    const signal = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0][2];
    mockState.feedStatus = 'loading'; await update([]);
    expect(signal.aborted).toBe(true);
    mockState.feedPreparationRevision++; mockState.feedStatus = 'success'; await update(catalog);
    await renderer.act(() => oldPublish(old)); expect(current()).toEqual([]);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(2);
  });
  it('accepts newly appended window anchors through the original callback', async () => {
    await mount(); const appended = { ...bag, id: 'appended-anchor' };
    mockState.feedPreparationRevision++; await update([...catalog, appended]);
    await update([appended]);
    const request = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0][0];
    const context = anchorContext(catalog, appended, [], new Map());
    const result = realService.getDiscoverRecommendations(context.input);
    await renderer.act(() => publish({ sessionId: request.sessionId, generation: request.generation,
      contextFingerprint: request.contextFingerprint, entries: [{ anchorProductId: appended.id,
        exposure: [], serialized: serializeFinal(result, context) }] }));
    expect(current()).toEqual(result);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(1);
  });
  it('aborts pending delivery on blur and prevents late results from being published', async () => {
    await mount(); const signal = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0][2];
    mockFocused = false; await update(catalog); expect(signal.aborted).toBe(true);
    await renderer.act(() => publish(packet)); expect(current()).toEqual([]);
    mockFocused = true; await update(catalog); expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(2);
  });
  it('never waits for recommendation image prefetch before rendering a hit', async () => {
    jest.mocked(Image.prefetch).mockImplementation(() => new Promise(() => {}));
    await mount(); await renderer.act(() => publish(packet)); expect(current().length).toBeGreaterThan(0);
  });
  it('retries an initial NO_ANCHORS request when the first products arrive', async () => {
    mockState.currentProducts = [];
    await mount();
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(1);
    const emptyCall = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0];
    expect(emptyCall[0].anchors).toEqual([]);
    await update(catalog);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(2);
    const startedCall = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[1];
    expect(startedCall[0].anchors).toEqual(catalog);
    expect(startedCall[2]).toBe(emptyCall[2]);
    expect(startedCall[2].aborted).toBe(false);
    await renderer.act(() => publish(packet));
    expect(current().length).toBeGreaterThan(0);
  });
  it('keeps the cold-start worker when products are appended or temporarily empty', async () => {
    mockState.currentProducts = [];
    await mount(); await update(catalog);
    const signal = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[1][2];
    mockState.feedPreparationRevision++;
    await update([...catalog, { ...bag, id: 'cold-append' }]);
    await update([]); await update(catalog);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(2);
    expect(signal.aborted).toBe(false);
  });
  it('removes the empty-anchor retry on blur and starts only after refocus', async () => {
    mockState.currentProducts = [];
    await mount();
    const signal = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0][2];
    mockFocused = false; await update([]); await update(catalog);
    expect(signal.aborted).toBe(true);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(1);
    mockFocused = true; await update(catalog);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(2);
    expect(jest.mocked(loadDiscoverRecommendationPacket).mock.calls[1][2].aborted).toBe(false);
  });
  it('updates the preparation window without a new request and warms next recommendation images before promotion', async () => {
    await mount();
    const session = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0][4]!;
    expect(session.preparationWindow).toEqual(catalog.slice(0, 3));
    const alreadyWarmed = new Set(jest.mocked(Image.prefetch).mock.calls.flatMap(([urls]) =>
      typeof urls === 'string' ? [urls] : urls));
    await renderer.act(() => publish({ ...packet, entries: [packet.entries[1]] }));
    expect(current()).toEqual([]);
    const nextImages = complementaryProductsForDisplay(session.peekPrepared(bottom)!, bottom.id)
      .flatMap(product => getProductImages(product).slice(0, 1)).filter(url => !alreadyWarmed.has(url));
    expect(nextImages.length).toBeGreaterThan(0);
    expect(Image.prefetch).toHaveBeenCalledWith(expect.arrayContaining(nextImages), { cachePolicy: 'memory-disk' });
    await update(catalog.slice(1));
    expect(session.preparationWindow).toEqual(catalog.slice(1, 4));
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(1);
  });
});
