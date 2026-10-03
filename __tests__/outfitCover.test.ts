import { createElement, type ReactElement } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import OutfitCover from '../components/OutfitCover';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import type { SavedOutfit, WardrobeItem } from '../types/wardrobe';
import type { OutfitCoverPart } from '../services/outfitCoverService';

interface Node {
  props: {
    source: { uri: string };
    contentFit: string;
    style: StyleProp<ViewStyle>;
  };
  children: (Node | string)[];
}
interface Tree {
  root: {
    findByProps: (props: Record<string, unknown>) => Node;
    findAllByType: (type: string) => Node[];
  };
  unmount: () => void;
}
function unwrap(node: Node): Node {
  while (node.children.length === 1 && typeof node.children[0] !== 'string') {
    node = node.children[0];
  }
  return node;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
const mockResolve = jest
  .fn<Promise<OutfitCoverPart[]>, [SavedOutfit, OutfitCoverPart[]]>()
  .mockImplementation(async (_outfit, parts) => parts);
const mockState = {
  wardrobeItems: [] as WardrobeItem[],
  likedProducts: [
    {
      product: {
        ...MOCK_PRODUCTS[0],
        id: 'catalog',
        imageUrl: 'https://example.com/catalog.jpg',
      },
    },
  ],
  currentProducts: [],
};
jest.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock('../services/outfitCoverService', () => ({
  fetchOutfitCoverParts: (outfit: SavedOutfit, parts: OutfitCoverPart[]) =>
    mockResolve(outfit, parts),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('lucide-react-native', () => ({ Shirt: () => null }));
jest.mock('../lib/logger', () => ({ logger: { warn: jest.fn() } }));

describe('outfit collage cover', () => {
  let tree: Tree;
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.wardrobeItems = [];
    mockResolve.mockImplementation(async (_outfit, parts) => parts);
  });
  afterEach(async () => {
    if (tree) await renderer.act(async () => tree.unmount());
  });
  it.each([1, 2, 3, 4])(
    'shows every owned item in a %s-piece cover without changing its height',
    async (count) => {
      mockState.wardrobeItems = Array.from({ length: count }, (_, index) => ({
        id: `owned-${index}`,
        title: `Kıyafet ${index}`,
        category: 'upper_body',
        brand: '',
        createdAt: '2026-09-28',
        imageUrl: `file:///owned-${index}.jpg`,
      }));
      const outfit: SavedOutfit = {
        id: 'local',
        title: 'Kombinim',
        wardrobeItemIds: mockState.wardrobeItems.map((item) => item.id),
        catalogProductIds: [],
        createdAt: '2026-09-28',
      };
      await renderer.act(async () => {
        tree = renderer.create(
          createElement(OutfitCover, { outfit, style: { height: 120 } }),
        );
      });
      const images = tree.root.findAllByType('Image');
      expect(images.map((image) => image.props.source.uri)).toEqual(
        mockState.wardrobeItems.map((item) => item.imageUrl),
      );
      expect(
        images.every((image) => image.props.contentFit === 'contain'),
      ).toBe(true);
      const cover = tree.root.findByProps({
        accessibilityLabel: 'Kombinim kombin cover',
      });
      expect(StyleSheet.flatten(cover.props.style).height).toBe(120);
      const layout = unwrap(cover);
      if (count === 4) {
        expect(layout.children).toHaveLength(2);
        expect(
          layout.children.every(
            (row) =>
              typeof row !== 'string' && unwrap(row).children.length === 2,
          ),
        ).toBe(true);
      }
      if (count === 3) {
        expect(layout.children).toHaveLength(2);
        expect(unwrap(layout.children[1] as Node).children).toHaveLength(2);
      }
    },
  );
  it('combines wardrobe and catalog images instead of using only the old thumbnail', async () => {
    mockState.wardrobeItems = [
      {
        id: 'owned',
        title: 'Pantolon',
        category: 'lower_body',
        brand: '',
        createdAt: '2026-09-28',
        imageUrl: 'file:///owned.jpg',
      },
    ];
    const outfit: SavedOutfit = {
      id: 'mixed',
      title: 'Karışık',
      imageUrl: 'https://example.com/top-only.jpg',
      wardrobeItemIds: ['owned'],
      catalogProductIds: ['catalog'],
      createdAt: '2026-09-28',
    };
    await renderer.act(async () => {
      tree = renderer.create(createElement(OutfitCover, { outfit }));
    });
    expect(
      tree.root.findAllByType('Image').map((image) => image.props.source.uri),
    ).toEqual(['file:///owned.jpg', 'https://example.com/catalog.jpg']);
  });
  it('renders the related images returned by outfit_items, including uncached catalog products', async () => {
    mockResolve.mockResolvedValueOnce([
      {
        key: 'related-1',
        source: 'wardrobe',
        sourceId: 'remote-owned',
        imageUrl: 'https://example.com/owned.jpg',
      },
      {
        key: 'related-2',
        source: 'catalog',
        sourceId: 'remote-product',
        imageUrl: 'https://example.com/product.jpg',
      },
    ]);
    const outfit: SavedOutfit = {
      id: 'remote',
      title: 'İlişkili',
      wardrobeItemIds: ['remote-owned'],
      catalogProductIds: ['remote-product'],
      createdAt: '2026-09-28',
    };
    await renderer.act(async () => {
      tree = renderer.create(createElement(OutfitCover, { outfit }));
    });
    expect(
      tree.root.findAllByType('Image').map((image) => image.props.source.uri),
    ).toEqual([
      'https://example.com/owned.jpg',
      'https://example.com/product.jpg',
    ]);
  });
});
