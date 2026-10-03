import { createElement, type ReactElement } from 'react';
import SizeStudioCard from '../components/SizeStudioCard';
import SizeStudioSheet from '../components/SizeStudioSheet';
import StyleBrandLogo, {
  getStyleBrandLogo,
} from '../components/StyleBrandLogo';
import type { UserStudioProfile } from '../types/profile';

interface TestNode {
  props: {
    onPress: () => void;
    onChangeText: (value: string) => void;
    disabled: boolean;
    accessibilityState: { selected: boolean; checked?: boolean };
    crop: readonly number[];
    source?: { uri?: string };
    onError: () => void;
  };
}
interface TestTree {
  root: {
    findByProps: (props: Record<string, unknown>) => TestNode;
    findAllByProps: (props: Record<string, unknown>) => TestNode[];
    findAllByType: (type: string) => TestNode[];
  };
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => TestTree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: {
    create: (value: unknown) => value,
    absoluteFill: {},
    hairlineWidth: 1,
  },
}));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../components/StyleReferenceArt', () => ({
  __esModule: true,
  default: 'StyleReferenceArt',
  STYLE_ART: {
    minimal: [1],
    street: [2],
    classic: [3],
    sport: [4],
    summary: [5],
  },
}));
jest.mock(
  'lucide-react-native',
  () => new Proxy({}, { get: () => () => null }),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 20 }),
}));
const mockLikedProducts = [{ product: { brand: 'Gerçek kayıt markası' } }];
jest.mock('../store/useAppStore', () => ({
  useAppStore: (
    selector: (state: { likedProducts: typeof mockLikedProducts }) => unknown,
  ) => selector({ likedProducts: mockLikedProducts }),
}));
const profile: UserStudioProfile = {
  userId: 'owner',
  heightCm: 181,
  weightKg: 73,
  topSize: 'L',
  bottomSize: 'S',
  styleTags: ['sport'],
  modelPhotoPath: 'private-person-photo',
};
const callbacks = {
  onHeightChange: jest.fn(),
  onWeightChange: jest.fn(),
  onTopSizeChange: jest.fn(),
  onBottomSizeChange: jest.fn(),
  onStyleToggle: jest.fn(),
  onClose: jest.fn(),
  onSavePreferences: jest.fn().mockResolvedValue(true),
};
let tree: TestTree;
beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  if (tree) await renderer.act(() => tree.unmount());
});
async function render(element: ReactElement) {
  await renderer.act(() => {
    tree = renderer.create(element);
  });
}

