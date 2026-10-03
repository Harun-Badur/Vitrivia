import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  TextInput,
  useWindowDimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  ChevronRight,
  Heart,
  Shirt,
  Layers,
  MoreVertical,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from '../../components/PressableScale';
import OutfitCover from '../../components/OutfitCover';
import { colors, radius, shadows, spacing } from '../../lib/theme';
import { openProductPage } from '../../services/deeplinkService';
import { useAppStore } from '../../store/useAppStore';
import { wardrobeProduct, type SavedOutfit } from '../../types/wardrobe';
import {
  openOutfitCreator,
  openWardrobeEditor,
  openWardrobeList,
} from '../../lib/dolapNavigation';
import {
  getProductImages,
  type LikedProduct,
  type GarmentCategory,
  type Product,
} from '../../types/product';

/** Sekmeye her dönüşte sorgu atmamak için taze sayılan süre. */
const REFRESH_TTL_MS = 30_000;
const GRID_GAP = 6;
// Metro bundles this user-provided asset from its static module path.
/* eslint-disable @typescript-eslint/no-require-imports */
const WARDROBE_ONBOARDING_ASSET =
  require('../../assets/wardrobe-onboarding.png') as number;
/* eslint-enable @typescript-eslint/no-require-imports */
type DolapSection = 'clothes' | 'favorites' | 'outfits';
const CATEGORIES = [
  { key: 'all', label: 'Tümü' },
  { key: 'upper_body', label: 'Üst' },
  { key: 'lower_body', label: 'Alt' },
  { key: 'shoes', label: 'Ayakkabı' },
  { key: 'accessories', label: 'Aksesuar' },
] as const;
type CategoryFilter = (typeof CATEGORIES)[number]['key'];
function categoryLabel(category: GarmentCategory): string {
  if (category === 'upper_body') return 'Üst';
  if (category === 'lower_body') return 'Alt';
  if (category === 'shoes') return 'Ayakkabı';
  if (category === 'dresses') return 'Elbise';
  return 'Aksesuar';
}
const SWIPE_DELETE_THRESHOLD_PX = 72;

interface LikedItemProps {
  item: LikedProduct;
  width: number;
  favorite?: boolean;
  matchFavoriteLayout?: boolean;
  wardrobe?: boolean;
  swipeEnabled?: boolean;
  imageHeight?: number;
  onTryOn: (product: Product) => void;
  onOpenStore: (product: Product) => void;
  onSwipeDelete: (product: Product) => void;
  onCombine: (product: Product) => void;
}

