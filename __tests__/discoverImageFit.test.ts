import { createElement, type ElementType, type ReactElement } from 'react';
import {
  StyleSheet,
  View,
  type ImageStyle,
  type LayoutChangeEvent,
  type StyleProp,
} from 'react-native';
import type { ImageLoadEventData } from 'expo-image';
import DiscoverProductImage from '../components/DiscoverProductImage';
import {
  DISCOVER_MAIN_IMAGE_RATIO,
  DISCOVER_RECOMMENDATION_IMAGE_RATIO,
  getDiscoverImageFit,
  type DiscoverImageSlot,
} from '../lib/discoverImageFit';

jest.mock('expo-image', () => ({ Image: 'Image' }));

const ratios = [4 / 5, 3 / 4, 2 / 3, 9 / 16, 1];
const slots: DiscoverImageSlot[] = ['main', 'recommendation'];

describe.each(slots)('%s image fitting', (slot) => {
  const ratio =
    slot === 'main'
      ? DISCOVER_MAIN_IMAGE_RATIO
      : DISCOVER_RECOMMENDATION_IMAGE_RATIO;
  const viewport = { width: 300, height: 300 / ratio };

  it.each(ratios)(
    'fills the frame without stretching a %f aspect ratio',
    (sourceRatio) => {
      const source = { width: 1200 * sourceRatio, height: 1200 };
      const fit = getDiscoverImageFit(source, viewport, slot);
      expect(fit).not.toBeNull();
      if (!fit) return;
      expect(fit.width / fit.height).toBeCloseTo(sourceRatio, 10);
      expect(fit.width / source.width).toBeCloseTo(
        fit.height / source.height,
        10,
      );
      expect(fit.left).toBeLessThanOrEqual(0);
      expect(fit.top).toBeLessThanOrEqual(0);
      expect(fit.left + fit.width).toBeGreaterThanOrEqual(
        viewport.width - 0.001,
      );
      expect(fit.top + fit.height).toBeGreaterThanOrEqual(
        viewport.height - 0.001,
      );
      expect(fit.visibleWidthFraction).toBeGreaterThan(0.7);
      expect(fit.visibleHeightFraction).toBeGreaterThan(0.74);
    },
  );

  it('keeps head and shoe landmarks inside the crop of a centered 9:16 model fixture', () => {
    const fit = getDiscoverImageFit(
      { width: 900, height: 1600 },
      viewport,
      slot,
    );
    if (!fit) throw new Error('Missing fit');
    for (const landmarkY of [0.15, 0.85]) {
      const y = fit.top + fit.height * landmarkY;
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(viewport.height);
    }
    // Portraits use only the scale needed to fill, with no additional zoom.
    expect(fit.scale).toBeCloseTo(viewport.width / 900);
  });

  it('reduces margins on a square white-background garment fixture while retaining its body', () => {
    const fit = getDiscoverImageFit(
      { width: 1000, height: 1000 },
      viewport,
      slot,
    );
    if (!fit) throw new Error('Missing fit');
    expect(fit.scale).toBeCloseTo((viewport.height / 1000) * 1.04);
    // Synthetic garment occupies the central 60%, leaving 20% source margins.
    for (const landmark of [0.2, 0.8]) {
      expect(fit.left + fit.width * landmark).toBeGreaterThan(0);
      expect(fit.left + fit.width * landmark).toBeLessThan(viewport.width);
      expect(fit.top + fit.height * landmark).toBeGreaterThan(0);
      expect(fit.top + fit.height * landmark).toBeLessThan(viewport.height);
    }
  });

  it.each([320, 360, 390, 430])(
    'keeps the same composition at phone width %i',
    (width) => {
      const source = { width: 800, height: 1000 };
      const base = getDiscoverImageFit(source, viewport, slot);
      const resized = getDiscoverImageFit(
        source,
        { width, height: width / ratio },
        slot,
      );
      expect(resized?.visibleWidthFraction).toBeCloseTo(
        base?.visibleWidthFraction ?? 0,
      );
      expect(resized?.visibleHeightFraction).toBeCloseTo(
        base?.visibleHeightFraction ?? 0,
      );
    },
  );
});