it('forwards existing body controls with actual profile values and sizes', async () => {
  await render(
    createElement(SizeStudioCard, {
      ...callbacks,
      profile,
      disabled: false,
      section: 'body',
    }),
  );
  await renderer.act(() => {
    tree.root.findByProps({ accessibilityLabel: 'Boy artır' }).props.onPress();
    tree.root.findByProps({ accessibilityLabel: 'Kilo azalt' }).props.onPress();
    const sizes = tree.root.findAllByProps({ accessibilityLabel: 'M' });
    sizes[0].props.onPress();
    sizes[1].props.onPress();
  });
  expect(callbacks.onHeightChange).toHaveBeenCalledWith(182);
  expect(callbacks.onWeightChange).toHaveBeenCalledWith(72);
  expect(callbacks.onTopSizeChange).toHaveBeenCalledWith('M');
  expect(callbacks.onBottomSizeChange).toHaveBeenCalledWith('M');
  expect(callbacks.onStyleToggle).not.toHaveBeenCalled();
});
it('retains only the existing style options and active selection', async () => {
  await render(
    createElement(SizeStudioCard, {
      ...callbacks,
      profile,
      disabled: false,
      section: 'style',
    }),
  );
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Spor' }).props
      .accessibilityState.selected,
  ).toBe(true);
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Rahat' }),
  ).toHaveLength(0);
  await renderer.act(() =>
    tree.root.findByProps({ accessibilityLabel: 'Minimal' }).props.onPress(),
  );
  expect(callbacks.onStyleToggle).toHaveBeenCalledWith('minimal');
});
it('preserves disabled controls while the existing persistence callback runs', async () => {
  await render(
    createElement(SizeStudioSheet, {
      ...callbacks,
      profile,
      visible: true,
      disabled: true,
      section: 'body',
    }),
  );
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Boy artır' }).props.disabled,
  ).toBe(true);
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.disabled,
  ).toBe(true);
});
it('does not mark any style selected when the recorded selection is empty', async () => {
  await render(
    createElement(SizeStudioCard, {
      ...callbacks,
      profile: { ...profile, styleTags: [] },
      disabled: false,
      section: 'style',
    }),
  );
  for (const label of ['Minimal', 'Sokak', 'Klasik', 'Spor']) {
    expect(
      tree.root.findByProps({ accessibilityLabel: label }).props
        .accessibilityState.selected,
    ).toBe(false);
  }
  expect(callbacks.onStyleToggle).not.toHaveBeenCalled();
});
it('uses the verified official brand logo and falls back to the brand name on failure', async () => {
  await render(createElement(StyleBrandLogo, { brand: 'Mavi' }));
  const image = tree.root.findByProps({ accessibilityLabel: 'Mavi logosu' });
  expect(image.props.source?.uri).toContain(
    'https://eu.mavi.com/cdn/shop/files/Mavi_Logo_Onlineshop.png',
  );
  await renderer.act(() => image.props.onError());
  expect(tree.root.findAllByType('Image')).toHaveLength(0);
  expect(tree.root.findByProps({ children: 'Mavi' })).toBeDefined();
  expect(getStyleBrandLogo('Gerçek kayıt markası')).toBeUndefined();
});
it('shows missing saved summary values without substituting example measurements', async () => {
  await render(
    createElement(SizeStudioSheet, {
      ...callbacks,
      profile: {
        ...profile,
        styleTags: [],
        heightCm: null,
        weightKg: null,
        topSize: null,
        bottomSize: null,
      },
      visible: true,
      disabled: false,
      section: 'summary',
    }),
  );
  expect(
    tree.root.findAllByProps({ children: 'Seçilmedi' }).length,
  ).toBeGreaterThan(0);
  expect(
    tree.root.findAllByProps({ children: 'Belirlenmedi' }).length,
  ).toBeGreaterThan(0);
  expect(tree.root.findAllByProps({ children: '170 cm · 65 kg' })).toHaveLength(
    0,
  );
});
it('saves styles once on Save without triggering the immediate body/style callback', async () => {
  await render(
    createElement(SizeStudioSheet, {
      ...callbacks,
      profile,
      visible: true,
      disabled: false,
      section: 'style',
    }),
  );
  await renderer.act(async () => {
    tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.onPress();
  });
  expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  expect(callbacks.onSavePreferences).toHaveBeenCalledTimes(1);
  expect(callbacks.onSavePreferences).toHaveBeenCalledWith({
    styleTags: ['sport'],
  });
  expect(callbacks.onStyleToggle).not.toHaveBeenCalled();
});
it.each(['colors', 'brands', 'budget'] as const)(
  'keeps Save disabled until a selection exists in the %s view',
  async (section) => {
    await render(
      createElement(SizeStudioSheet, {
        ...callbacks,
        profile,
        visible: true,
        disabled: false,
        section,
      }),
    );
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.disabled,
    ).toBe(true);
    expect(callbacks.onStyleToggle).not.toHaveBeenCalled();
  },
);
it('uses decorative reference artwork and never the personal model photo in the summary', async () => {
  await render(
    createElement(SizeStudioSheet, {
      ...callbacks,
      profile,
      visible: true,
      disabled: false,
      section: 'summary',
    }),
  );
  expect(tree.root.findAllByType('StyleReferenceArt')[0].props.crop).toEqual([
    5,
  ]);
  expect(tree.root.findAllByType('Image')).toHaveLength(0);
});

