import { createElement, type ElementType, type ReactElement } from 'react';
import { StyleSheet, Text, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { withSpring } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import SwipeCard, { type SwipeCardProps } from '../components/SwipeCard';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { formatTryPrice, type Product, type OutfitRole } from '../types/product';

jest.mock('react-native', () => {
  const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten)) : typeof style === 'object' && style !== null ? style as Record<string, unknown> : {};
  return {
    ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', Text: 'Text', View: 'View',
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    StyleSheet: { create: (styles: unknown) => styles, flatten, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {} },
  };
});

jest.mock('lucide-react-native', () => ({
  ChevronRight: 'ChevronRight', Heart: 'Heart', Maximize: 'Maximize',
  ShoppingBag: 'ShoppingBag', Sparkles: 'Sparkles', X: 'X', Check: 'Check',
}));
jest.mock('expo-image', () => ({ Image: Object.assign((props: Record<string, unknown>) =>
  jest.requireActual<typeof import('react')>('react').createElement('Image', props), {
  prefetch: jest.fn(), getCachePathAsync: jest.fn().mockResolvedValue(null),
}) }));
jest.mock('../components/PressableScale', () => 'PressableScale');
const mockImageRenders = jest.fn();
const mockImageMounts = jest.fn();
const mockImageUnmounts = jest.fn();
jest.mock('../components/DiscoverProductImage', () => ({
  __esModule: true,
  default: (props: { uri: string; slot: string }) => {
    const react = jest.requireActual<typeof import('react')>('react');
    mockImageRenders(props.slot, props.uri);
    react.useEffect(() => {
      mockImageMounts(props.slot, props.uri);
      return () => { mockImageUnmounts(props.slot, props.uri); };
    }, [props.slot, props.uri]);
    return react.createElement('DiscoverProductImage', props);
  },
}));
jest.mock('react-native-gesture-handler', () => {
  const builder = (): Record<string, jest.Mock> => {
    const chain: Record<string, jest.Mock> = {};
    for (const method of ['enabled', 'activeOffsetY', 'failOffsetX', 'onUpdate', 'onEnd',
      'numberOfTaps', 'maxDuration', 'maxDistance', 'blocksExternalGesture', 'minPointers', 'activeOffsetX', 'failOffsetY']) {
      chain[method] = jest.fn(() => chain);
    }
    return chain;
  };
  return { GestureDetector: 'GestureDetector', Gesture: {
    Pan: builder, Tap: builder, Native: builder, Exclusive: jest.fn(),
  } };
});
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  useSharedValue: (value: number | boolean) => jest.requireActual<typeof import('react')>('react').useRef({ value }).current,
  useAnimatedStyle: (factory: () => Record<string, unknown>) => ({ get current() { return factory(); } }),
  cancelAnimation: jest.fn(), runOnJS: (callback: () => void) => callback,
  runOnUI: (callback: () => void) => callback,
  withTiming: jest.fn(), withSpring: jest.fn(), withSequence: jest.fn(),
  interpolate: jest.fn(), Extrapolation: { CLAMP: 'clamp' },
}));

interface TestNode {
  props: Record<string, unknown>;
  parent: TestNode | null;
  findByProps: (props: Record<string, unknown>) => TestNode;
  findByType: (type: ElementType | string) => TestNode;
  findAllByType: (type: ElementType | string) => TestNode[];
}
const renderer = jest.requireActual('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: ReactElement) => { root: TestNode; update: (element: ReactElement) => void; unmount: () => void };
};
const product = (id: string, role: OutfitRole): Product => ({
  id, title: id, brand: 'Example', price: 1000, imageUrl: `https://example.com/${id}.jpg`,
  category: role === 'bottom' ? 'lower_body' : role === 'shoes' ? 'shoes' : 'upper_body',
  outfitRole: role, gender: 'women', garmentDescription: id,
});

