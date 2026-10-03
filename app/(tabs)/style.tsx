import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronDown,
  Heart,
  MoreVertical,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react-native';
import PressableScale from '../../components/PressableScale';
import VirtualTryOnModal from '../../components/VirtualTryOnModal';
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
import { colors, radius, shadows, spacing } from '../../lib/theme';
import { openProductPage } from '../../services/deeplinkService';
import { useAppStore } from '../../store/useAppStore';
import {
  formatTryPrice,
  getDisplayPrice,
  getProductImages,
  getDropPercent,
  hasCatalogPriceDrop,
  type GarmentCategory,
  type LikedProduct,
  type Product,
} from '../../types/product';

type FavoriteTab = 'all' | 'products' | 'outfits';
type FavoriteSort = 'newest' | 'oldest' | 'priceAsc' | 'priceDesc';
const THUMBNAIL_WIDTH = 112;
const THUMBNAIL_MIN_HEIGHT = 148;
const SWIPE_DELETE_THRESHOLD_PX = 72;
const SORT_LABELS: Record<FavoriteSort, string> = {
  newest: 'En Yeni',
  oldest: 'En Eski',
  priceAsc: 'Fiyat: Artan',
  priceDesc: 'Fiyat: Azalan',
};
const CATEGORY_LABELS: Record<GarmentCategory, string> = {
  upper_body: 'Üst Giyim',
  lower_body: 'Alt Giyim',
  dresses: 'Elbiseler',
  shoes: 'Ayakkabılar',
  bags: 'Çantalar',
  hats: 'Şapkalar',
  accessories: 'Aksesuarlar',
};

interface FavoriteCardProps {
  item: LikedProduct;
  onRemove: (productId: string) => Promise<boolean>;
  onTryOn: (product: Product) => void;
}