it.each([
  {
    section: 'brands' as const,
    label: 'Mavi',
    patch: { favoriteBrands: ['Mavi'] },
  },
  {
    section: 'colors' as const,
    label: 'Mavi',
    patch: { preferredColors: ['Mavi'] },
  },
])(
  'selects and saves $section only on Save',
  async ({ section, label, patch }) => {
    await render(
      createElement(SizeStudioSheet, {
        ...callbacks,
        profile,
        visible: true,
        disabled: false,
        section,
      }),
    );
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.disabled,
    ).toBe(true);
    await renderer.act(() => {
      tree.root.findByProps({ accessibilityLabel: label }).props.onPress();
    });
    expect(callbacks.onSavePreferences).not.toHaveBeenCalled();
    expect(
      tree.root.findByProps({ accessibilityLabel: label }).props
        .accessibilityState.checked,
    ).toBe(true);
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.disabled,
    ).toBe(false);
    await renderer.act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.onPress();
    });
    expect(callbacks.onSavePreferences).toHaveBeenCalledWith(patch);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  },
);
it('validates min/max before saving and submits actual bounds', async () => {
  await render(
    createElement(SizeStudioSheet, {
      ...callbacks,
      profile,
      visible: true,
      disabled: false,
      section: 'budget',
    }),
  );
  await renderer.act(() => {
    tree.root
      .findByProps({ accessibilityLabel: 'Minimum fiyat' })
      .props.onChangeText('900');
    tree.root
      .findByProps({ accessibilityLabel: 'Maksimum fiyat' })
      .props.onChangeText('500');
  });
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.disabled,
  ).toBe(true);
  await renderer.act(() => {
    tree.root
      .findByProps({ accessibilityLabel: 'Maksimum fiyat' })
      .props.onChangeText('2500');
  });
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.disabled,
  ).toBe(false);
  await renderer.act(async () => {
    tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.onPress();
  });
  expect(callbacks.onSavePreferences).toHaveBeenCalledWith({
    priceRange: { min: 900, max: 2500 },
  });
});
it('restores saved brand/color choices and displays them in the summary', async () => {
  const saved = {
    ...profile,
    favoriteBrands: ['Mavi'],
    preferredColors: ['Yeşil'],
    priceRange: { min: 100, max: 800 },
  };
  await render(
    createElement(SizeStudioSheet, {
      ...callbacks,
      profile: saved,
      visible: true,
      disabled: false,
      section: 'brands',
    }),
  );
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Mavi' }).props
      .accessibilityState.checked,
  ).toBe(true);
  expect(
    tree.root.findAllByProps({ children: 'Gerçek kayıt markası' }),
  ).toHaveLength(0);
  await renderer.act(() => tree.unmount());
  await render(
    createElement(SizeStudioSheet, {
      ...callbacks,
      profile: saved,
      visible: true,
      disabled: false,
      section: 'summary',
    }),
  );
  expect(tree.root.findByProps({ children: 'Mavi' })).toBeDefined();
  expect(tree.root.findByProps({ children: 'Yeşil' })).toBeDefined();
  expect(tree.root.findByProps({ children: '₺100 – ₺800' })).toBeDefined();
});
it('retains the draft and keeps the sheet open if saving fails', async () => {
  callbacks.onSavePreferences.mockResolvedValueOnce(false);
  await render(
    createElement(SizeStudioSheet, {
      ...callbacks,
      profile,
      visible: true,
      disabled: false,
      section: 'style',
    }),
  );
  await renderer.act(() => {
    tree.root.findByProps({ accessibilityLabel: 'Minimal' }).props.onPress();
  });
  expect(callbacks.onStyleToggle).not.toHaveBeenCalled();
  await renderer.act(async () => {
    tree.root.findByProps({ accessibilityLabel: 'Kaydet' }).props.onPress();
  });
  expect(callbacks.onSavePreferences).toHaveBeenCalledWith({
    styleTags: ['sport', 'minimal'],
  });
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Minimal' }).props
      .accessibilityState.selected,
  ).toBe(true);
});