it.each([0, -1, NaN, Infinity])(
  'rejects invalid image/viewport dimensions: %f',
  (invalid) => {
    expect(
      getDiscoverImageFit(
        { width: invalid, height: 100 },
        { width: 300, height: 400 },
        'main',
      ),
    ).toBeNull();
    expect(
      getDiscoverImageFit(
        { width: 100, height: 100 },
        { width: 300, height: invalid },
        'main',
      ),
    ).toBeNull();
  },
);

interface RenderedNode {
  props: Record<string, unknown>;
  findByType: (type: ElementType | string) => RenderedNode;
}
interface RenderedTree {
  root: RenderedNode;
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  act: (callback: () => void) => Promise<void>;
  create: (element: ReactElement) => RenderedTree;
};

describe('DiscoverProductImage native image measurements', () => {
  let tree: RenderedTree;
  const onLoad = jest.fn();
  const onError = jest.fn();
  const imageStyle = (): ImageStyle =>
    StyleSheet.flatten(
      tree.root.findByType('Image').props.style as StyleProp<ImageStyle>,
    ) ?? {};

  beforeEach(async () => {
    jest.clearAllMocks();
    await renderer.act(() => {
      tree = renderer.create(
        createElement(DiscoverProductImage, {
          uri: 'a.jpg',
          slot: 'main',
          style: { width: 300, height: 400 },
          onLoad,
          onError,
        }),
      );
    });
  });
  afterEach(async () => {
    await renderer.act(() => tree.unmount());
  });

  const layout = async (width: number, height: number): Promise<void> => {
    await renderer.act(() => {
      const callback = tree.root.findByType(View).props.onLayout as (
        event: LayoutChangeEvent,
      ) => void;
      callback({
        nativeEvent: { layout: { width, height, x: 0, y: 0 } },
      } as LayoutChangeEvent);
    });
  };
  const load = async (width: number, height: number): Promise<void> => {
    await renderer.act(() => {
      const callback = tree.root.findByType('Image').props.onLoad as (
        event: ImageLoadEventData,
      ) => void;
      callback({
        cacheType: 'memory',
        source: { url: 'a.jpg', width, height, mediaType: 'image/jpeg' },
      });
    });
  };

  it('uses source dimensions from onLoad and recalculates for viewport resize', async () => {
    await layout(300, 400);
    await load(1000, 1000);
    expect(imageStyle().width).toBeCloseTo(416);
    expect(imageStyle().height).toBeCloseTo(416);
    expect(onLoad).toHaveBeenCalledTimes(1);
    await layout(390, 520);
    expect(imageStyle().width).toBeCloseTo(540.8);
    expect(tree.root.findByType('Image').props.contentFit).toBe('cover');
    expect(tree.root.findByType('Image').props.onError).toBe(onError);
  });

  it('does not apply the previous bitmap dimensions after the URI changes', async () => {
    await layout(300, 400);
    await load(1000, 1000);
    await renderer.act(() =>
      tree.update(
        createElement(DiscoverProductImage, {
          uri: 'b.jpg',
          slot: 'main',
          style: { width: 300, height: 400 },
        }),
      ),
    );
    expect(tree.root.findByType('Image').props.source).toEqual({
      uri: 'b.jpg',
    });
    expect(imageStyle().width).toBeUndefined();
    await load(900, 1600);
    expect(imageStyle().width).toBeCloseTo(300);
    expect(imageStyle().height).toBeCloseTo(1600 / 3);
  });

  it('ignores a late load event from an image that has already been replaced', async () => {
    await layout(300, 400);
    const staleLoad = tree.root.findByType('Image').props.onLoad as (
      event: ImageLoadEventData,
    ) => void;
    await renderer.act(() =>
      tree.update(
        createElement(DiscoverProductImage, {
          uri: 'b.jpg',
          slot: 'main',
          style: { width: 300, height: 400 },
        }),
      ),
    );
    await load(900, 1600);
    const expected = imageStyle();
    await renderer.act(() =>
      staleLoad({
        cacheType: 'disk',
        source: {
          url: 'a.jpg',
          width: 1000,
          height: 1000,
          mediaType: 'image/jpeg',
        },
      }),
    );
    expect(imageStyle()).toEqual(expected);
  });
});
