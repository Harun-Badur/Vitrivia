import { createElement, type ElementType, type ReactElement } from 'react';
import { Alert, FlatList, ScrollView, TextInput } from 'react-native';
import * as ReactNative from 'react-native';
import LikedScreen, { DolapProductCard } from '../app/(tabs)/liked';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import type { LikedProduct } from '../types/product';
import type { SavedOutfit, WardrobeItem } from '../types/wardrobe';

interface TestNode {
  props: {
    data: (LikedProduct | null)[] | readonly string[];
    width: number;
    imageHeight: number;
    favorite?: boolean;
    wardrobe?: boolean;
    matchFavoriteLayout?: boolean;
    product: LikedProduct['product'];
    numColumns: number;
    horizontal?: boolean;
    disabled?: boolean;
    source: { uri: string };
    contentFit: string;
    contentPosition: string;
    style: ReactNative.StyleProp<ReactNative.ViewStyle>;
    onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
    onPress: () => void;
    onChangeText: (value: string) => void;
  };
}
interface TestTree {
  root: {
    findByType: (type: ElementType) => TestNode;
    findAllByType: (type: ElementType) => TestNode[];
    findByProps: (props: Record<string, unknown>) => TestNode;
    findAllByProps: (props: Record<string, unknown>) => TestNode[];
  };
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => TestTree;
  act: (callback: () => void) => Promise<void>;
};

const mockRemove = jest.fn().mockResolvedValue(undefined);
const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockNavigate = jest.fn();
const mockPush = jest.fn();
const mockRemoveClothes = jest.fn().mockResolvedValue(undefined);
const mockState = {
  sessionSyncStatus: 'ready',
  swipeRight: jest.fn(),
  likedProducts: [] as LikedProduct[],
  wardrobeItems: [] as WardrobeItem[],
  savedOutfits: [] as SavedOutfit[],
  removeWardrobeItem: mockRemoveClothes,
  unlikeProduct: mockRemove,
  refreshLikedProducts: mockRefresh,
};
jest.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  Heart: () => null,
  Shirt: () => null,
  Layers: () => null,
  MoreVertical: () => null,
  Trash2: () => null,
  Plus: () => null,
  ChevronRight: () => null,
  Search: () => null,
  SlidersHorizontal: () => null,
  X: () => null,
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/VirtualTryOnModal', () => 'VirtualTryOnModal');
const mockGestures: Array<{
  update?: (event: { translationX: number }) => void;
  end?: () => void;
}> = [];
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: 'GestureDetector',
  Gesture: {
    Pan: () => {
      const handlers: (typeof mockGestures)[number] = {};
      mockGestures.push(handlers);
      const chain = {
        enabled: jest.fn().mockReturnThis(),
        activeOffsetX: jest.fn().mockReturnThis(),
        failOffsetY: jest.fn().mockReturnThis(),
        onUpdate: (callback: typeof handlers.update) => {
          handlers.update = callback;
          return chain;
        },
        onEnd: (callback: typeof handlers.end) => {
          handlers.end = callback;
          return chain;
        },
      };
      return chain;
    },
  },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  cancelAnimation: jest.fn(),
  Extrapolation: { CLAMP: 'clamp' },
  interpolate: () => 0,
  runOnJS: (callback: () => void) => callback,
  useAnimatedStyle: (callback: () => unknown) => callback(),
  useSharedValue: (value: number) => {
    const React = jest.requireActual('react') as typeof import('react');
    return React.useRef({ value }).current;
  },
  withSpring: jest.fn((value: number) => value),
  withTiming: (
    value: number,
    _config: unknown,
    callback?: (finished: boolean) => void,
  ) => {
    callback?.(true);
    return value;
  },
}));
jest.mock('../services/deeplinkService', () => ({
  openProductPage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react') as typeof import('react');
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('../components/RefreshSpinner', () => 'RefreshSpinner');
jest.mock('../components/SkeletonShimmer', () => 'SkeletonShimmer');
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { error: jest.fn() } }));

