import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, SlidersHorizontal, X } from 'lucide-react-native';
import {
  runOnUI,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import FeedModeSegment from '../../components/FeedModeSegment';
import SwipeCard, {
  SWIPE_CARD_HEIGHT,
  SWIPE_CARD_WIDTH,
  type PageIndex,
} from '../../components/SwipeCard';
import PressableScale from '../../components/PressableScale';
import FilterSheet from '../../components/FilterSheet';
import SkeletonShimmer from '../../components/SkeletonShimmer';
import SwipeHintOverlay from '../../components/SwipeHintOverlay';
import VirtualTryOnModal from '../../components/VirtualTryOnModal';
import { useAuthContext } from '../../hooks/useAuthContext';
import { logger } from '../../lib/logger';
import { track, trackFeedImpression } from '../../lib/analytics';
import {
  countActiveFilters,
  EMPTY_FEED_QUERY,
  facetChipsOnly,
  feedQueryFromFilters,
  removeFacet,
  SEARCH_HISTORY_KEY,
  SEARCH_HISTORY_LIMIT,
  type FeedQuery,
  type FeedQueryFacetKey,
  type FeedQueryFilters,
} from '../../lib/feedQuery';
import { parseSearchQuery } from '../../lib/searchQueryParse';
import { searchRelaxBannerText } from '../../lib/searchRelaxMessage';
import { setSessionFilters, setSessionQuery } from '../../lib/sessionIntent';
import { hasSeenSwipeHint, markSwipeHintSeen } from '../../lib/onboarding';
import {
  colors,
  discoverCardLiftForHeight,
  estimateDiscoverCardHeight,
  headerToDeckForHeight,
  layout,
  radius,
  shadows,
  spacing,
} from '../../lib/theme';
import {
  getRedirectLabel,
  openProductPage,
} from '../../services/deeplinkService';
import { DEFAULT_SEARCH_BRANDS } from '../../lib/searchQueryParse';
import { useAppStore } from '../../store/useAppStore';
import { getProductImages, type Product } from '../../types/product';
import type { FeedMode } from '../../types/recommendation';

const TOAST_DURATION_MS = 1600;
const FILTER_HIT_SIZE = 40;
const SEARCH_DIVIDER_HEIGHT = 24;
const SEARCH_TRACK_DEBOUNCE_MS = 500;
/** Header, clip sınırında kesilen kartın üstünde kalır. */
const HEADER_Z_INDEX = 7;

type HintStatus = 'checking' | 'visible' | 'hidden';

interface DeckPage {
  product: Product;
  pageIndex: PageIndex;
}

function LoadingFeed() {
  return (
    <View style={styles.emptyState}>
      <SkeletonShimmer
        width={SWIPE_CARD_WIDTH}
        height={SWIPE_CARD_HEIGHT}
        borderRadius={radius.card}
      />
      <Text style={styles.loadingTitle}>Ürünler yükleniyor...</Text>
      <Text style={styles.emptySubtitle}>
        Kabin feedi hazırlanıyor. Birazdan kaydırmaya başlayabilirsin.
      </Text>
    </View>
  );
}

interface DeckFinishedCardProps {
  subtitle: string;
  onRefresh: () => void;
  onOpenLiked: () => void;
}

function DeckFinishedCard({
  subtitle,
  onRefresh,
  onOpenLiked,
}: DeckFinishedCardProps) {
  return (
    <View style={styles.finishedCard}>
      <Text style={styles.finishedTitle}>Deste bitti! 🎉</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
      <PressableScale
        onPress={onOpenLiked}
        style={styles.primaryCta}
        accessibilityRole="button"
        accessibilityLabel="Dolabı gör"
      >
        <Text style={styles.primaryCtaText}>Dolabı Gör</Text>
      </PressableScale>
      <PressableScale
        onPress={onRefresh}
        style={styles.secondaryCta}
        accessibilityRole="button"
        accessibilityLabel="Yenile"
      >
        <Text style={styles.secondaryCtaText}>Yenile</Text>
      </PressableScale>
    </View>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const headerToDeckPx = headerToDeckForHeight(windowHeight);
  const discoverCardLiftPx = discoverCardLiftForHeight(windowHeight);
  const { user } = useAuthContext();
  const currentProducts = useAppStore((state) => state.currentProducts);
  const feedStatus = useAppStore((state) => state.feedStatus);
  const seenCount = useAppStore(
    (state) => state.likedProducts.length + state.passedProductIds.length,
  );
  const loadFeed = useAppStore((state) => state.loadFeed);
  const setFeedMode = useAppStore((state) => state.setFeedMode);
  const feedMode = useAppStore((state) => state.feedMode);
  const feedFallback = useAppStore((state) => state.feedFallback);
  const feedRelaxed = useAppStore((state) => state.feedRelaxed);
  const swipeRight = useAppStore((state) => state.swipeRight);
  const swipeLeft = useAppStore((state) => state.swipeLeft);
  const undoPass = useAppStore((state) => state.undoPass);
  const lastPassed = useAppStore((state) => {
    const stack = state.passedStack;
    return stack[stack.length - 1] ?? null;
  });


  const estimatedH = estimateDiscoverCardHeight(windowHeight);
  const pageHeight = useSharedValue(estimatedH);
  const dragOffset = useSharedValue(0);
  const topProductId = currentProducts[0]?.id ?? null;

  const prevTopIdRef = useRef<string | null>(null);
  const pageIndexSVByIdRef = useRef(new Map<string, SharedValue<number>>());

  const registerPageIndexSV = useCallback(
    (productId: string, sv: SharedValue<number>): void => {
      pageIndexSVByIdRef.current.set(productId, sv);
    },
    [],
  );

  const unregisterPageIndexSV = useCallback((productId: string): void => {
    pageIndexSVByIdRef.current.delete(productId);
  }, []);

  const handleDeckLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const nextH = event.nativeEvent.layout.height;
      if (nextH > 0) {
        pageHeight.value = nextH;
      }
    },
    [pageHeight],
  );

  const userId = user?.id ?? null;
  const canLike = user !== null;

  const [feedQuery, setFeedQuery] = useState<FeedQuery>(EMPTY_FEED_QUERY);
  const [searchInput, setSearchInput] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const feedQueryRef = useRef(feedQuery);
  feedQueryRef.current = feedQuery;

  const reloadFeed = useCallback((): void => {
    const q = feedQueryRef.current;
    void loadFeed(userId, {
      filters: q.filters,
      searchMode: q.mode === 'search',
    });
  }, [loadFeed, userId]);

  const applyFeedQuery = useCallback(
    (next: FeedQuery, options?: { inputText?: string }): void => {
      setFeedQuery(next);
      if (options?.inputText !== undefined) {
        setSearchInput(options.inputText);
      }
      setSessionFilters({
        category: next.filters.category ?? null,
        gender: null,
        size: null,
      });
      const textParts = [
        next.filters.text,
        next.filters.style,
        next.filters.color,
        next.filters.brand,
      ]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(' ');
      if (textParts.length > 0) {
        setSessionQuery(textParts);
      }
      void loadFeed(userId, {
        filters: next.filters,
        searchMode: next.mode === 'search',
      });
    },
    [loadFeed, userId],
  );

  const handleFeedModeChange = useCallback(
    (mode: FeedMode): void => {
      if (mode === feedMode) {
        return;
      }
      setFeedMode(mode);
      const q = feedQueryRef.current;
      void loadFeed(userId, {
        filters: q.filters,
        searchMode: q.mode === 'search',
      });
    },
    [feedMode, loadFeed, setFeedMode, userId],
  );

  useEffect(() => {
    reloadFeed();
    // Initial personal load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(SEARCH_HISTORY_KEY).then((raw) => {
      if (!mounted || !raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.every((item) => typeof item === 'string')
        ) {
          setSearchHistory(parsed.slice(0, SEARCH_HISTORY_LIMIT));
        }
      } catch {
        // ignore corrupt history
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const pushSearchHistory = useCallback(async (query: string): Promise<void> => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    setSearchHistory((prev) => {
      const next = [
        trimmed,
        ...prev.filter((item) => item.toLocaleLowerCase('tr-TR') !== trimmed.toLocaleLowerCase('tr-TR')),
      ].slice(0, SEARCH_HISTORY_LIMIT);
      void AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Prefetch budget: current card all images (cap 6); next/warm only images[0].
  useEffect(() => {
    const urls: string[] = [];
    const current = currentProducts[0];
    if (current) {
      urls.push(...getProductImages(current).slice(0, 6));
    }
    const next = currentProducts[1];
    if (next) {
      const first = getProductImages(next)[0];
      if (first) {
        urls.push(first);
      }
    }
    const warm = currentProducts[2];
    if (warm) {
      const first = getProductImages(warm)[0];
      if (first) {
        urls.push(first);
      }
    }
    const unique = Array.from(new Set(urls)).filter(
      (url): url is string => typeof url === 'string' && url.length > 0,
    );
    if (unique.length === 0) {
      return;
    }
    void Image.prefetch(unique);
  }, [currentProducts]);

  const handleRequireAuth = useCallback((): void => {
    router.push('/profile');
  }, [router]);

  const handleOpenLiked = useCallback((): void => {
    router.push('/liked');
  }, [router]);

  const handleSwipeRight = useCallback(
    (product: Product): void => {
      if (!canLike) {
        handleRequireAuth();
        return;
      }
      try {
        swipeRight(product);
      } catch (error) {
        logger.error('Beğeni işlenemedi', { error, productId: product.id });
      }
    },
    [canLike, handleRequireAuth, swipeRight],
  );

  /** Store commit yalnız gesture settle sonrası (SwipeCard onPass). */
  const handleSwipeLeft = useCallback(
    (product: Product): void => {
      try {
        swipeLeft(product);
      } catch (error) {
        logger.error('Geçme işlenemedi', { error, productId: product.id });
      }
    },
    [swipeLeft],
  );

  const [tryOnProduct, setTryOnProduct] = useState<Product | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hintStatus, setHintStatus] = useState<HintStatus>('checking');
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentProductsRef = useRef(currentProducts);
  currentProductsRef.current = currentProducts;

  const handleImpression = useCallback(
    (product: Product, dwellMs: number): void => {
      const position = currentProductsRef.current.findIndex(
        (item) => item.id === product.id,
      );
      trackFeedImpression(product.id, Math.max(position, 0), dwellMs);
    },
    [],
  );

  const handleApplyFilters = useCallback(
    (next: FeedQueryFilters): void => {
      const merged: FeedQueryFilters = { ...next };
      // Preserve free-text from bar parse unless panel overwrote facets only.
      if (!merged.text && feedQueryRef.current.filters.text) {
        // Panel does not edit text; keep existing text facet if any.
        merged.text = feedQueryRef.current.filters.text;
      }
      track('filter', null, {
        category: merged.category ?? null,
        color: merged.color ?? null,
        brand: merged.brand ?? null,
        style: merged.style ?? null,
        price_min: merged.priceMin ?? null,
        price_max: merged.priceMax ?? null,
      });
      applyFeedQuery(feedQueryFromFilters(merged));
    },
    [applyFeedQuery],
  );

  const commitSearchText = useCallback(
    (raw: string): void => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        applyFeedQuery(EMPTY_FEED_QUERY, { inputText: '' });
        return;
      }
      const parsed = parseSearchQuery(trimmed, { brands: DEFAULT_SEARCH_BRANDS });
      // Merge with panel-only facets that NL didn't set? Prefer NL as full replace
      // of searchable state so bar + panel stay one source after commit.
      const next = feedQueryFromFilters(parsed.filters);
      applyFeedQuery(next, { inputText: trimmed });
      void pushSearchHistory(trimmed);
      track('search', null, {
        query: trimmed,
        category: parsed.filters.category ?? null,
        color: parsed.filters.color ?? null,
        result_count: null,
      });
    },
    [applyFeedQuery, pushSearchHistory],
  );

  const handleSearchChange = useCallback(
    (value: string): void => {
      setSearchInput(value);
      if (searchDebounceRef.current !== null) {
        clearTimeout(searchDebounceRef.current);
      }
      searchDebounceRef.current = setTimeout(() => {
        commitSearchText(value);
      }, SEARCH_TRACK_DEBOUNCE_MS);
    },
    [commitSearchText],
  );

  const handleClearSearch = useCallback((): void => {
    if (searchDebounceRef.current !== null) {
      clearTimeout(searchDebounceRef.current);
    }
    applyFeedQuery(EMPTY_FEED_QUERY, { inputText: '' });
  }, [applyFeedQuery]);

  const handleRemoveFacet = useCallback(
    (key: FeedQueryFacetKey): void => {
      const nextFilters = removeFacet(feedQueryRef.current.filters, key);
      applyFeedQuery(feedQueryFromFilters(nextFilters));
    },
    [applyFeedQuery],
  );

  useEffect(() => {
    let isMounted = true;
    void hasSeenSwipeHint().then((seen) => {
      if (isMounted) {
        setHintStatus(seen ? 'hidden' : 'visible');
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleDismissHint = useCallback((): void => {
    setHintStatus('hidden');
    void markSwipeHintSeen();
  }, []);

  const showToast = useCallback((message: string): void => {
    if (toastTimeoutRef.current !== null) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const handleVirtualTryOn = useCallback((product: Product): void => {
    setTryOnProduct(product);
  }, []);

  const handleCloseTryOn = useCallback((): void => {
    setTryOnProduct(null);
  }, []);

  const handleBuy = useCallback(
    (product: Product): void => {
      showToast(`${getRedirectLabel(product)} yönlendiriliyorsun...`);
      void openProductPage(product);
    },
    [showToast],
  );

  const handleUndoPass = useCallback((): void => {
    undoPass();
  }, [undoPass]);

  /**
   * Reels penceresi: prev=-1, current=0, next=1, warm-up=+2 (queue[2], ekran dışı +2H).
   * Prev yoksa mount edilmez. Stack/peek/park yok.
   */
  const deckPages = useMemo<DeckPage[]>(() => {
    const pages: DeckPage[] = [];
    const current = currentProducts[0];
    const next = currentProducts[1];
    const warm = currentProducts[2];

    if (
      lastPassed !== null &&
      current !== undefined &&
      lastPassed.id !== current.id &&
      (next === undefined || lastPassed.id !== next.id) &&
      (warm === undefined || lastPassed.id !== warm.id)
    ) {
      pages.push({ product: lastPassed, pageIndex: -1 });
    }
    if (current !== undefined) {
      pages.push({ product: current, pageIndex: 0 });
    }
    if (next !== undefined) {
      pages.push({ product: next, pageIndex: 1 });
    }
    if (warm !== undefined) {
      pages.push({ product: warm, pageIndex: 2 });
    }
    return pages;
  }, [currentProducts, lastPassed]);

  const deckPoseKey = deckPages
    .map((p) => `${p.product.id}:${p.pageIndex}`)
    .join('|');

  // Atomic pose batch: ALL pageIndexSVs + dragOffset in ONE runOnUI tick.
  // Pass: drag≈-H → +=H; Undo: drag≈+H → -=H. First mount still syncs SVs.
  useLayoutEffect(() => {
    const prev = prevTopIdRef.current;
    const isFirst = prev === null;
    prevTopIdRef.current = topProductId;

    const H = pageHeight.value > 0 ? pageHeight.value : estimatedH;
    let nextDrag = dragOffset.value;
    if (!isFirst && topProductId !== null && prev !== topProductId) {
      const d = dragOffset.value;
      if (d < -H / 2) {
        nextDrag = d + H;
      } else if (d > H / 2) {
        nextDrag = d - H;
      } else {
        nextDrag = 0;
      }
    }

    const updates: { sv: SharedValue<number>; pageIndex: number }[] = [];
    for (const page of deckPages) {
      const sv = pageIndexSVByIdRef.current.get(page.product.id);
      if (sv !== undefined) {
        updates.push({ sv, pageIndex: page.pageIndex });
      }
    }

    runOnUI(() => {
      'worklet';
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i];
        u.sv.value = u.pageIndex;
      }
      dragOffset.value = nextDrag;
    })();
  }, [topProductId, deckPoseKey, estimatedH, deckPages, dragOffset, pageHeight]);

  const hasDeck = currentProducts.length > 0;
  // Katalogda ürün var ama hepsi beğenildi/geçildi: tekrar yüklemek işe yaramaz.
  const isCatalogExhausted = !hasDeck && seenCount > 0;
  const isLoading = feedStatus === 'loading' || feedStatus === 'idle';
  const isSearchMode = feedQuery.mode === 'search';
  const activeFilterCount = countActiveFilters(feedQuery.filters);
  const facetChips = useMemo(
    () => facetChipsOnly(feedQuery.filters),
    [feedQuery.filters],
  );
  const searchBannerText = useMemo(() => {
    if (!isSearchMode) {
      return null;
    }
    return searchRelaxBannerText(feedQuery.filters, feedRelaxed, feedFallback);
  }, [isSearchMode, feedQuery.filters, feedRelaxed, feedFallback]);
  const showSearchBanner = Boolean(searchBannerText);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current !== null) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop:
            (insets.top > 0 ? insets.top : layout.statusBarFallback) +
            layout.headerPaddingTop,
        },
      ]}
    >
      <View
        style={[
          styles.header,
          { paddingBottom: headerToDeckPx },
        ]}
      >
        <View style={styles.searchBar}>
          <Search color={colors.icon} size={18} />
          <TextInput
            value={searchInput}
            onChangeText={handleSearchChange}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onSubmitEditing={() => commitSearchText(searchInput)}
            placeholder="Ne arıyorsun?"
            placeholderTextColor={colors.placeholder}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Ürün ara"
          />
          {isSearchMode || searchInput.trim().length > 0 ? (
            <PressableScale
              onPress={handleClearSearch}
              style={styles.clearHit}
              accessibilityRole="button"
              accessibilityLabel="Aramayı temizle"
            >
              <X color={colors.icon} size={16} />
            </PressableScale>
          ) : null}
          <View style={styles.searchDivider} />
          <PressableScale
            onPress={() => setIsFilterOpen(true)}
            style={styles.filterHit}
            accessibilityRole="button"
            accessibilityLabel="Filtreler"
          >
            <SlidersHorizontal color={colors.icon} size={18} />
            {activeFilterCount > 0 ? <View style={styles.filterDot} /> : null}
          </PressableScale>
        </View>
        {searchFocused && searchHistory.length > 0 && !isSearchMode ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.historyRow}
            contentContainerStyle={styles.chipRowContent}
            keyboardShouldPersistTaps="handled"
          >
            {searchHistory.map((item) => (
              <Pressable
                key={item}
                onPress={() => {
                  setSearchInput(item);
                  commitSearchText(item);
                }}
                style={styles.historyChip}
                accessibilityRole="button"
                accessibilityLabel={`Geçmiş arama ${item}`}
              >
                <Text style={styles.historyChipText}>{item}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {isSearchMode ? (
          <View style={styles.searchMetaBlock}>
            {showSearchBanner && searchBannerText ? (
              <View style={styles.fallbackBanner}>
                <Text style={styles.fallbackBannerText}>{searchBannerText}</Text>
              </View>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipRow}
              contentContainerStyle={styles.chipRowContent}
            >
              <View style={styles.countChip}>
                <Text style={styles.countChipText}>
                  {currentProducts.length} sonuç
                </Text>
              </View>
              {facetChips.map((chip) => (
                <Pressable
                  key={`${chip.key}:${chip.label}`}
                  onPress={() => handleRemoveFacet(chip.key)}
                  style={styles.facetChip}
                  accessibilityRole="button"
                  accessibilityLabel={`${chip.label} filtresini kaldır`}
                >
                  <Text style={styles.facetChipText}>{chip.label}</Text>
                  <X color={colors.textSecondary} size={12} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        <View style={styles.segmentWrap}>
          <FeedModeSegment value={feedMode} onChange={handleFeedModeChange} />
        </View>
      </View>
      <View
        style={[
          styles.body,
          { paddingBottom: layout.deckPadding + discoverCardLiftPx },
        ]}
      >
        {isLoading ? (
          <LoadingFeed />
        ) : isCatalogExhausted && !isSearchMode ? (
          <DeckFinishedCard
            subtitle="Katalogdaki her şeyi gördün. Yeni ürünler eklendikçe burada belirir."
            onRefresh={reloadFeed}
            onOpenLiked={handleOpenLiked}
          />
        ) : !hasDeck ? (
          <DeckFinishedCard
            subtitle={
              isSearchMode
                ? 'Bu aramayla eşleşen ürün yok. Filtreleri gevşet veya temizle.'
                : 'Beğendiğin parçalar dolabına eklendi. Yeni öneriler yakında.'
            }
            onRefresh={isSearchMode ? handleClearSearch : reloadFeed}
            onOpenLiked={handleOpenLiked}
          />
        ) : (
          <View
            style={styles.deckClip}
            collapsable={false}
            onLayout={handleDeckLayout}
          >
            <View style={styles.deck}>
              {deckPages.map(({ product, pageIndex }) => (
                <SwipeCard
                  key={product.id}
                  product={product}
                  pageIndex={pageIndex}
                  pageHeight={pageHeight}
                  dragOffset={dragOffset}
                  registerPageIndexSV={registerPageIndexSV}
                  unregisterPageIndexSV={unregisterPageIndexSV}
                  canLike={canLike}
                  canUndo={lastPassed !== null}
                  onAddToCloset={handleSwipeRight}
                  onPass={handleSwipeLeft}
                  onVirtualTryOn={handleVirtualTryOn}
                  onBuy={handleBuy}
                  onUndoPass={handleUndoPass}
                  onRequireAuth={handleRequireAuth}
                  onImpression={handleImpression}
                />
              ))}
            </View>
          </View>
        )}
      </View>
      {hintStatus === 'visible' &&
      !isLoading &&
      !isSearchMode &&
      hasDeck ? (
        <SwipeHintOverlay onDismiss={handleDismissHint} />
      ) : null}
      <FilterSheet
        visible={isFilterOpen}
        filters={feedQuery.filters}
        onClose={() => setIsFilterOpen(false)}
        onApply={handleApplyFilters}
      />
      <VirtualTryOnModal
        visible={tryOnProduct !== null}
        product={tryOnProduct}
        onClose={handleCloseTryOn}
      />
      {toastMessage ? (
        <View
          style={[
            styles.toast,
            {
              top:
                (insets.top > 0 ? insets.top : layout.statusBarFallback) +
                layout.headerPaddingTop +
                layout.headerControl +
                layout.searchToSegment +
                layout.segmentHeight +
                spacing.sm,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg,
    zIndex: HEADER_Z_INDEX,
  },
  searchBar: {
    width: '100%',
    height: layout.headerControl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.input,
    borderRadius: radius.card,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    marginBottom: 0,
    zIndex: 6,
    ...shadows.input,
  },
  segmentWrap: {
    marginTop: layout.searchToSegment,
    alignItems: 'flex-start',
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  searchDivider: {
    width: 1,
    height: SEARCH_DIVIDER_HEIGHT,
    backgroundColor: colors.border,
  },
  filterHit: {
    width: FILTER_HIT_SIZE,
    height: FILTER_HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: layout.filterDot,
    height: layout.filterDot,
    borderRadius: layout.filterDot / 2,
    backgroundColor: colors.accent,
  },
  body: {
    flex: 1,
    width: '100%',
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  clearHit: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    marginTop: spacing.sm,
    maxHeight: 36,
  },
  historyRow: {
    marginTop: spacing.sm,
    maxHeight: 36,
  },
  chipRowContent: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  countChip: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  countChipText: {
    color: colors.accentDark,
    fontSize: 12,
    fontWeight: '800',
  },
  facetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  facetChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  historyChip: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  historyChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  searchMetaBlock: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  fallbackBanner: {
    marginBottom: 0,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fallbackBannerText: {
    color: colors.accentDark,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  /** Reels viewport: H = onLayout; offscreen pages clip dışında. Peek band yok. */
  // Prevent container bg bleed through card radius during pager transition
  deckClip: {
    flex: 1,
    overflow: 'hidden',
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  deck: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  finishedCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    ...shadows.card,
  },
  finishedTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  emptySubtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  primaryCta: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  primaryCtaText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryCta: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  secondaryCtaText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  toast: {
    position: 'absolute',
    left: spacing.xxl,
    right: spacing.xxl,
    zIndex: 10,
    backgroundColor: colors.inverseSurface,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  toastText: {
    color: colors.inverseText,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
