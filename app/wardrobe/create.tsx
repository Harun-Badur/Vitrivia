import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import {
  ChevronLeft,
  Heart,
  MoreVertical,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from '../../components/PressableScale';
import { colors, radius, shadows, spacing } from '../../lib/theme';
import {
  OUTFIT_SLOTS,
  canCreateOutfit,
  choiceSlot,
  type OutfitChoice,
  type OutfitSelection,
  type OutfitSlot,
} from '../../lib/outfitSelection';
import { openWardrobeEditor } from '../../lib/dolapNavigation';
import { useAppStore } from '../../store/useAppStore';
import { getProductImages } from '../../types/product';
import { wardrobeImage } from '../../types/wardrobe';
import { openProductPage } from '../../services/deeplinkService';

type SourceFilter = 'wardrobe' | 'favorites';
const SOURCES = [
  { key: 'wardrobe', label: 'Kıyafetlerim' },
  { key: 'favorites', label: 'Favoriler' },
] as const;
const choiceImage = (choice: OutfitChoice): string =>
  choice.source === 'catalog'
    ? getProductImages(choice.item)[0]
    : wardrobeImage(choice.item);
const priceFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function CreateOutfitRoute() {
  const params = useLocalSearchParams<{
    productId?: string;
    wardrobeItemId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = height < 740;
  const wardrobeItems = useAppStore((state) => state.wardrobeItems);
  const likedProducts = useAppStore((state) => state.likedProducts);
  const currentProducts = useAppStore((state) => state.currentProducts);
  const wardrobeStatus = useAppStore((state) => state.wardrobeStatus);
  const createOutfit = useAppStore((state) => state.createOutfit);
  const swipeRight = useAppStore((state) => state.swipeRight);
  const unlikeProduct = useAppStore((state) => state.unlikeProduct);
  const initialCatalog = useRef([
    ...currentProducts,
    ...likedProducts.map(({ product }) => product),
  ]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('wardrobe');
  const [category, setCategory] = useState<OutfitSlot | null>(null);
  const [selection, setSelection] = useState<OutfitSelection>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [carouselHeight, setCarouselHeight] = useState(height * 0.45);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const anchorHandled = useRef(false);
  const focusedKey = useRef<string | null>(null);
  const carouselRef = useRef<FlatList<OutfitChoice>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const cardWidth = width * 0.6;
  const interval = cardWidth + spacing.md;
  const cardHeight = Math.max(100, carouselHeight - 20);
  const likedIds = useMemo(
    () => new Set(likedProducts.map(({ product }) => product.id)),
    [likedProducts],
  );
  const pool = useMemo(() => {
    const products = new Map(
      [
        ...initialCatalog.current,
        ...currentProducts,
        ...likedProducts.map(({ product }) => product),
      ].map((product) => [product.id, product]),
    );
    return [
      ...wardrobeItems.map((item): OutfitChoice => ({
        key: `wardrobe:${item.id}`,
        source: 'wardrobe',
        item,
      })),
      ...[...products.values()].map((item): OutfitChoice => ({
        key: `catalog:${item.id}`,
        source: 'catalog',
        item,
      })),
    ];
  }, [currentProducts, likedProducts, wardrobeItems]);
  const choices = useMemo(
    () =>
      pool.filter(
        (choice) =>
          (category === null || choiceSlot(choice) === category) &&
          (sourceFilter === 'wardrobe'
            ? choice.source === 'wardrobe'
            : choice.source === 'catalog' && likedIds.has(choice.item.id)),
      ),
    [pool, category, sourceFilter, likedIds],
  );

  useEffect(() => {
    if (anchorHandled.current) return;
    const anchor = pool.find((choice) =>
      params.wardrobeItemId
        ? choice.source === 'wardrobe' &&
          choice.item.id === params.wardrobeItemId
        : choice.source === 'catalog' && choice.item.id === params.productId,
    );
    if (!anchor) return;
    const slot = choiceSlot(anchor);
    anchorHandled.current = true;
    if (slot) {
      setSelection({ [slot]: anchor });
      focusedKey.current = anchor.key;
    }
  }, [pool, params.productId, params.wardrobeItemId]);
  useEffect(() => {
    const index = Math.max(
      0,
      choices.findIndex((choice) => choice.key === focusedKey.current),
    );
    setActiveIndex(index);
    scrollX.setValue(index * interval);
    carouselRef.current?.scrollToOffset({
      offset: index * interval,
      animated: false,
    });
  }, [choices, interval, scrollX]);

  const select = (choice: OutfitChoice, index: number): void => {
    if (busyRef.current) return;
    const slot = choiceSlot(choice);
    if (!slot || (category !== null && slot !== category)) return;
    focusedKey.current = choice.key;
    setActiveIndex(index);
    anchorHandled.current = true;
    setSelection((current) => ({ ...current, [slot]: choice }));
  };
  const onSnap = ({
    nativeEvent,
  }: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const index = Math.min(
      choices.length - 1,
      Math.max(0, Math.round(nativeEvent.contentOffset.x / interval)),
    );
    if (choices[index]) {
      focusedKey.current = choices[index].key;
      setActiveIndex(index);
    }
  };
  const changeCategory = (slot: OutfitSlot): void => {
    if (busyRef.current) return;
    anchorHandled.current = true;
    focusedKey.current = selection[slot]?.key ?? null;
    setCategory(slot);
  };
  const changeSource = (source: SourceFilter): void => {
    setSourceFilter(source);
  };
  const filter = (): void => {
    Alert.alert('Parçaları filtrele', undefined, [
      { text: 'Kıyafetlerim', onPress: () => changeSource('wardrobe') },
      { text: 'Favoriler', onPress: () => changeSource('favorites') },
      { text: 'İptal', style: 'cancel' },
    ]);
  };
  const toggleFavorite = (choice: OutfitChoice): void => {
    if (choice.source !== 'catalog') return;
    if (likedIds.has(choice.item.id))
      void unlikeProduct(choice.item.id).catch(() =>
        Alert.alert('Favori güncellenemedi', 'Lütfen tekrar dene.'),
      );
    else swipeRight(choice.item);
  };
  const create = async (): Promise<void> => {
    if (
      busyRef.current ||
      !canCreateOutfit(selection) ||
      wardrobeStatus !== 'ready'
    )
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      await createOutfit(selection);
      router.replace({
        pathname: '/wardrobe/[section]',
        params: { section: 'outfits' },
      });
    } catch (error) {
      Alert.alert(
        'Kombin oluşturulamadı',
        error instanceof Error ? error.message : 'Lütfen tekrar dene.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const enabled =
    canCreateOutfit(selection) && wardrobeStatus === 'ready' && !busy;
  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + spacing.sm,
          paddingBottom: Math.max(insets.bottom, spacing.md),
        },
      ]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <PressableScale
          style={styles.iconButton}
          accessibilityLabel="Geri"
          accessibilityRole="button"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/liked');
          }}
        >
          <ChevronLeft size={24} color={colors.text} />
        </PressableScale>
        <View style={styles.heading}>
          <Text style={styles.headingText}>Kombin Oluştur</Text>
        </View>
        <PressableScale
          disabled={busy}
          style={styles.iconButton}
          accessibilityLabel="Kombin parçalarını filtrele"
          accessibilityRole="button"
          onPress={filter}
        >
          <SlidersHorizontal size={22} color={colors.text} />
        </PressableScale>
      </View>
      <Text style={styles.subtitle}>
        Dolabındaki parçaları kaydırarak kombinle.
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chips}
      >
        {SOURCES.map(({ key, label }) => (
          <PressableScale
            key={key}
            disabled={busy}
            style={[styles.chip, sourceFilter === key && styles.activeChip]}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ selected: sourceFilter === key }}
            onPress={() => changeSource(key)}
          >
            <Text
              style={[
                styles.chipText,
                sourceFilter === key && styles.activeChipText,
              ]}
            >
              {label}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>
      <View
        style={styles.carousel}
        onLayout={({ nativeEvent }) =>
          setCarouselHeight(nativeEvent.layout.height)
        }
      >
        {choices.length ? (
          <Animated.FlatList
            ref={carouselRef}
            data={choices}
            horizontal
            keyExtractor={(choice) => choice.key}
            accessibilityLabel="Kombin ürün carousel’i"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: (width - cardWidth) / 2,
            }}
            snapToInterval={interval}
            decelerationRate="fast"
            disableIntervalMomentum
            bounces={false}
            scrollEnabled={!busy}
            scrollEventThrottle={16}
            getItemLayout={(_, index) => ({
              length: interval,
              offset: index * interval,
              index,
            })}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              { useNativeDriver: true },
            )}
            onMomentumScrollEnd={onSnap}
            onScrollEndDrag={(event) => {
              const value = event.nativeEvent.contentOffset.x / interval;
              if (Math.abs(value - Math.round(value)) < 0.02) onSnap(event);
            }}
            renderItem={({ item: choice, index }) => {
              const product = choice.source === 'catalog' ? choice.item : null;
              const scale = scrollX.interpolate({
                inputRange: [
                  (index - 1) * interval,
                  index * interval,
                  (index + 1) * interval,
                ],
                outputRange: [0.94, 1, 0.94],
                extrapolate: 'clamp',
              });
              return (
                <Animated.View
                  style={{
                    width: cardWidth,
                    height: cardHeight,
                    marginRight: index === choices.length - 1 ? 0 : spacing.md,
                    transform: [{ scale }],
                  }}
                >
                  <PressableScale
                    disabled={busy}
                    style={[
                      styles.card,
                      activeIndex === index && styles.activeCard,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${choice.item.title} seç`}
                    accessibilityState={{ selected: activeIndex === index }}
                    onPress={() => {
                      select(choice, index);
                      carouselRef.current?.scrollToOffset({
                        offset: index * interval,
                        animated: true,
                      });
                    }}
                  >
                    <View style={styles.productImage}>
                      <Image
                        source={{ uri: choiceImage(choice) }}
                        style={styles.image}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        recyclingKey={choice.key}
                      />
                    </View>
                    <View style={[styles.info, compact && styles.compactInfo]}>
                      <View style={styles.infoHeader}>
                        <Text style={styles.brand} numberOfLines={1}>
                          {choice.item.brand || 'Dolabımdan'}
                        </Text>
                        <PressableScale
                          disabled={busy}
                          hitSlop={8}
                          accessibilityLabel={`${choice.item.title} seçenekleri`}
                          onPress={() =>
                            Alert.alert(choice.item.title, undefined, [
                              {
                                text: 'Parçayı Seç',
                                onPress: () => {
                                  select(choice, index);
                                  carouselRef.current?.scrollToOffset({
                                    offset: index * interval,
                                    animated: true,
                                  });
                                },
                              },
                              choice.source === 'wardrobe'
                                ? {
                                    text: 'Düzenle',
                                    onPress: () =>
                                      openWardrobeEditor(choice.item.id),
                                  }
                                : {
                                    text: 'Mağazaya Git',
                                    onPress: () => {
                                      void openProductPage(choice.item);
                                    },
                                  },
                              { text: 'İptal', style: 'cancel' },
                            ])
                          }
                        >
                          <MoreVertical size={18} color={colors.text} />
                        </PressableScale>
                      </View>
                      <Text style={styles.productTitle} numberOfLines={1}>
                        {choice.item.title}
                      </Text>
                      {product ? (
                        <Text style={styles.price}>
                          {priceFormatter.format(
                            product.currentPrice ?? product.price,
                          )}{' '}
                          TL
                        </Text>
                      ) : (
                        <Text style={styles.ownedLabel}>Kendi kıyafetin</Text>
                      )}
                      {product?.colors?.length ? (
                        <View style={styles.swatches}>
                          {product.colors
                            .slice(0, 4)
                            .map((color, colorIndex) => (
                              <View
                                key={`${color.hex}-${colorIndex}`}
                                style={[
                                  styles.swatch,
                                  { backgroundColor: color.hex },
                                ]}
                                accessibilityLabel={color.name}
                              />
                            ))}
                        </View>
                      ) : null}
                    </View>
                  </PressableScale>
                  {product ? (
                    <PressableScale
                      disabled={busy}
                      style={styles.heart}
                      accessibilityRole="button"
                      accessibilityLabel={`${product.title} favori`}
                      accessibilityState={{
                        selected: likedIds.has(product.id),
                      }}
                      onPress={() => toggleFavorite(choice)}
                    >
                      <Heart
                        size={22}
                        color={
                          likedIds.has(product.id) ? colors.accent : colors.text
                        }
                        fill={
                          likedIds.has(product.id)
                            ? colors.accent
                            : 'transparent'
                        }
                      />
                    </PressableScale>
                  ) : null}
                </Animated.View>
              );
            }}
          />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Bu kategoride henüz parça yok.</Text>
            <PressableScale
              accessibilityLabel={
                sourceFilter === 'favorites'
                  ? 'Favori Ürün Ekle'
                  : 'Kıyafet Ekle'
              }
              onPress={() =>
                sourceFilter === 'favorites'
                  ? router.navigate('/(tabs)')
                  : openWardrobeEditor()
              }
            >
              <Text style={styles.emptyAction}>
                {sourceFilter === 'favorites'
                  ? 'Favori Ürün Ekle'
                  : 'Kıyafet Ekle'}
              </Text>
            </PressableScale>
          </View>
        )}
        {choices.length > 1 ? (
          <View style={styles.pagination}>
            {Array.from({ length: Math.min(choices.length, 5) }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  index ===
                    Math.min(
                      Math.min(choices.length, 5) - 1,
                      Math.floor(
                        (activeIndex * Math.min(choices.length, 5)) /
                          choices.length,
                      ),
                    ) && styles.activeDot,
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.selectedSection}>
        <View style={styles.selectedHeader}>
          <Text style={styles.selectedTitle}>Seçili Parçalar</Text>
          <PressableScale
            disabled={busy || !Object.values(selection).some(Boolean)}
            style={styles.clear}
            accessibilityLabel="Tümünü temizle"
            accessibilityRole="button"
            onPress={() => {
              anchorHandled.current = true;
              setSelection({});
            }}
          >
            <Trash2 size={15} color={colors.textSecondary} />
            <Text style={styles.clearText}>Tümünü Temizle</Text>
          </PressableScale>
        </View>
        <View style={styles.slots}>
          {OUTFIT_SLOTS.map(({ key, label }) => {
            const choice = selection[key];
            return (
              <View
                key={key}
                style={[
                  styles.slot,
                  compact && styles.compactSlot,
                  choice && styles.filledSlot,
                ]}
              >
                <PressableScale
                  disabled={busy}
                  style={styles.slotContent}
                  accessibilityRole="button"
                  accessibilityLabel={`${label} slotu`}
                  onPress={() => changeCategory(key)}
                >
                  {choice ? (
                    <Image
                      source={{ uri: choiceImage(choice) }}
                      style={styles.slotImage}
                      contentFit="contain"
                      recyclingKey={choice.key}
                    />
                  ) : (
                    <View style={styles.emptySlot}>
                      <Plus size={24} color={colors.accent} />
                    </View>
                  )}
                  <Text
                    style={[styles.slotLabel, choice && styles.filledSlotLabel]}
                  >
                    {label}
                  </Text>
                </PressableScale>
                {choice ? (
                  <PressableScale
                    disabled={busy}
                    style={styles.remove}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} parçasını kaldır`}
                    onPress={() => {
                      anchorHandled.current = true;
                      setSelection((current) => ({
                        ...current,
                        [key]: undefined,
                      }));
                    }}
                  >
                    <X size={16} color={colors.text} />
                  </PressableScale>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.footer}>
        <PressableScale
          disabled={!enabled}
          style={[styles.createButton, !enabled && styles.disabledButton]}
          accessibilityRole="button"
          accessibilityLabel="Oluştur"
          accessibilityState={{ disabled: !enabled, busy }}
          onPress={() => void create()}
        >
          {busy ? <ActivityIndicator color={colors.inverseText} /> : null}
          <Text style={styles.createText}>
            {busy ? 'Oluşturuluyor…' : 'Oluştur'}
          </Text>
        </PressableScale>
        {!canCreateOutfit(selection) ? (
          <Text style={styles.requirement}>
            Başlamak için Üst ve Alt parçalarını seç.
          </Text>
        ) : wardrobeStatus !== 'ready' ? (
          <Text style={styles.requirement}>
            Dolap kayıtları yüklenmeyi bekliyor.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  heading: { flex: 1, alignItems: 'center' },
  headingText: { fontSize: 20, fontWeight: '800', color: colors.text },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: radius.button,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.segment,
  },
  subtitle: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chips: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  chip: {
    minWidth: 70,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSoft,
    alignItems: 'center',
  },
  activeChip: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 12 },
  activeChipText: { color: colors.inverseText },
  carousel: { flex: 1, minHeight: 0 },
  card: {
    flex: 1,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.segment,
  },
  activeCard: { borderColor: colors.accentSoft },
  productImage: { flex: 1, minHeight: 0 },
  image: { width: '100%', height: '100%' },
  info: {
    padding: spacing.md,
    gap: 3,
    height: 104,
    backgroundColor: colors.bgSoft,
    borderRadius: radius.card,
  },
  compactInfo: { height: 94, padding: spacing.sm },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  brand: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  productTitle: { fontSize: 12, color: colors.textSecondary },
  price: { color: colors.text, fontSize: 14, fontWeight: '700' },
  ownedLabel: { color: colors.textSecondary, fontSize: 11 },
  heart: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    width: 36,
    height: 36,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.input,
    ...shadows.segment,
  },
  swatches: { flexDirection: 'row', gap: 6, paddingTop: 3 },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pagination: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dot: {
    width: 16,
    height: 3,
    borderRadius: radius.chip,
    backgroundColor: colors.border,
  },
  activeDot: { backgroundColor: colors.accent },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyText: { color: colors.textSecondary, textAlign: 'center' },
  emptyAction: { color: colors.accentDark, fontWeight: '700' },
  selectedSection: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  selectedTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: 6,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearText: { color: colors.textSecondary, fontSize: 10 },
  slots: { flexDirection: 'row', gap: spacing.sm },
  slot: {
    flex: 1,
    height: 112,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
  },
  compactSlot: { height: 86 },
  filledSlot: {
    borderStyle: 'solid',
    borderColor: colors.accent,
    ...shadows.segment,
  },
  slotContent: { flex: 1, alignItems: 'center', padding: 6, gap: 4 },
  slotImage: { flex: 1, width: '100%' },
  emptySlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  slotLabel: { color: colors.textSecondary, fontSize: 11 },
  filledSlotLabel: { color: colors.text, fontWeight: '600' },
  remove: {
    position: 'absolute',
    right: 3,
    top: 3,
    width: 24,
    height: 24,
    borderRadius: radius.chip,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.segment,
  },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  createButton: {
    height: 52,
    borderRadius: radius.chip,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    ...shadows.segment,
  },
  disabledButton: { opacity: 0.45 },
  createText: { color: colors.inverseText, fontWeight: '800', fontSize: 16 },
  requirement: {
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 10,
    marginTop: spacing.xs,
  },
});
