import { createElement, type ElementType, type ReactElement } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import DiscoverRecommendations, {
  complementaryProductsForDisplay,
} from '../components/DiscoverRecommendations';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import {
  getProductImages,
  type Product,
  type OutfitRole,
} from '../types/product';

let mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockDimensions,
}));
jest.mock('lucide-react-native', () => ({ Check: 'Check', Heart: 'Heart' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/DiscoverProductImage', () => 'DiscoverProductImage');

interface TestNode {
  props: Record<string, unknown>;
  parent: TestNode | null;
  findByProps: (props: Record<string, unknown>) => TestNode;
  findAllByType: (type: ElementType | string) => TestNode[];
}
interface TestTree {
  root: TestNode;
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  act: (callback: () => void) => Promise<void>;
  create: (element: ReactElement) => TestTree;
};
const style = (node: TestNode): ViewStyle =>
  StyleSheet.flatten(node.props.style as ViewStyle) ?? {};

const product = (id: string, role: OutfitRole, brand: string): Product => ({
  id,
  brand,
  title: `${brand} ürün adı`,
  price: 1299.9,
  imageUrl: `https://example.com/${id}.jpg`,
  category:
    role === 'bottom'
      ? 'lower_body'
      : role === 'shoes'
        ? 'shoes'
        : 'upper_body',
  outfitRole: role,
  garmentDescription: id,
});
const top = product('top', 'top', 'AVVA');
const bottom = product('bottom', 'bottom', 'Çok uzun bir mağaza ve marka adı');
const jacket = product('jacket', 'outerwear', 'Mavi');
const shoes = product('shoes', 'shoes', 'Lumberjack');
const recommendations = getDiscoverRecommendations({
  wardrobeItems: [],
  catalogProducts: [top, bottom, jacket, shoes],
  requiredCatalogProductId: top.id,
  firstOnly: true,
});
const displayed = complementaryProductsForDisplay(recommendations, top.id);

describe('Discover recommendation UI geometry', () => {
  let tree: TestTree;
  const onSelectProduct = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(async () => {
    if (tree) await renderer.act(() => tree.unmount());
  });
  const mount = async (): Promise<void> => {
    await renderer.act(() => {
      tree = renderer.create(
        createElement(DiscoverRecommendations, {
          currentProductId: top.id,
          recommendations,
          onSelectProduct,
          selectedProductIds: [bottom.id],
        }),
      );
    });
  };

  it.each([
    [320, 640],
    [360, 800],
    [390, 844],
    [430, 932],
  ])(
    'keeps three equal card columns and equal image/info areas at %i × %i',
    async (width, height) => {
      mockDimensions = { width, height, scale: 3, fontScale: 1 };
      await mount();
      expect(displayed).toHaveLength(3);
      const cards = displayed.map((entry) =>
        tree.root.findByProps({
          testID: `discover-recommendation-card-${entry.id}`,
        }),
      );
      const images = displayed.map((entry) =>
        tree.root.findByProps({
          testID: `discover-recommendation-image-${entry.id}`,
        }),
      );
      const infos = displayed.map((entry) =>
        tree.root.findByProps({
          testID: `discover-recommendation-info-${entry.id}`,
        }),
      );
      expect(images.map((node) => style(node).height)).toEqual(
        Array(3).fill(style(images[0]).height),
      );
      expect(infos.map((node) => style(node).height)).toEqual(
        Array(3).fill(style(infos[0]).height),
      );
      expect(Number(style(images[0]).height)).toBeGreaterThan(0);
      expect(Number(style(infos[0]).height)).toBeGreaterThan(0);
      for (const card of cards) {
        const column = card.parent;
        if (!column) throw new Error('Missing card column');
        expect(style(column).flex).toBe(1);
        expect(style(column).minWidth).toBe(0);
      }
      expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
      const row = tree.root
        .findAllByType(View)
        .find((node) => style(node).alignItems === 'stretch');
      expect(row && style(row).flexDirection).toBe('row');
    },
  );

  it('keeps brand/price together, category below, and constrains long labels', async () => {
    await mount();
    for (const entry of displayed) {
      const info = tree.root.findByProps({
        testID: `discover-recommendation-info-${entry.id}`,
      });
      const row = info
        .findAllByType(View)
        .find((node) => style(node).flexDirection === 'row');
      if (!row) throw new Error('Missing brand/price row');
      const rowTexts = row.findAllByType(Text);
      expect(rowTexts).toHaveLength(2);
      expect(rowTexts[0].props.children).toBe(entry.brand);
      expect(rowTexts[0].props.numberOfLines).toBe(1);
      expect(rowTexts[0].props.ellipsizeMode).toBe('tail');
      const infoTexts = info.findAllByType(Text);
      expect(infoTexts).toHaveLength(3);
      expect(infoTexts[2].props.children).toBe(
        entry.subcategory ?? entry.title,
      );
      expect(infoTexts[2].props.numberOfLines).toBe(1);
      expect(infoTexts[2].props.ellipsizeMode).toBe('tail');
    }
  });

  it('preserves image URLs and passes selection/check state and callbacks to floating controls', async () => {
    await mount();
    const images = tree.root.findAllByType('DiscoverProductImage');
    expect(images.map((node) => node.props.uri)).toEqual(
      displayed.map((entry) => getProductImages(entry)[0]),
    );
    expect(images.every((node) => node.props.slot === 'recommendation')).toBe(
      true,
    );
    const buttons = tree.root.findAllByType('PressableScale');
    expect(buttons).toHaveLength(3);
    expect(
      buttons.every((node) => node.props.accessibilityRole === 'checkbox'),
    ).toBe(true);
    for (let index = 0; index < buttons.length; index++) {
      expect(buttons[index].props.accessibilityState).toEqual({
        checked: displayed[index].id === bottom.id,
      });
      expect(style(buttons[index]).position).toBe('absolute');
      await renderer.act(() => (buttons[index].props.onPress as () => void)());
      expect(onSelectProduct).toHaveBeenLastCalledWith(displayed[index]);
    }
    expect(
      tree.root
        .findAllByType(Text)
        .some((node) => node.props.children === 'Tümünü Gör'),
    ).toBe(false);
  });
});
