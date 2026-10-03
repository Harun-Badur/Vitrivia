import { createElement, type ElementType, type ReactElement } from 'react';
import { Alert } from 'react-native';
import CreateOutfitScreen from '../app/wardrobe/create';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import type { Product, LikedProduct } from '../types/product';
import type { WardrobeItem } from '../types/wardrobe';
import type { OutfitSelection } from '../lib/outfitSelection';

interface Node {
  props: {
    onPress: () => void;
    disabled?: boolean;
    snapToInterval: number;
    horizontal: boolean;
    decelerationRate: string;
    disableIntervalMomentum: boolean;
    accessibilityState: { selected?: boolean; disabled?: boolean };
    onMomentumScrollEnd: (event: {
      nativeEvent: { contentOffset: { x: number } };
    }) => void;
  };
}
interface Tree {
  root: {
    findByProps: (props: Record<string, unknown>) => Node;
    findAllByProps: (props: Record<string, unknown>) => Node[];
    findByType: (type: ElementType) => Node;
  };
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
const product = (id: string, category: Product['category']): Product => ({
  ...MOCK_PRODUCTS[0],
  id,
  title: id,
  category,
  gender: 'unisex',
});
const top1 = product('top1', 'upper_body');
const top2 = product('top2', 'upper_body');
const bottom = product('bottom', 'lower_body');
const mockFetch = jest.fn().mockResolvedValue([top1, top2, bottom]);
const mockReplace = jest.fn();
let mockParams: { productId?: string; wardrobeItemId?: string };
const mockState = {
  wardrobeItems: [] as WardrobeItem[],
  likedProducts: [] as LikedProduct[],
  currentProducts: [top1, top2, bottom],
  wardrobeStatus: 'ready',
  createOutfit: jest
    .fn<Promise<void>, [OutfitSelection]>()
    .mockResolvedValue(undefined),
  swipeRight: jest.fn(),
  unlikeProduct: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock('../services/productService', () => ({
  fetchRecommendationCatalog: () => mockFetch(),
}));
jest.mock('../services/deeplinkService', () => ({
  openProductPage: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: 'StackScreen' },
  router: {
    canGoBack: () => true,
    back: jest.fn(),
    push: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16 }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('lucide-react-native', () => ({
  ChevronLeft: () => null,
  Heart: () => null,
  MoreVertical: () => null,
  Plus: () => null,
  SlidersHorizontal: () => null,
  Sparkles: () => null,
  Trash2: () => null,
  X: () => null,
}));

describe('Kombin Oluştur screen', () => {
  let tree: Tree;
  const press = async (label: string): Promise<void> => {
    await renderer.act(async () =>
      tree.root.findByProps({ accessibilityLabel: label }).props.onPress(),
    );
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    mockParams = {};
    mockState.wardrobeItems = [];
    mockState.likedProducts = [];
    mockState.createOutfit.mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderer.act(async () => {
      tree = renderer.create(createElement(CreateOutfitScreen));
    });
  });
  afterEach(async () => {
    await renderer.act(async () => tree.unmount());
    jest.restoreAllMocks();
  });
  it('uses swipe snapping and four empty slots without carousel arrows or piece-count controls', () => {
    const carousel = tree.root.findByProps({
      accessibilityLabel: 'Kombin ürün carousel’i',
    });
    expect(carousel.props.horizontal).toBe(true);
    expect(carousel.props.decelerationRate).toBe('fast');
    expect(carousel.props.disableIntervalMomentum).toBe(true);
    expect(carousel.props.snapToInterval).toBeGreaterThan(0);
    for (const label of ['Üst', 'Alt', 'Ayakkabı', 'Aksesuar'])
      expect(
        tree.root.findByProps({ accessibilityLabel: `${label} slotu` }),
      ).toBeDefined();
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Kombini Oluştur' }).props
        .disabled,
    ).toBe(true);
    expect(
      tree.root.findAllByProps({ children: 'Kaç parça ile kombinleyelim?' }),
    ).toHaveLength(0);
    for (const label of [
      'Önceki ürün',
      'Sonraki ürün',
      '2 parça',
      '3 parça',
      '4 parça',
    ])
      expect(
        tree.root.findAllByProps({ accessibilityLabel: label }),
      ).toHaveLength(0);
  });
  it('selects the centered snapped product, changes categories from empty slots and saves the exact selection', async () => {
    const carousel = tree.root.findByProps({
      accessibilityLabel: 'Kombin ürün carousel’i',
    });
    await renderer.act(async () =>
      carousel.props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: carousel.props.snapToInterval } },
      }),
    );
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Üst parçasını kaldır' }),
    ).toBeDefined();
    await press('Alt slotu');
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Alt parçaları' }).props
        .accessibilityState.selected,
    ).toBe(true);
    await press('bottom seç');
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Kombini Oluştur' }).props
        .disabled,
    ).toBe(false);
    await press('Kombini Oluştur');
    const chosen = mockState.createOutfit.mock.lastCall?.[0];
    expect(chosen?.upper_body?.item.id).toBe('top2');
    expect(chosen?.lower_body?.item.id).toBe('bottom');
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/wardrobe/[section]',
      params: { section: 'outfits' },
    });
  });
  it('removes pieces with X, clears all and never creates an incomplete outfit', async () => {
    await press('top1 seç');
    await press('Alt slotu');
    await press('bottom seç');
    await press('Üst parçasını kaldır');
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'Üst parçasını kaldır' }),
    ).toHaveLength(0);
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Kombini Oluştur' }).props
        .disabled,
    ).toBe(true);
    await press('Tümünü temizle');
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'Alt parçasını kaldır' }),
    ).toHaveLength(0);
    expect(mockState.createOutfit).not.toHaveBeenCalled();
  });
  it('restores an incoming wardrobe selection without treating it as a catalog favorite', async () => {
    await renderer.act(async () => {
      tree.unmount();
      mockParams = { wardrobeItemId: 'owned' };
      mockState.wardrobeItems = [
        {
          id: 'owned',
          title: 'Gömleğim',
          category: 'upper_body',
          imageUrl: 'file:///owned.jpg',
          brand: '',
          createdAt: '2026-09-28',
        },
      ];
      tree = renderer.create(createElement(CreateOutfitScreen));
    });
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Üst parçasını kaldır' }),
    ).toBeDefined();
    await press('Alt slotu');
    await press('bottom seç');
    await press('Kombini Oluştur');
    expect(mockState.createOutfit.mock.lastCall?.[0].upper_body?.source).toBe(
      'wardrobe',
    );
  });
  it('retains favorites actions and keeps selection available after a failed save', async () => {
    await press('top1 favori');
    expect(mockState.swipeRight).toHaveBeenCalledWith(top1);
    await press('top1 seç');
    await press('Alt slotu');
    await press('bottom seç');
    mockState.createOutfit.mockRejectedValueOnce(new Error('disk full'));
    await press('Kombini Oluştur');
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Kombin oluşturulamadı',
      'disk full',
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Kombini Oluştur' }).props
        .disabled,
    ).toBe(false);
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Üst parçasını kaldır' }),
    ).toBeDefined();
  });
});