function LikedItem({
  item,
  width,
  favorite = false,
  matchFavoriteLayout = false,
  wardrobe = false,
  swipeEnabled = true,
  imageHeight,
  onTryOn,
  onOpenStore,
  onSwipeDelete,
  onCombine,
}: LikedItemProps) {
  const { product } = item;
  const useFavoriteLayout = favorite || matchFavoriteLayout;
  const [hasImageError, setHasImageError] = useState(false);
  const [wardrobeImageIndex, setWardrobeImageIndex] = useState(0);
  const images = getProductImages(product);
  const wardrobeImageKey = wardrobe ? images.join('\n') : '';
  const imageUri = images[wardrobe ? wardrobeImageIndex : 0];
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (wardrobe) {
      setWardrobeImageIndex(0);
      setHasImageError(false);
    }
  }, [wardrobe, wardrobeImageKey]);

  useEffect(
    () => () => {
      cancelAnimation(translateX);
    },
    [translateX],
  );

  const panGesture = Gesture.Pan()
    .enabled(swipeEnabled)
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      translateX.value = Math.min(0, event.translationX);
    })
    .onEnd(() => {
      if (translateX.value <= -SWIPE_DELETE_THRESHOLD_PX) {
        translateX.value = withTiming(-280, { duration: 160 }, (finished) => {
          if (finished) {
            runOnJS(onSwipeDelete)(product);
          }
        });
        return;
      }
      translateX.value = withSpring(0, { damping: 18, stiffness: 180 });
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const revealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SWIPE_DELETE_THRESHOLD_PX, -12],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const showActions = (): void => {
    if (wardrobe) {
      Alert.alert(product.title, undefined, [
        { text: 'Düzenle', onPress: () => onTryOn(product) },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => onSwipeDelete(product),
        },
        { text: 'İptal', style: 'cancel' },
      ]);
      return;
    }
    Alert.alert(product.title, undefined, [
      { text: 'Tekrar Dene', onPress: () => onTryOn(product) },
      { text: 'Mağazaya Git', onPress: () => onOpenStore(product) },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => onSwipeDelete(product),
      },
      { text: 'İptal', style: 'cancel' },
    ]);
  };
  return (
    <View style={[styles.swipeWrap, { width }]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.deleteReveal, revealStyle]}
      >
        <Trash2 color={colors.inverseText} size={22} />
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.card, cardStyle]}>
          <PressableScale
            style={[
              styles.imageButton,
              useFavoriteLayout && { flex: 0, height: imageHeight },
            ]}
            onPress={() => onTryOn(product)}
            accessibilityRole="button"
            accessibilityLabel={`${product.title} ${wardrobe ? 'düzenle' : 'tekrar dene'}`}
          >
            {hasImageError ? (
              <View style={[styles.image, styles.imageFallback]}>
                <Text style={styles.muted}>Görsel yok</Text>
              </View>
            ) : (
              <Image
                source={{ uri: imageUri }}
                style={styles.image}
                contentFit={useFavoriteLayout ? 'cover' : 'contain'}
                contentPosition="center"
                accessibilityLabel={`${product.title} ürün görseli`}
                cachePolicy="memory-disk"
                recyclingKey={product.id}
                onError={() => {
                  if (wardrobe && wardrobeImageIndex + 1 < images.length)
                    setWardrobeImageIndex((index) => index + 1);
                  else setHasImageError(true);
                }}
              />
            )}
          </PressableScale>
          <View style={[styles.meta, useFavoriteLayout && styles.favoriteMeta]}>
            <View style={styles.metaCopy}>
              <Text style={styles.title} numberOfLines={1}>
                {favorite ? product.brand : product.title}
              </Text>
              <Text style={styles.category} numberOfLines={1}>
                {favorite ? product.title : categoryLabel(product.category)}
              </Text>
            </View>
            <PressableScale
              onPress={showActions}
              accessibilityRole="button"
              accessibilityLabel={`${product.title} seçenekleri`}
              hitSlop={8}
            >
              <MoreVertical size={18} color={colors.text} />
            </PressableScale>
          </View>
          {useFavoriteLayout ? (
            <>
              {favorite ? (
                <View
                  style={styles.favoriteHeart}
                  accessibilityLabel="Favori ürün"
                >
                  <Heart size={16} color={colors.accent} fill={colors.accent} />
                </View>
              ) : null}
              <PressableScale
                style={styles.combineButton}
                onPress={() => onCombine(product)}
                accessibilityRole="button"
                accessibilityLabel={`${product.title} kombinle`}
              >
                <Text style={styles.combineButtonText}>Kombinle</Text>
              </PressableScale>
            </>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function AddCard({
  width,
  outfit = false,
  compact = false,
}: {
  width: number;
  outfit?: boolean;
  compact?: boolean;
}) {
  return (
    <PressableScale
      style={[styles.addCard, { width }, compact && styles.compactAddCard]}
      onPress={outfit ? () => openOutfitCreator() : () => openWardrobeEditor()}
      accessibilityRole="button"
      accessibilityLabel={outfit ? 'Yeni kombin oluştur' : 'Yeni parça ekle'}
    >
      <View style={[styles.addIcon, compact && styles.compactAddIcon]}>
        <Plus size={compact ? 18 : 24} color={colors.accent} />
      </View>
      <Text style={[styles.addTitle, compact && styles.compactAddTitle]}>
        {outfit ? 'Yeni kombin oluştur' : 'Yeni parça ekle'}
      </Text>
      {!compact ? <Text style={styles.unavailable}>Fotoğraf ekle</Text> : null}
    </PressableScale>
  );
}
function SectionHeader({
  title,
  description,
  kind,
  onSeeAll,
}: {
  title: string;
  description: string;
  kind: DolapSection;
  onSeeAll: () => void;
}) {
  const Icon =
    kind === 'clothes' ? Shirt : kind === 'favorites' ? Heart : Layers;
  return (
    <View style={styles.outfitHeader}>
      <View style={styles.sectionHeadingRow}>
        <Icon size={20} color={colors.accent} />
        <View style={styles.flex}>
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <PressableScale
          style={styles.seeAll}
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`${title} tümünü gör`}
        >
          <Text style={styles.seeAllText}>Tümünü Gör</Text>
          <ChevronRight size={18} color={colors.accent} />
        </PressableScale>
      </View>
      {description ? (
        <Text style={styles.sectionDescription} numberOfLines={1}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

function WardrobeStarter({ compact }: { compact: boolean }) {
  return (
    <View style={[styles.starter, compact && styles.compactStarter]}>
      <View style={styles.starterCopy}>
        <Text
          style={[styles.starterTitle, compact && styles.compactStarterTitle]}
        >
          Dolabını oluşturmaya başla
        </Text>
        <Text
          style={[
            styles.starterDescription,
            compact && styles.compactStarterDescription,
          ]}
        >
          Kıyafetlerini ekle, kombinlerini oluştur.
        </Text>
        <PressableScale
          onPress={() => openWardrobeEditor()}
          style={[styles.starterButton, compact && styles.compactStarterButton]}
          accessibilityRole="button"
          accessibilityLabel="Kıyafet ekle"
        >
          <Plus size={16} color={colors.inverseText} />
          <Text style={styles.starterButtonText}>Kıyafet Ekle</Text>
        </PressableScale>
      </View>
      <View
        style={[styles.starterArt, compact && styles.compactStarterArt]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={[
            styles.starterArtFrame,
            compact && styles.compactStarterArtFrame,
          ]}
        >
          <Image
            source={WARDROBE_ONBOARDING_ASSET}
            style={styles.starterAsset}
            contentFit="contain"
            contentPosition="center"
            accessibilityLabel="Dolap başlangıç görseli"
          />
        </View>
      </View>
    </View>
  );
}

export default function LikedScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compactScreen = height < 740;
  const cardWidth = Math.max(0, (width - spacing.xl * 2 - GRID_GAP * 2) / 3);
  const compactAddWidth = Math.min(144, (width - spacing.xl * 2) / 2);
  const [clothesGridHeight, setClothesGridHeight] = useState(
    compactScreen ? 190 : 232,
  );
  const [outfitsGridHeight, setOutfitsGridHeight] = useState(
    compactScreen ? 190 : 232,
  );
  const clothingCardHeight = Math.max(0, (clothesGridHeight - GRID_GAP) / 2);
  const outfitCardHeight = Math.max(0, (outfitsGridHeight - GRID_GAP) / 2);
  const clothingImageHeight = Math.max(0, clothingCardHeight - 66);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const wardrobeItems = useAppStore((state) => state.wardrobeItems);
  const savedOutfits = useAppStore((state) => state.savedOutfits);
  const removeWardrobeItem = useAppStore((state) => state.removeWardrobeItem);
  const wardrobeProducts = useMemo(
    () =>
      wardrobeItems.map((item) => ({
        product: wardrobeProduct(item),
        likedAt: item.createdAt,
        notifyOnPriceDrop: false,
      })),
    [wardrobeItems],
  );
  const handleWardrobeDelete = (product: Product): void => {
    void removeWardrobeItem(product.id).catch(() =>
      Alert.alert(
        'Silinemedi',
        'Kıyafet kaldırılırken bir sorun oluştu. Tekrar dene.',
      ),
    );
  };
  const refreshLikedProducts = useAppStore(
    (state) => state.refreshLikedProducts,
  );
  const lastLoadedAtRef = useRef(0);

  const reloadLikes = useCallback(
    async (force: boolean): Promise<void> => {
      if (!force && Date.now() - lastLoadedAtRef.current < REFRESH_TTL_MS) {
        return;
      }

      try {
        await refreshLikedProducts();
        lastLoadedAtRef.current = Date.now();
      } catch {
        // Zaman damgası güncellenmedi; sonraki odakta tekrar denenir.
        Alert.alert(
          'Yenilenemedi',
          'Güncel fiyatlar alınamadı. Sekmeye yeniden dönüp tekrar dene.',
        );
      }
    },
    [refreshLikedProducts],
  );

  useFocusEffect(
    useCallback(() => {
      void reloadLikes(false);
    }, [reloadLikes]),
  );

  const handleOpenStore = useCallback((product: Product): void => {
    void openProductPage(product);
  }, []);

  const filteredProducts = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('tr');
    return wardrobeProducts.filter(
      ({ product }) =>
        (category === 'all' ||
          (category === 'accessories'
            ? ['accessories', 'bags', 'hats'].includes(product.category)
            : product.category === category)) &&
        (!brand || product.brand === brand) &&
        `${product.title} ${product.brand}`
          .toLocaleLowerCase('tr')
          .includes(text),
    );
  }, [category, query, brand, wardrobeProducts]);
  const chooseFilter = (): void => {
    const brands = [
      ...new Set(
        wardrobeProducts.map(({ product }) => product.brand).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, 'tr'));
    Alert.alert('Markaya göre filtrele', undefined, [
      { text: 'Tüm markalar', onPress: () => setBrand(null) },
      ...brands.map((value) => ({
        text: value,
        onPress: () => setBrand(value),
      })),
      { text: 'İptal', style: 'cancel' },
    ]);
  };
  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Dolabım</Text>
        <PressableScale
          style={styles.iconButton}
          onPress={() => setSearchOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel="Dolapta ara"
          accessibilityState={{ expanded: searchOpen }}
        >
          <Search size={22} color={colors.text} />
        </PressableScale>
        <PressableScale
          style={styles.iconButton}
          onPress={chooseFilter}
          accessibilityRole="button"
          accessibilityLabel="Dolabı filtrele"
        >
          <SlidersHorizontal
            size={22}
            color={brand ? colors.accent : colors.text}
          />
        </PressableScale>
      </View>
      {searchOpen ? (
        <View style={styles.search}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholder="Dolabında ara"
            placeholderTextColor={colors.placeholder}
            accessibilityLabel="Dolap araması"
          />
          <PressableScale
            onPress={() => {
              setQuery('');
              setSearchOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Aramayı kapat"
          >
            <X size={20} color={colors.text} />
          </PressableScale>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chips}
      >
        {CATEGORIES.map((option) => (
          <PressableScale
            key={option.key}
            onPress={() => setCategory(option.key)}
            style={[styles.chip, category === option.key && styles.activeChip]}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: category === option.key }}
          >
            <Text
              style={[
                styles.chipText,
                category === option.key && styles.activeChipText,
              ]}
            >
              {option.label}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>
      {brand ? (
        <PressableScale
          style={styles.appliedFilter}
          onPress={() => setBrand(null)}
          accessibilityRole="button"
          accessibilityLabel="Marka filtresini kaldır"
        >
          <Text style={styles.category}>{brand}</Text>
          <X size={14} color={colors.textSecondary} />
        </PressableScale>
      ) : null}
      <View style={styles.sections} accessibilityLabel="Dolap bölümleri">
        <View style={styles.section}>
          <SectionHeader
            title="Kıyafetlerim"
            description="Kendi kıyafetlerini ekle, kombinler oluştur."
            kind="clothes"
            onSeeAll={() => openWardrobeList('clothes')}
          />
          {wardrobeItems.length === 0 ? (
            <WardrobeStarter compact={compactScreen} />
          ) : filteredProducts.length === 0 ? (
            <View
              style={[styles.cardRow, styles.emptyCardRow]}
              accessibilityLabel="Kıyafet ürünleri"
            >
              <Text style={styles.emptyText} numberOfLines={2}>
                Eşleşen parça yok.
              </Text>
              <AddCard width={compactAddWidth} compact />
            </View>
          ) : (
            <FlatList<LikedProduct | null>
              style={styles.sectionGrid}
              onLayout={({ nativeEvent }) =>
                setClothesGridHeight(nativeEvent.layout.height)
              }
              accessibilityLabel="Kıyafet ürünleri"
              numColumns={3}
              data={[
                ...filteredProducts.slice(0, 3),
                null,
                ...filteredProducts.slice(3),
              ]}
              keyExtractor={(item) => (item ? item.product.id : 'add-clothes')}
              columnWrapperStyle={{ gap: GRID_GAP }}
              contentContainerStyle={{ gap: GRID_GAP }}
              renderItem={({ item }) => (
                <View
                  style={{
                    width: cardWidth,
                    height: clothingCardHeight,
                  }}
                >
                  {item ? (
                    <LikedItem
                      item={item}
                      width={cardWidth}
                      wardrobe
                      matchFavoriteLayout
                      imageHeight={clothingImageHeight}
                      onTryOn={(product) => openWardrobeEditor(product.id)}
                      onOpenStore={handleOpenStore}
                      onSwipeDelete={handleWardrobeDelete}
                      onCombine={(product) =>
                        router.push({
                          pathname: '/wardrobe/create',
                          params: {
                            wardrobeItemId: product.id,
                            source: 'wardrobe',
                          },
                        })
                      }
                    />
                  ) : (
                    <AddCard width={cardWidth} />
                  )}
                </View>
              )}
            />
          )}
        </View>
        <View style={[styles.section, styles.sectionDivider]}>
          <SectionHeader
            title="Kombinlerim"
            description={compactScreen ? '' : 'Kaydettiğin kombinler burada.'}
            kind="outfits"
            onSeeAll={() => openWardrobeList('outfits')}
          />
          {savedOutfits.length === 0 ? (
            <View
              style={[styles.cardRow, styles.emptyCardRow]}
              accessibilityLabel="Kombin kartları"
            >
              <Text style={styles.emptyText} numberOfLines={2}>
                Henüz kayıtlı kombin yok.
              </Text>
              <AddCard width={compactAddWidth} outfit compact />
            </View>
          ) : (
            <FlatList<SavedOutfit | null>
              style={styles.sectionGrid}
              onLayout={({ nativeEvent }) =>
                setOutfitsGridHeight(nativeEvent.layout.height)
              }
              accessibilityLabel="Kombin kartları"
              numColumns={3}
              data={[...savedOutfits.slice(0, 2), null]}
              keyExtractor={(item) => (item ? item.id : 'add-outfit')}
              columnWrapperStyle={{ gap: GRID_GAP }}
              contentContainerStyle={{ gap: GRID_GAP }}
              renderItem={({ item: outfit }) => (
                <View style={{ width: cardWidth, height: outfitCardHeight }}>
                  {outfit ? (
                    <View style={styles.card}>
                      <OutfitCover outfit={outfit} style={styles.image} />
                      <View style={styles.metaCopy}>
                        <Text style={styles.title} numberOfLines={1}>
                          {outfit.title}
                        </Text>
                        <Text style={styles.category}>
                          {outfit.wardrobeItemIds.length +
                            outfit.catalogProductIds.length}{' '}
                          parça
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <AddCard width={cardWidth} outfit />
                  )}
                </View>
              )}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  header: { flex: 1, fontSize: 28, fontWeight: '800', color: colors.text },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipScroll: { flexGrow: 0, flexShrink: 0, marginBottom: spacing.sm },
  chips: { paddingHorizontal: spacing.xl, gap: 6 },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 7,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSoft,
  },
  activeChip: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.text },
  activeChipText: { color: colors.inverseText },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, height: 42, color: colors.text, fontSize: 14 },
  appliedFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  sections: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  sectionGrid: { flex: 1, minHeight: 0 },
  cardRow: {
    flexShrink: 1,
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: GRID_GAP,
  },
  emptyCardRow: { height: 48, flexShrink: 0 },
  skeletonCard: {
    flexShrink: 0,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
  },
  swipeWrap: {
    height: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.destructive,
  },
  deleteReveal: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: spacing.md,
    backgroundColor: colors.destructive,
  },
  card: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.bgSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.segment,
  },
  imageButton: { flex: 1, minHeight: 0 },
  image: { flex: 1, width: '100%', backgroundColor: colors.surface },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 4,
    flexShrink: 0,
    gap: 2,
  },
  metaCopy: { flex: 1, minWidth: 0 },
  favoriteMeta: { height: 36 },
  title: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: colors.text,
  },
  category: {
    fontSize: 10,
    lineHeight: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  muted: { fontSize: 11, color: colors.textSecondary },
  addCard: {
    height: '100%',
    minHeight: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    gap: 3,
  },
  addIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.chip,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  compactAddCard: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  compactAddIcon: { width: 24, height: 24, marginBottom: 0, flexShrink: 0 },
  compactAddTitle: { flex: 1, textAlign: 'left' },
  addTitle: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: colors.accentDark,
    textAlign: 'center',
  },
  unavailable: {
    fontSize: 9,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  section: { flex: 1, minHeight: 0, paddingTop: spacing.xs },
  emptySection: { flexShrink: 0 },
  sectionDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  favoriteHeart: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 25,
    height: 25,
    borderRadius: radius.chip,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  combineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: 5,
    marginBottom: 4,
    height: 24,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  combineButtonText: {
    color: colors.inverseText,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  outfitHeader: {
    marginBottom: spacing.xs,
    flexShrink: 0,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    color: colors.text,
  },
  sectionDescription: {
    fontSize: 10,
    lineHeight: 13,
    color: colors.textSecondary,
    marginTop: 0,
    marginLeft: 28,
  },
  starter: {
    height: 132,
    minHeight: 106,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadows.segment,
  },
  compactStarter: { height: 92, minHeight: 88, padding: spacing.sm, gap: 6 },
  starterCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  starterTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
  },
  starterDescription: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 13,
  },
  compactStarterTitle: { fontSize: 12, lineHeight: 15 },
  compactStarterDescription: { fontSize: 9, lineHeight: 12 },
  starterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.button,
    backgroundColor: colors.accent,
    marginTop: 2,
  },
  starterButtonText: {
    color: colors.inverseText,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  compactStarterButton: { paddingVertical: 5 },
  starterArt: {
    width: '44%',
    height: '100%',
    flexShrink: 0,
    justifyContent: 'center',
  },
  compactStarterArt: { width: '28%' },
  starterArtFrame: {
    position: 'absolute',
    left: -spacing.md,
    right: -spacing.md,
    top: -spacing.md,
    bottom: -spacing.md,
  },
  compactStarterArtFrame: {
    left: -6,
    right: -spacing.sm,
    top: -spacing.sm,
    bottom: -spacing.sm,
  },
  // Compensate for the asset's transparent left margin without cropping clothes.
  starterAsset: { width: '128%', height: '100%', alignSelf: 'flex-end' },
  moreFavoritesDescription: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
  },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { fontSize: 11, color: colors.accentDark, fontWeight: '600' },
  emptyText: {
    flex: 1,
    alignSelf: 'center',
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xl,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inverseSurface,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  toastText: { color: colors.inverseText, fontSize: 15, fontWeight: '700' },
  toastAction: {
    color: colors.inverseText,
    fontSize: 15,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
});

// Reuse the existing cards in Dolap's child grids without changing this screen.
export {
  LikedItem as DolapProductCard,
  AddCard as DolapAddCard,
  styles as dolapCardStyles,
};