function FavoriteCard({
  item,
  onRemove,
  onTryOn,
}: FavoriteCardProps): ReactElement {
  const { product } = item;
  const [imageFailed, setImageFailed] = useState(false);
  const translateX = useSharedValue(0);
  const livePrice = getDisplayPrice(product);
  const previousPrice = product.previousPrice;
  const hasDrop = hasCatalogPriceDrop(product);
  const dropPercent =
    hasDrop && typeof previousPrice === 'number'
      ? getDropPercent(previousPrice, livePrice)
      : 0;

  useEffect(() => () => cancelAnimation(translateX), [translateX]);

  const swipeDelete = (): void => {
    void onRemove(product.id).then((removed) => {
      if (!removed) {
        translateX.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    });
  };
  const panGesture = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      translateX.value = Math.min(0, event.translationX);
    })
    .onEnd(() => {
      if (translateX.value <= -SWIPE_DELETE_THRESHOLD_PX) {
        translateX.value = withTiming(-280, { duration: 160 }, (finished) => {
          if (finished) runOnJS(swipeDelete)();
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
    Alert.alert(product.title, undefined, [
      {
        text: 'Mağazaya Git',
        onPress: () => {
          void openProductPage(product);
        },
      },
      {
        text: 'Favorilerden çıkar',
        style: 'destructive',
        onPress: () => onRemove(product.id),
      },
      { text: 'İptal', style: 'cancel' },
    ]);
  };
  return (
    <View style={styles.swipeWrap}>
      <Animated.View
        pointerEvents="none"
        style={[styles.deleteReveal, revealStyle]}
      >
        <Trash2 color={colors.inverseText} size={22} />
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.card, cardStyle]}>
          <PressableScale
            style={styles.imageLink}
            onPress={() => {
              void openProductPage(product);
            }}
            accessibilityRole="button"
            accessibilityLabel={product.title}
          >
            {imageFailed ? (
              <View style={styles.imageFallback}>
                <Text style={styles.imageFallbackText}>Görsel yok</Text>
              </View>
            ) : (
              <Image
                source={{ uri: getProductImages(product)[0] }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={product.id}
                onError={() => setImageFailed(true)}
              />
            )}
          </PressableScale>
          <View style={styles.cardInfo}>
            <View style={styles.metaCopy}>
              <Text style={styles.brand} numberOfLines={1}>
                {product.brand}
              </Text>
              <Text style={styles.productTitle} numberOfLines={2}>
                {product.title}
              </Text>
            </View>
            <View style={styles.priceRow}>
              {hasDrop && typeof previousPrice === 'number' ? (
                <Text style={styles.previousPrice}>
                  {formatTryPrice(previousPrice)}
                </Text>
              ) : null}
              <Text
                style={[styles.price, hasDrop ? styles.livePriceDrop : null]}
              >
                {formatTryPrice(livePrice)}
              </Text>
              {hasDrop ? (
                <View style={styles.dropBadge}>
                  <Text
                    style={styles.dropBadgeText}
                  >{`↓ %${dropPercent}`}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.actions}>
              <PressableScale
                onPress={() => onTryOn(product)}
                style={styles.tryButton}
                accessibilityRole="button"
                accessibilityLabel="Tekrar dene"
              >
                <Text style={styles.tryButtonText}>Tekrar Dene</Text>
              </PressableScale>
              <PressableScale
                onPress={() => {
                  void openProductPage(product);
                }}
                style={styles.shopButton}
                accessibilityRole="button"
                accessibilityLabel="Mağazaya git"
              >
                <Text style={styles.shopButtonText}>Mağazaya Git</Text>
              </PressableScale>
            </View>
          </View>
          <View style={styles.cardBottom}>
            <View style={styles.swatches}>
              {product.colors?.slice(0, 3).map((color) => (
                <View
                  key={`${color.name}-${color.hex}`}
                  accessibilityLabel={color.name}
                  style={[styles.swatch, { backgroundColor: color.hex }]}
                />
              ))}
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
          <PressableScale
            style={styles.heart}
            onPress={() => {
              void onRemove(product.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${product.title} favorilerden çıkar`}
            accessibilityState={{ selected: true }}
          >
            <Heart size={19} color={colors.accent} fill={colors.accent} />
          </PressableScale>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default function FavoritesScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const likedProducts = useAppStore((state) => state.likedProducts);
  const unlikeProduct = useAppStore((state) => state.unlikeProduct);
  const refreshLikedProducts = useAppStore(
    (state) => state.refreshLikedProducts,
  );
  const [tab, setTab] = useState<FavoriteTab>('all');
  const [sort, setSort] = useState<FavoriteSort>('newest');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [category, setCategory] = useState<GarmentCategory | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tryOnProduct, setTryOnProduct] = useState<Product | null>(null);
  const categories = useMemo(
    () => [...new Set(likedProducts.map((item) => item.product.category))],
    [likedProducts],
  );
  const brands = useMemo(
    () =>
      [...new Set(likedProducts.map((item) => item.product.brand))].sort(
        (a, b) => a.localeCompare(b, 'tr'),
      ),
    [likedProducts],
  );
  const products = useMemo(() => {
    if (tab === 'outfits') return [];
    const text = query.trim().toLocaleLowerCase('tr');
    return likedProducts
      .filter(
        ({ product }) =>
          (!category || product.category === category) &&
          (!brand || product.brand === brand) &&
          `${product.title} ${product.brand}`
            .toLocaleLowerCase('tr')
            .includes(text),
      )
      .sort((a, b) => {
        if (sort === 'priceAsc')
          return getDisplayPrice(a.product) - getDisplayPrice(b.product);
        if (sort === 'priceDesc')
          return getDisplayPrice(b.product) - getDisplayPrice(a.product);
        return sort === 'oldest'
          ? a.likedAt.localeCompare(b.likedAt)
          : b.likedAt.localeCompare(a.likedAt);
      });
  }, [likedProducts, tab, query, category, brand, sort]);
  const remove = useCallback(
    async (productId: string): Promise<boolean> => {
      try {
        await unlikeProduct(productId);
        return true;
      } catch {
        Alert.alert(
          'Favori kaldırılamadı',
          'Ürün geri eklendi. Lütfen tekrar dene.',
        );
        return false;
      }
    },
    [unlikeProduct],
  );
  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await refreshLikedProducts();
    } catch {
      Alert.alert('Favoriler yüklenemedi', 'Lütfen tekrar dene.');
    } finally {
      setRefreshing(false);
    }
  }, [refreshLikedProducts]);
  const renderItem = useCallback(
    ({ item }: { item: LikedProduct }): ReactElement => (
      <FavoriteCard item={item} onRemove={remove} onTryOn={setTryOnProduct} />
    ),
    [remove],
  );
  const chooseSort = (): void =>
    Alert.alert('Sıralama', undefined, [
      ...(Object.keys(SORT_LABELS) as FavoriteSort[]).map((value) => ({
        text: SORT_LABELS[value],
        onPress: () => setSort(value),
      })),
      { text: 'İptal', style: 'cancel' },
    ]);
  return (
    <View
      style={[
        styles.root,
        { paddingTop: Math.max(56, insets.top + spacing.lg) },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.title}>Favoriler</Text>
        </View>
        <PressableScale
          style={styles.iconButton}
          onPress={() => setSearchOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel="Favorilerde ara"
        >
          <Search size={21} color={colors.text} />
        </PressableScale>
        <PressableScale
          style={styles.iconButton}
          onPress={() => setFilterOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Favorileri filtrele"
        >
          <SlidersHorizontal
            size={21}
            color={category || brand ? colors.accent : colors.text}
          />
        </PressableScale>
      </View>
      {searchOpen ? (
        <View style={styles.search}>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Favorilerde ara"
            accessibilityLabel="Favori araması"
            style={styles.searchInput}
          />
          <PressableScale
            onPress={() => {
              setQuery('');
              setSearchOpen(false);
            }}
            accessibilityLabel="Aramayı kapat"
          >
            <X size={20} color={colors.text} />
          </PressableScale>
        </View>
      ) : null}
      <View style={styles.controls}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {(
            [
              { value: 'all', label: 'Tümü', count: likedProducts.length },
              {
                value: 'products',
                label: 'Ürünler',
                count: likedProducts.length,
              },
              { value: 'outfits', label: 'Kombinler', count: 0 },
            ] as const
          ).map((option) => (
            <PressableScale
              key={option.value}
              onPress={() => setTab(option.value)}
              style={[styles.tab, tab === option.value && styles.activeTab]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === option.value }}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === option.value && styles.activeTabText,
                ]}
              >
                {option.label} ({option.count})
              </Text>
            </PressableScale>
          ))}
        </ScrollView>
        <PressableScale
          style={styles.sort}
          onPress={chooseSort}
          accessibilityRole="button"
          accessibilityLabel="Favorileri sırala"
        >
          <Text style={styles.sortText}>{SORT_LABELS[sort]}</Text>
          <ChevronDown size={16} color={colors.text} />
        </PressableScale>
      </View>
      <FlatList
        data={products}
        renderItem={renderItem}
        keyExtractor={(item): string => item.product.id}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => {
          void refresh();
        }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <Heart size={36} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>
              {tab === 'outfits'
                ? 'Henüz favori kombin yok.'
                : likedProducts.length === 0
                  ? 'Henüz favori ürün yok.'
                  : 'Eşleşen favori bulunamadı.'}
            </Text>
            <Text style={styles.muted}>
              {tab === 'outfits'
                ? 'Kaydedilmiş bir kombin bulunmuyor.'
                : likedProducts.length === 0
                  ? 'Beğendiğin ürünler burada görünecek.'
                  : 'Arama veya filtreleri değiştirebilirsin.'}
            </Text>
          </View>
        }
      />
      <VirtualTryOnModal
        visible={tryOnProduct !== null}
        product={tryOnProduct}
        onClose={() => setTryOnProduct(null)}
      />
      <Modal
        visible={filterOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterOpen(false)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + spacing.lg },
            ]}
          >
            <View style={styles.header}>
              <Text style={styles.emptyTitle}>Favorileri filtrele</Text>
              <PressableScale
                onPress={() => setFilterOpen(false)}
                accessibilityLabel="Filtreyi kapat"
              >
                <X size={22} color={colors.text} />
              </PressableScale>
            </View>
            <ScrollView>
              <Text style={styles.filterHeading}>Kategori</Text>
              <View style={styles.options}>
                {[null, ...categories].map((value) => (
                  <PressableScale
                    key={value ?? 'all'}
                    style={[styles.tab, category === value && styles.activeTab]}
                    onPress={() => setCategory(value)}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        category === value && styles.activeTabText,
                      ]}
                    >
                      {value ? CATEGORY_LABELS[value] : 'Tümü'}
                    </Text>
                  </PressableScale>
                ))}
              </View>
              <Text style={styles.filterHeading}>Marka</Text>
              <View style={styles.options}>
                {[null, ...brands].map((value) => (
                  <PressableScale
                    key={value ?? 'all'}
                    style={[styles.tab, brand === value && styles.activeTab]}
                    onPress={() => setBrand(value)}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        brand === value && styles.activeTabText,
                      ]}
                    >
                      {value ?? 'Tümü'}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </ScrollView>
            <View style={styles.options}>
              <PressableScale
                style={styles.tab}
                onPress={() => {
                  setCategory(null);
                  setBrand(null);
                }}
              >
                <Text style={styles.tabText}>Temizle</Text>
              </PressableScale>
              <PressableScale
                style={[styles.tab, styles.activeTab]}
                onPress={() => setFilterOpen(false)}
              >
                <Text style={styles.activeTabText}>Sonuçları göster</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgSoft,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    justifyContent: 'space-between',
  },
  heading: { flex: 1, paddingLeft: spacing.sm },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  controls: { gap: spacing.sm, marginBottom: spacing.lg },
  tabs: { gap: spacing.sm },
  tab: {
    borderRadius: radius.button,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeTab: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.text },
  activeTabText: { color: colors.inverseText, fontSize: 13, fontWeight: '800' },
  sort: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-end',
  },
  sortText: { color: colors.text, fontSize: 12 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, height: 42, color: colors.text },
  list: { paddingBottom: spacing.xl, gap: spacing.md },
  swipeWrap: {
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.destructive,
  },
  deleteReveal: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: spacing.xl,
    backgroundColor: colors.destructive,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
    ...shadows.card,
  },
  image: {
    flex: 1,
    width: THUMBNAIL_WIDTH,
    minHeight: THUMBNAIL_MIN_HEIGHT,
    backgroundColor: colors.bgSoft,
  },
  imageFallback: {
    flex: 1,
    width: THUMBNAIL_WIDTH,
    minHeight: THUMBNAIL_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSoft,
  },
  imageFallbackText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  cardInfo: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    justifyContent: 'space-between',
  },
  metaCopy: {
    marginBottom: spacing.sm,
  },
  brand: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  productTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  previousPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  livePriceDrop: {
    color: colors.accentDark,
  },
  dropBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  dropBadgeText: {
    color: colors.accentDark,
    fontSize: 12,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tryButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  tryButtonText: {
    color: colors.inverseText,
    fontSize: 13,
    fontWeight: '800',
  },
  shopButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  shopButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  imageLink: { width: THUMBNAIL_WIDTH, minHeight: THUMBNAIL_MIN_HEIGHT },
  heart: {
    position: 'absolute',
    left: THUMBNAIL_WIDTH - 36,
    top: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBottom: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    width: THUMBNAIL_WIDTH - spacing.sm * 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swatches: { flexDirection: 'row', gap: 4 },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgSoft,
    padding: spacing.lg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
  },
  filterHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
});