describe('Wardrobe screen', () => {
  let view: TestTree;
  beforeEach(async () => {
    jest.clearAllMocks();
    mockState.sessionSyncStatus = 'ready';
    mockState.wardrobeItems = [];
    mockState.savedOutfits = [];
    mockGestures.length = 0;
    mockState.likedProducts = MOCK_PRODUCTS.slice(0, 4).map(
      (product, index) => ({
        product: { ...product, category: index === 0 ? 'shoes' : 'upper_body' },
        likedAt: '2026-09-28T00:00:00Z',
        notifyOnPriceDrop: true,
      }),
    );
    await renderer.act(async () => {
      view = renderer.create(createElement(LikedScreen));
    });
  });
  afterEach(async () => {
    await renderer.act(async () => view.unmount());
    jest.restoreAllMocks();
  });
  it('separates wardrobe, favorites and saved outfits without inventing owned products', () => {
    for (const title of ['Kıyafetlerim', 'Favorilerim', 'Kombinlerim']) {
      expect(view.root.findByProps({ children: title })).toBeDefined();
    }
    expect(
      view.root.findByProps({ children: 'Dolabını oluşturmaya başla' }),
    ).toBeDefined();
    expect(
      view.root.findByProps({ children: 'Henüz kayıtlı kombin yok.' }),
    ).toBeDefined();
    for (const { product } of mockState.likedProducts.slice(0, 3)) {
      expect(
        view.root.findByProps({
          accessibilityLabel: `${product.title} kombinle`,
        }),
      ).toBeDefined();
    }
    expect(
      view.root.findAllByProps({
        accessibilityLabel: `${mockState.likedProducts[3].product.title} kombinle`,
      }),
    ).toHaveLength(0);
    expect(view.root.findAllByType(FlatList)).toHaveLength(0);
    expect(
      view.root
        .findAllByType(ScrollView)
        .every((node) => node.props.horizontal === true),
    ).toBe(true);
    expect(
      view.root.findByProps({
        accessibilityLabel: 'Kıyafet ekle',
      }),
    ).toBeDefined();
    expect(
      view.root.findByProps({
        accessibilityLabel: 'Yeni kombin oluştur',
      }),
    ).toBeDefined();
  });
  it('keeps wardrobe filters and search independent of catalog favorites', async () => {
    const before = [...mockState.likedProducts];
    await renderer.act(async () =>
      view.root.findByProps({ accessibilityLabel: 'Ayakkabı' }).props.onPress(),
    );
    for (const { product } of before.slice(0, 3)) {
      expect(
        view.root.findByProps({
          accessibilityLabel: `${product.title} tekrar dene`,
        }),
      ).toBeDefined();
    }
    await renderer.act(async () =>
      view.root
        .findByProps({ accessibilityLabel: 'Dolapta ara' })
        .props.onPress(),
    );
    await renderer.act(async () =>
      view.root.findByType(TextInput).props.onChangeText('no matching garment'),
    );
    for (const { product } of before.slice(0, 3)) {
      expect(
        view.root.findByProps({
          accessibilityLabel: `${product.title} tekrar dene`,
        }),
      ).toBeDefined();
    }
    expect(mockState.likedProducts).toEqual(before);
  });
  it('uses the uploaded onboarding asset with its original proportions', () => {
    const image = view.root.findByProps({
      accessibilityLabel: 'Dolap başlangıç görseli',
    });
    expect(image.props.source).toEqual(
      jest.requireActual('../assets/wardrobe-onboarding.png'),
    );
    expect(image.props.contentFit).toBe('contain');
    expect(image.props.contentPosition).toBe('center');
  });
  it('uses the Favorites gallery rendering in equally sized image areas', async () => {
    const galleryUrl = 'https://example.com/full-portrait.jpg';
    await renderer.act(async () => {
      view.unmount();
      mockState.likedProducts[0].product = {
        ...mockState.likedProducts[0].product,
        images: [galleryUrl],
      };
      view = renderer.create(createElement(LikedScreen));
    });
    await renderer.act(async () => {
      view.root
        .findByProps({ accessibilityLabel: 'Favori ürünleri' })
        .props.onLayout({ nativeEvent: { layout: { height: 140 } } });
    });
    const heights = mockState.likedProducts.slice(0, 3).map(({ product }) => {
      const image = view.root.findByProps({
        accessibilityLabel: `${product.title} ürün görseli`,
      });
      expect(image.props.contentFit).toBe('cover');
      expect(image.props.contentPosition).toBe('center');
      const button = view.root.findByProps({
        accessibilityLabel: `${product.title} tekrar dene`,
      });
      return ReactNative.StyleSheet.flatten(button.props.style).height;
    });
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBeGreaterThan(0);
    expect(
      view.root.findByProps({
        accessibilityLabel: `${mockState.likedProducts[0].product.title} ürün görseli`,
      }).props.source.uri,
    ).toBe(galleryUrl);
  });
  it.each([
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ])(
    'keeps the starter and three favorites on a $width by $height viewport',
    async ({ width, height }) => {
      jest
        .spyOn(ReactNative.Dimensions, 'get')
        .mockReturnValue({ width, height, scale: 1, fontScale: 1 });
      await renderer.act(async () => {
        view.unmount();
        view = renderer.create(createElement(LikedScreen));
      });
      for (const title of ['Kıyafetlerim', 'Favorilerim', 'Kombinlerim']) {
        expect(view.root.findByProps({ children: title })).toBeDefined();
      }
      expect(
        view.root.findByProps({ children: 'Dolabını oluşturmaya başla' }),
      ).toBeDefined();
      for (const { product } of mockState.likedProducts.slice(0, 3)) {
        expect(
          view.root.findByProps({
            accessibilityLabel: `${product.title} kombinle`,
          }),
        ).toBeDefined();
      }
      expect(
        view.root.findAllByProps({
          accessibilityLabel: 'Daha fazla favorile, Keşfet’ten ürün ekle',
        }),
      ).toHaveLength(0);
      expect(view.root.findAllByType(FlatList)).toHaveLength(0);
    },
  );
  it('shows a compact favorites prompt when there are no catalog favorites', async () => {
    await renderer.act(async () => {
      view.unmount();
      mockState.likedProducts = [];
      view = renderer.create(createElement(LikedScreen));
    });
    expect(
      view.root.findByProps({ children: 'Henüz favori ürün yok.' }),
    ).toBeDefined();
    expect(
      view.root.findByProps({
        accessibilityLabel: 'Daha fazla favorile, Keşfet’ten ürün ekle',
      }),
    ).toBeDefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });
  it('keeps all three sections visible while favorites are loading', async () => {
    await renderer.act(async () => {
      view.unmount();
      mockState.sessionSyncStatus = 'loading';
      view = renderer.create(createElement(LikedScreen));
    });
    for (const title of ['Kıyafetlerim', 'Favorilerim', 'Kombinlerim']) {
      expect(view.root.findByProps({ children: title })).toBeDefined();
    }
    expect(
      view.root.findByProps({ accessibilityLabel: 'Favori ürünleri' }),
    ).toBeDefined();
    expect(view.root.findAllByType(FlatList)).toHaveLength(0);
  });
  it('opens creation with the selected favorite and keeps every action clickable', async () => {
    for (const { product } of mockState.likedProducts.slice(0, 3)) {
      const button = view.root.findByProps({
        accessibilityLabel: `${product.title} kombinle`,
      });
      expect(button.props.disabled).not.toBe(true);
      await renderer.act(async () => button.props.onPress());
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: '/wardrobe/create',
        params: { productId: product.id, source: 'catalog' },
      });
    }
    for (const [label, route] of [
      [
        'Kıyafetlerim tümünü gör',
        { pathname: '/wardrobe/[section]', params: { section: 'clothes' } },
      ],
      [
        'Kombinlerim tümünü gör',
        { pathname: '/wardrobe/[section]', params: { section: 'outfits' } },
      ],
      ['Kıyafet ekle', { pathname: '/wardrobe/add', params: {} }],
      ['Yeni kombin oluştur', { pathname: '/wardrobe/create', params: {} }],
    ]) {
      const button = view.root.findByProps({ accessibilityLabel: label });
      expect(button.props.disabled).not.toBe(true);
      await renderer.act(async () => button.props.onPress());
      expect(mockPush).toHaveBeenLastCalledWith(route);
    }
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockState.swipeRight).not.toHaveBeenCalled();
  });
  it('opens the Dolap favorites list without navigating to the global tab', async () => {
    const button = view.root.findByProps({
      accessibilityLabel: 'Favorilerim tümünü gör',
    });
    expect(button.props.disabled).not.toBe(true);
    await renderer.act(async () => button.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wardrobe/[section]',
      params: { section: 'favorites' },
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
  it('replaces onboarding with actual clothes and restores it after the last removal', async () => {
    const item: WardrobeItem = {
      id: 'owned-1',
      title: 'Kendi gömleğim',
      category: 'upper_body',
      brand: '',
      imageUrl: 'file:///wardrobe/owned.jpg',
      createdAt: '2026-09-28',
    };
    await renderer.act(async () => {
      view.unmount();
      mockState.wardrobeItems = [item];
      view = renderer.create(createElement(LikedScreen));
    });
    expect(
      view.root.findAllByProps({ children: 'Dolabını oluşturmaya başla' }),
    ).toHaveLength(0);
    expect(
      view.root.findByProps({
        accessibilityLabel: `${item.title} ürün görseli`,
      }).props.source.uri,
    ).toBe(item.imageUrl);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderer.act(async () =>
      view.root
        .findByProps({ accessibilityLabel: `${item.title} seçenekleri` })
        .props.onPress(),
    );
    await renderer.act(async () =>
      alert.mock.lastCall?.[2]
        ?.find((option) => option.text === 'Sil')
        ?.onPress?.(),
    );
    expect(mockRemoveClothes).toHaveBeenCalledWith(item.id);
    expect(mockRemove).not.toHaveBeenCalled();
    await renderer.act(async () => {
      view.unmount();
      mockState.wardrobeItems = [];
      view = renderer.create(createElement(LikedScreen));
    });
    expect(
      view.root.findByProps({ children: 'Dolabını oluşturmaya başla' }),
    ).toBeDefined();
  });
  it('continues actual clothes in three columns with the fourth add card and Favorites card geometry', async () => {
    const items: WardrobeItem[] = Array.from({ length: 6 }, (_, index) => ({
      id: `owned-${index}`,
      title: `Kıyafet ${index}`,
      category: 'upper_body',
      brand: '',
      imageUrl: `file:///wardrobe/${index}.jpg`,
      createdAt: '2026-09-28',
    }));
    await renderer.act(async () => {
      view.unmount();
      mockState.wardrobeItems = items;
      view = renderer.create(createElement(LikedScreen));
    });
    const grid = view.root.findByType(FlatList);
    expect(grid.props.numColumns).toBe(3);
    expect(grid.props.data).toHaveLength(7);
    expect(grid.props.data[3]).toBeNull();
    expect(
      grid.props.data.map((entry) =>
        entry && typeof entry !== 'string' ? entry.product.id : null,
      ),
    ).toEqual([
      'owned-0',
      'owned-1',
      'owned-2',
      null,
      'owned-3',
      'owned-4',
      'owned-5',
    ]);
    const cards = view.root.findAllByType(DolapProductCard);
    const favorite = cards.find((card) => card.props.favorite);
    expect(favorite).toBeDefined();
    const ownedCards = cards.filter((card) => card.props.wardrobe);
    expect(ownedCards).toHaveLength(6);
    for (const card of ownedCards) {
      expect(card.props.width).toBe(favorite?.props.width);
      expect(card.props.imageHeight).toBe(favorite?.props.imageHeight);
      expect(card.props.matchFavoriteLayout).toBe(true);
    }
    expect(
      view.root.findByProps({ accessibilityLabel: 'Kıyafet 0 ürün görseli' })
        .props.contentFit,
    ).toBe('cover');
    await renderer.act(async () =>
      view.root
        .findByProps({ accessibilityLabel: 'Kıyafet 0 kombinle' })
        .props.onPress(),
    );
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/wardrobe/create',
      params: { wardrobeItemId: 'owned-0', source: 'wardrobe' },
    });
    expect(
      view.root.findAllByProps({ children: 'Dolabını oluşturmaya başla' }),
    ).toHaveLength(0);
  });
  it('retains the existing filter action without changing favorites', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const before = [...mockState.likedProducts];
    await renderer.act(async () =>
      view.root
        .findByProps({ accessibilityLabel: 'Dolabı filtrele' })
        .props.onPress(),
    );
    expect(alert.mock.lastCall?.[0]).toBe('Markaya göre filtrele');
    await renderer.act(async () =>
      alert.mock.lastCall?.[2]
        ?.find((option) => option.text === 'Tüm markalar')
        ?.onPress?.(),
    );
    expect(mockState.likedProducts).toEqual(before);
  });
  it('retains removal and undo through existing wardrobe actions', async () => {
    const product = mockState.likedProducts[0].product;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderer.act(async () =>
      view.root
        .findByProps({ accessibilityLabel: `${product.title} seçenekleri` })
        .props.onPress(),
    );
    await renderer.act(async () =>
      alert.mock.lastCall?.[2]
        ?.find((option) => option.text === 'Sil')
        ?.onPress?.(),
    );
    expect(mockRemove).toHaveBeenCalledWith(product.id);
    await renderer.act(async () =>
      view.root.findByProps({ accessibilityLabel: 'Geri al' }).props.onPress(),
    );
    expect(mockState.swipeRight).toHaveBeenCalledWith(product);
  });
  it('still opens virtual try-on from the garment card', async () => {
    const product = mockState.likedProducts[0].product;
    await renderer.act(async () =>
      view.root
        .findByProps({ accessibilityLabel: `${product.title} tekrar dene` })
        .props.onPress(),
    );
    expect(view.root.findByProps({ visible: true }).props.product).toEqual(
      product,
    );
  });
  it('retains the left-swipe removal threshold', async () => {
    const gesture = mockGestures[0];
    await renderer.act(async () => {
      gesture.update?.({ translationX: -71 });
      gesture.end?.();
    });
    expect(mockRemove).not.toHaveBeenCalled();
    await renderer.act(async () => {
      gesture.update?.({ translationX: -72 });
      gesture.end?.();
    });
    expect(mockRemove).toHaveBeenCalledWith(
      mockState.likedProducts[0].product.id,
    );
  });
});