describe('SwipeCard exit animation ownership', () => {
  let tree: ReturnType<typeof renderer.create>;
  let props: SwipeCardProps;
  const pan = () => {
    const calls = jest.mocked(Gesture.Exclusive).mock.calls;
    return calls[calls.length - 1][1] as unknown as { onEnd: jest.Mock; onUpdate: jest.Mock };
  };
  const end = (direction: 'pass' | 'undo') => pan().onEnd.mock.calls[0][0]({
    translationY: direction === 'pass' ? -200 : 200, velocityY: 0,
  });
  const callback = () => {
    const calls = jest.mocked(withSpring).mock.calls;
    return calls[calls.length - 1][2]!;
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    props = {
      product: product('gesture-anchor', 'top'), pageIndex: 0, canUndo: true,
      pageHeight: { value: 700 } as SharedValue<number>, dragOffset: { value: 0 } as SharedValue<number>,
      onAddToCloset: jest.fn(), onPass: jest.fn(), onUndoPass: jest.fn(),
      onVirtualTryOn: jest.fn(), onBuy: jest.fn(), onImpression: jest.fn(),
    };
    await renderer.act(async () => { tree = renderer.create(createElement(SwipeCard, props)); });
  });
  afterEach(async () => { await renderer.act(() => tree.unmount()); });

  it.each(['pass', 'undo'] as const)('commits a completed %s once and retains its lock until rollover', async direction => {
    await renderer.act(() => { end(direction); });
    expect(withSpring).toHaveBeenLastCalledWith(direction === 'pass' ? -700 : 700, expect.any(Object), expect.any(Function));
    expect(props.onPass).not.toHaveBeenCalled();
    expect(props.onUndoPass).not.toHaveBeenCalled();
    await renderer.act(() => { callback()(true); });
    expect(direction === 'pass' ? props.onPass : props.onUndoPass).toHaveBeenCalledTimes(1);
    expect(direction === 'pass' ? props.onUndoPass : props.onPass).not.toHaveBeenCalled();
    await renderer.act(() => { end(direction); });
    expect(withSpring).toHaveBeenCalledTimes(1);
  });

  it.each(['pass', 'undo'] as const)('does not commit a cancelled %s and accepts another swipe', async direction => {
    await renderer.act(() => { end(direction); });
    await renderer.act(() => { callback()(false); });
    expect(props.onPass).not.toHaveBeenCalled();
    expect(props.onUndoPass).not.toHaveBeenCalled();
    await renderer.act(() => { pan().onUpdate.mock.calls[0][0]({ translationY: -80 }); });
    expect(props.dragOffset.value).toBe(-80);
    await renderer.act(() => { end('pass'); });
    expect(withSpring).toHaveBeenCalledTimes(2);
    await renderer.act(() => { callback()(true); });
    expect(props.onPass).toHaveBeenCalledTimes(1);
  });

  it('ignores a cancelled old callback after a newer gesture takes ownership', async () => {
    await renderer.act(() => { end('pass'); });
    const oldCallback = callback();
    await renderer.act(() => { oldCallback(false); end('undo'); });
    const newCallback = callback();
    await renderer.act(() => { oldCallback(false); oldCallback(true); });
    // Neither unlock the new exit nor dispatch the stale pass.
    await renderer.act(() => { end('pass'); });
    expect(withSpring).toHaveBeenCalledTimes(2);
    expect(props.onPass).not.toHaveBeenCalled();
    await renderer.act(() => { newCallback(true); });
    expect(props.onUndoPass).toHaveBeenCalledTimes(1);
  });

  it('invalidates an old exit when the card rolls away and becomes active again', async () => {
    await renderer.act(() => { end('pass'); });
    const oldCallback = callback();
    await renderer.act(() => { tree.update(createElement(SwipeCard, { ...props, pageIndex: 1 })); });
    await renderer.act(() => { tree.update(createElement(SwipeCard, props)); });
    await renderer.act(() => { end('undo'); });
    const newCallback = callback();
    await renderer.act(() => { oldCallback(false); oldCallback(true); end('pass'); });
    expect(withSpring).toHaveBeenCalledTimes(2);
    expect(props.onPass).not.toHaveBeenCalled();
    await renderer.act(() => { newCallback(true); });
    expect(props.onUndoPass).toHaveBeenCalledTimes(1);
  });
});

