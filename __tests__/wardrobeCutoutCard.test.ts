import { createElement, type ReactElement } from 'react';
import { DolapProductCard } from '../app/(tabs)/liked';
import { wardrobeProduct, type WardrobeItem } from '../types/wardrobe';
import type { Product } from '../types/product';

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  View: 'View',
  Text: 'Text',
  FlatList: 'FlatList',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 400, height: 800 }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-router', () => ({ router: {}, useFocusEffect: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/OutfitCover', () => 'OutfitCover');
jest.mock('../assets/wardrobe-onboarding.png', () => 1);
jest.mock('../store/useAppStore', () => ({ useAppStore: jest.fn() }));
jest.mock('../services/deeplinkService', () => ({
  openProductPage: jest.fn(),
}));
jest.mock('../lib/dolapNavigation', () => ({
  openOutfitCreator: jest.fn(),
  openWardrobeEditor: jest.fn(),
  openWardrobeList: jest.fn(),
}));
jest.mock('lucide-react-native', () => ({
  ChevronRight: () => null,
  Heart: () => null,
  Shirt: () => null,
  Layers: () => null,
  MoreVertical: () => null,
  Plus: () => null,
  Search: () => null,
  SlidersHorizontal: () => null,
  Trash2: () => null,
  X: () => null,
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: 'GestureDetector',
  Gesture: {
    Pan: () => {
      const chain = {
        enabled: () => chain,
        activeOffsetX: () => chain,
        failOffsetY: () => chain,
        onUpdate: () => chain,
        onEnd: () => chain,
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
  runOnJS: (fn: unknown) => fn,
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useSharedValue: (value: number) => {
    const React = jest.requireActual<typeof import('react')>('react');
    return React.useRef({ value }).current;
  },
  withSpring: (value: number) => value,
  withTiming: (value: number) => value,
}));

interface ImageNode {
  props: { source: { uri: string }; onError: () => void };
}
interface Tree {
  root: {
    findByType: (type: string) => ImageNode;
    findAllByType: (type: string) => ImageNode[];
  };
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => Tree;
  act: (callback: () => void) => Promise<void>;
};
const owned: WardrobeItem = {
  id: 'owned-shirt',
  title: 'Gömleğim',
  category: 'upper_body',
  brand: '',
  imageUrl: 'file:///original.jpg',
  createdAt: '2026-09-30',
};
const element = (product: Product, wardrobe = true) =>
  createElement(DolapProductCard, {
    item: { product, likedAt: owned.createdAt, notifyOnPriceDrop: false },
    wardrobe,
    favorite: !wardrobe,
    width: 112,
    onTryOn: jest.fn(),
    onOpenStore: jest.fn(),
    onSwipeDelete: jest.fn(),
    onCombine: jest.fn(),
  });

describe('owned clothes use the existing cutout source in Dolap cards', () => {
  let tree: Tree;
  const uri = () => tree.root.findByType('Image').props.source.uri;
  const fail = () =>
    renderer.act(() => tree.root.findByType('Image').props.onError());
  afterEach(async () => {
    await renderer.act(() => tree.unmount());
  });

  it('prefers Storage cutout, then cached cutout, then the original on image errors', async () => {
    await renderer.act(() => {
      tree = renderer.create(
        element(
          wardrobeProduct({
            ...owned,
            cutoutUrl: 'https://storage/cutout.png?token=signed',
            cutoutLocalUri: 'file:///cutout.png',
            images: ['https://old/original-gallery.jpg'],
          } as WardrobeItem),
        ),
      );
    });
    expect(uri()).toBe('https://storage/cutout.png?token=signed');
    await fail();
    expect(uri()).toBe('file:///cutout.png');
    await fail();
    expect(uri()).toBe(owned.imageUrl);
  });

  it('shows a newly available cutout after the original had failed to load', async () => {
    await renderer.act(() => {
      tree = renderer.create(element(wardrobeProduct(owned)));
    });
    expect(uri()).toBe(owned.imageUrl);
    await fail();
    expect(tree.root.findAllByType('Image')).toHaveLength(0);
    await renderer.act(() => {
      tree.update(
        element(
          wardrobeProduct({
            ...owned,
            cutoutUrl: 'https://storage/new-cutout.png',
          }),
        ),
      );
    });
    expect(uri()).toBe('https://storage/new-cutout.png');
  });

  it('retains favorites gallery order and existing image-error behavior', async () => {
    const favorite = {
      ...wardrobeProduct(owned),
      images: ['https://catalog/first.jpg', 'https://catalog/second.jpg'],
    };
    await renderer.act(() => {
      tree = renderer.create(element(favorite, false));
    });
    expect(uri()).toBe('https://catalog/first.jpg');
    await fail();
    expect(tree.root.findAllByType('Image')).toHaveLength(0);
  });
});