describe('Discover product block motion', () => {
  let tree: ReturnType<typeof renderer.create>;
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(async () => { if (tree) await renderer.act(() => tree.unmount()); });

  it('loads only the selected gallery image on a neighboring card and adjacent images when active', async () => {
    const anchor = { ...product('gallery-budget', 'top'),
      images: Array.from({ length: 8 }, (_, index) => `https://example.com/gallery-${index}.jpg`) };
    const props: SwipeCardProps = {
      product: anchor, pageIndex: 1,
      pageHeight: { value: 700 } as SharedValue<number>, dragOffset: { value: 0 } as SharedValue<number>,
      onAddToCloset: jest.fn(), onPass: jest.fn(), onVirtualTryOn: jest.fn(), onBuy: jest.fn(), onImpression: jest.fn(),
    };
    await renderer.act(async () => { tree = renderer.create(createElement(SwipeCard, props)); });
    const mainImages = () => tree.root.findAllByType('DiscoverProductImage').filter(node => node.props.slot === 'main');
    expect(mainImages().map(node => node.props.uri)).toEqual(anchor.images.slice(0, 1));
    await renderer.act(async () => { tree.update(createElement(SwipeCard, { ...props, pageIndex: 0 })); });
    expect(mainImages().map(node => node.props.uri)).toEqual(anchor.images.slice(0, 2));
    const pager = tree.root.findByProps({ accessibilityLabel: 'Ürün görselleri' });
    const gesture = pager.parent?.props.gesture as { onEnd: jest.Mock };
    await renderer.act(async () => { gesture.onEnd.mock.calls[0][0]({ translationX: -200, velocityX: -900 }); });
    expect(mainImages().map(node => node.props.uri)).toEqual(anchor.images.slice(0, 3));
  });

  it('moves main image, product information, both CTAs and the recommendation section with one pose', async () => {
    const anchor = product('anchor', 'top');
    const recommendations = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [anchor,
      product('bottom', 'bottom'), product('shoes', 'shoes'), product('coat', 'outerwear')],
    requiredCatalogProductId: anchor.id, firstOnly: true });
    const pageHeight = { value: 700 } as SharedValue<number>;
    const dragOffset = { value: 0 } as SharedValue<number>;
    let pageIndex: SharedValue<number> | undefined;
    await renderer.act(async () => {
      tree = renderer.create(createElement(SwipeCard, {
        product: anchor, pageIndex: 0, pageHeight, dragOffset, recommendations,
        registerPageIndexSV: (_id, value) => { pageIndex = value; },
        onAddToCloset: jest.fn(), onPass: jest.fn(), onVirtualTryOn: jest.fn(),
        onBuy: jest.fn(), onImpression: jest.fn(),
      }));
      await Promise.resolve();
    });
    const slot = tree.root.findAllByType('AnimatedView').find(node =>
      node.props.collapsable === false && node.props.pointerEvents === 'auto');
    expect(slot).toBeDefined();
    const belongsToSlot = (node: TestNode): boolean => {
      for (let parent: TestNode | null = node; parent; parent = parent.parent) if (parent === slot) return true;
      return false;
    };
    const members = [tree.root.findByProps({ slot: 'main' }),
      tree.root.findByProps({ accessibilityLabel: 'Dene' }),
      tree.root.findByProps({ accessibilityLabel: 'Mağazaya git' }),
      tree.root.findByProps({ accessibilityLabel: `${anchor.brand} ${anchor.title}, ${formatTryPrice(anchor.price)}` }),
      tree.root.findByProps({ testID: 'discover-recommendation-card-bottom' })];
    members.forEach(node => expect(belongsToSlot(node)).toBe(true));
    expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Tarzını tamamlayan parçalar')).toBe(true);
    for (const offset of [0, -80, -350, -700, 80, 350, 700]) {
      dragOffset.value = offset;
      const pose = (slot?.props.style as { current: { transform: { translateY: number }[] } }[])[2].current;
      expect(pose.transform).toEqual([{ translateY: offset }]);
    }
    if (pageIndex) pageIndex.value = 1;
    dragOffset.value = -700;
    const pose = (slot?.props.style as { current: { transform: { translateY: number }[] } }[])[2].current;
    expect(pose.transform).toEqual([{ translateY: 0 }]);
    const mainStyle = StyleSheet.flatten(members[3].props.style as ViewStyle);
    expect(mainStyle).toMatchObject({ flex: 1, height: 'auto', width: '100%' });
  });

  it('keeps all three already mounted recommendation cards and images when next becomes current', async () => {
    const anchor = product('next', 'top');
    const recommendations = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [anchor,
      product('bottom', 'bottom'), product('shoes', 'shoes'), product('coat', 'outerwear')],
    requiredCatalogProductId: anchor.id, firstOnly: true });
    const props: SwipeCardProps = {
      product: anchor, pageIndex: 1, recommendations,
      pageHeight: { value: 700 } as SharedValue<number>, dragOffset: { value: 0 } as SharedValue<number>,
      onAddToCloset: jest.fn(), onPass: jest.fn(), onVirtualTryOn: jest.fn(), onBuy: jest.fn(), onImpression: jest.fn(),
    };
    await renderer.act(async () => {
      tree = renderer.create(createElement(SwipeCard, props));
      await Promise.resolve();
    });
    const ids = ['bottom', 'shoes', 'coat'];
    const cards = ids.map(id => tree.root.findByProps({ testID: `discover-recommendation-card-${id}` }));
    const beforeRenders = mockImageRenders.mock.calls.filter(([slot]) => slot === 'recommendation').length;
    expect(beforeRenders).toBe(3);
    expect(mockImageMounts.mock.calls.filter(([slot]) => slot === 'recommendation')).toHaveLength(3);
    await renderer.act(async () => {
      tree.update(createElement(SwipeCard, { ...props, pageIndex: 0 }));
      await Promise.resolve();
    });
    ids.forEach((id, index) => expect(tree.root.findByProps({ testID: `discover-recommendation-card-${id}` })).toBe(cards[index]));
    expect(mockImageRenders.mock.calls.filter(([slot]) => slot === 'recommendation')).toHaveLength(beforeRenders);
    expect(mockImageMounts.mock.calls.filter(([slot]) => slot === 'recommendation')).toHaveLength(3);
    expect(mockImageUnmounts.mock.calls.filter(([slot]) => slot === 'recommendation')).toHaveLength(0);
  });
});
