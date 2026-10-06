import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { getSupabaseClient } from '../../lib/supabase';
import { track, trackFeedImpression } from '../../lib/analytics';
import {
  countActiveFilters,
  EMPTY_FEED_QUERY,
  feedQueryFromFilters,
  type FeedQuery,
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
  layout,
  radius,
  shadows,
  spacing,
} from '../../lib/theme';
import {
  getRedirectLabel,
  openProductPage,
} from '../../services/deeplinkService';
import { fetchRecommendationCatalog } from '../../services/productService';
import { DiscoverRecommendationCache } from '../../lib/discoverRecommendationCache';
import { discoverPrefetchTrace, instrumentationContextId } from '../../lib/discoverPrefetchInstrumentation';
import { loadDiscoverRecommendationPacket } from '../../services/discoverRecommendationCacheService';
import { complementaryProductsForDisplay } from '../../src/intelligence/recommendations/complementaryProductsForDisplay';
import { DEFAULT_SEARCH_BRANDS } from '../../lib/searchQueryParse';
import type { WardrobeItemForCandidate } from '../../src/intelligence/outfits/outfitCandidate';
import type { DiscoverRecommendation } from '../../src/intelligence/recommendations/discoverRecommendation';
import { useAppStore } from '../../store/useAppStore';
import { getProductImages, type Product } from '../../types/product';
import type { FeedMode } from '../../types/recommendation';

const TOAST_DURATION_MS = 1600;
const FILTER_HIT_SIZE = 40;
const SEARCH_TRACK_DEBOUNCE_MS = 500;
/** Header, clip sınırında kesilen kartın üstünde kalır. */
const HEADER_Z_INDEX = 7;
const EMPTY_RECOMMENDATIONS: readonly DiscoverRecommendation[] = [];

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
        Vitirify feedi hazırlanıyor. Birazdan kaydırmaya başlayabilirsin.
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
  const discoverCardLiftPx = discoverCardLiftForHeight(windowHeight);
  const { user } = useAuthContext();
  useFocusEffect(
    useCallback(() => {
      const statusBar = StatusBar.pushStackEntry({
        barStyle: 'light-content',
        backgroundColor: 'transparent',
        translucent: true,
      });
      return () => StatusBar.popStackEntry(statusBar);
    }, []),
  );
  const currentProducts = useAppStore((state) => state.currentProducts);
  const feedStatus = useAppStore((state) => state.feedStatus);
  const feedPreparationRevision = useAppStore((state) => state.feedPreparationRevision ?? 0);
  const likedProducts = useAppStore((state) => state.likedProducts);
  const seenCount = useAppStore(
    (state) => state.likedProducts.length + state.passedProductIds.length,
  );
  const loadFeed = useAppStore((state) => state.loadFeed);
  const loadMoreFeed = useAppStore((state) => state.loadMoreFeed);
  const hasMore = useAppStore((state) => state.hasMore);
  const isFetchingNext = useAppStore((state) => state.isFetchingNext);
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
  const currentProduct = currentProducts[0] ?? null;
  const nextProduct = currentProducts[1] ?? null;
  const warmProduct = currentProducts[2] ?? null;
  const topProductId = currentProduct?.id ?? null;

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
  const preparationDiagnosticState = useRef({ catalogReady: false, wardrobeReady: false });
  const [recommendationCatalog, setRecommendationCatalog] = useState<Product[]>(
    [],
  );

  useFocusEffect(
    useCallback(() => {
      // The first ranked feed is critical; the optional recommendation pool is not.
      if (feedStatus !== 'success') return;
      let active = true;
      if (__DEV__) preparationDiagnosticState.current.catalogReady = false;
      void fetchRecommendationCatalog()
        .then((products) => {
          if (active) {
            if (__DEV__) preparationDiagnosticState.current.catalogReady = true;
            setRecommendationCatalog(products);
          }
        })
        .catch((error) => {
          logger.warn('Öneri kataloğu okunamadı', { error });
          if (active) {
            if (__DEV__) preparationDiagnosticState.current.catalogReady = true;
            setRecommendationCatalog([]);
          }
        });
      return () => {
        active = false;
      };
    }, [feedStatus]),
  );

  const [wardrobeForRecommendations, setWardrobeForRecommendations] = useState<{
    userId: string | null;
    items: WardrobeItemForCandidate[];
  }>({ userId: null, items: [] });
  const missingWardrobeTable = useRef(false);
  const clearWardrobeRecommendations = useCallback((owner: string | null) => {
    setWardrobeForRecommendations(previous => previous.userId === owner && previous.items.length === 0
      ? previous : { userId: owner, items: [] });
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (__DEV__) preparationDiagnosticState.current.wardrobeReady = false;
      if (userId === null || missingWardrobeTable.current) {
        if (__DEV__) preparationDiagnosticState.current.wardrobeReady = true;
        clearWardrobeRecommendations(userId);
        return () => {
          active = false;
        };
      }

      const client = getSupabaseClient();
      if (client === null) {
        if (__DEV__) preparationDiagnosticState.current.wardrobeReady = true;
        clearWardrobeRecommendations(userId);
        return () => {
          active = false;
        };
      }

      void (async () => {
        try {
          const { data, error } = await client
            .from('wardrobe_items')
            .select('*')
            .eq('user_id', userId);
          if (error) throw error;
          const items = ((data ?? []) as unknown[]).filter(
            (row): row is WardrobeItemForCandidate => {
              if (typeof row !== 'object' || row === null) return false;
              const item = row as Record<string, unknown>;
              return (
                typeof item.id === 'string' && typeof item.category === 'string'
              );
            },
          );
          if (active) {
            if (__DEV__) preparationDiagnosticState.current.wardrobeReady = true;
            setWardrobeForRecommendations({ userId, items });
          }
        } catch (error) {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'PGRST205') {
            missingWardrobeTable.current = true;
            logger.debug('Dolap backend tablosu API’de kullanılamıyor; öneriler katalogla devam ediyor');
          } else {
            logger.warn('Dolap parçaları öneriler için okunamadı', { error });
          }
          if (active) {
            if (__DEV__) preparationDiagnosticState.current.wardrobeReady = true;
            clearWardrobeRecommendations(userId);
          }
        }
      })();
      return () => {
        active = false;
      };
    }, [userId, clearWardrobeRecommendations]),
  );

  const recommendationSession = useMemo(() => new DiscoverRecommendationCache(recommendationCatalog,
    wardrobeForRecommendations.userId === userId ? wardrobeForRecommendations.items : [], userId),
    [recommendationCatalog, userId, wardrobeForRecommendations]);
  const [recommendationRevision, publishRecommendations] = useState(0);
  const recommendationFocused = useRef(false);
  const preparationInputs = useRef({ session: recommendationSession, products: currentProducts, feedStatus, feedPreparationRevision });
  useLayoutEffect(() => {
    if (__DEV__) {
      discoverPrefetchTrace(recommendationSession).bind(recommendationSession, feedPreparationRevision);
      discoverPrefetchTrace(recommendationSession).feedUpdate(currentProducts, feedPreparationRevision);
    }
    preparationInputs.current = { session: recommendationSession, products: currentProducts, feedStatus, feedPreparationRevision };
    recommendationSession.setPreparationWindow(currentProducts);
    if (recommendationFocused.current && currentProduct) recommendationSession.activate(currentProduct);
  }, [recommendationSession, currentProducts, currentProduct, feedStatus, recommendationRevision, feedPreparationRevision]);
  const prefetchedCovers = useRef(new Set<string>());
  useFocusEffect(useCallback(() => {
    recommendationFocused.current = true;
    const controller = new AbortController();
    let workerRequested = false;
    let unsubscribeColdStart = () => {};
    const startPreparation = () => {
      if (workerRequested || controller.signal.aborted || !recommendationFocused.current ||
        preparationInputs.current.session !== recommendationSession) return;
      const latest = preparationInputs.current;
      if (__DEV__) {
        const trace = discoverPrefetchTrace(recommendationSession);
        trace.bind(recommendationSession, latest.feedPreparationRevision);
        trace.effectEntered(latest.products, {
          feedStatus, catalogLength: recommendationSession.catalog.length,
          catalogReady: preparationDiagnosticState.current.catalogReady,
          currentProductsLength: latest.products.length, anchorIds: latest.products.slice(0, 3).map(product => product.id),
          isFocused: recommendationFocused.current, userIdPresent: userId !== null,
          wardrobeUserId: wardrobeForRecommendations.userId === null ? null : instrumentationContextId(wardrobeForRecommendations.userId),
          wardrobeReady: preparationDiagnosticState.current.wardrobeReady,
          wardrobeMatchesUser: wardrobeForRecommendations.userId === userId,
          signalAborted: controller.signal.aborted,
        });
      }
      if (feedStatus === 'success' && recommendationSession.catalog.length > 0 &&
        (userId === null || wardrobeForRecommendations.userId === userId)) {
        const anchors = [...latest.products];
        if (anchors.length > 0) {
          workerRequested = true;
          unsubscribeColdStart();
        }
        if (latest.products[0]) recommendationSession.activate(latest.products[0]);
        const request = recommendationSession.request(anchors, latest.feedPreparationRevision);
        if (__DEV__) discoverPrefetchTrace(recommendationSession).diagnostic('workerStartAttempt', {
          workerStartAttempt: true, anchorCount: anchors.length, signalAborted: controller.signal.aborted });
        void loadDiscoverRecommendationPacket(request, userId, controller.signal, packet => {
          if (controller.signal.aborted || !recommendationFocused.current || preparationInputs.current.session !== recommendationSession) return;
          if (!recommendationSession.accept(packet, preparationInputs.current.products)) return;
          const active = preparationInputs.current.products[0];
          if (active) recommendationSession.activate(active);
          publishRecommendations(revision => revision + 1);
          const imageUrls = [...new Set(preparationInputs.current.products.flatMap(product => complementaryProductsForDisplay(
            recommendationSession.peekPrepared(product) ?? EMPTY_RECOMMENDATIONS, product.id).flatMap(recommended => getProductImages(recommended).slice(0, 1))))]
            .filter(url => !prefetchedCovers.current.has(url));
          if (imageUrls.length > 0) {
            imageUrls.forEach(url => prefetchedCovers.current.add(url));
            void Image.prefetch(imageUrls, { cachePolicy: 'memory-disk' }).catch(() => {
              imageUrls.forEach(url => prefetchedCovers.current.delete(url));
            });
          }
        }, recommendationSession).catch(error => {
          if (__DEV__) discoverPrefetchTrace(recommendationSession).diagnostic('workerStartBlocked', {
            workerStartBlocked: true, blockedReason: controller.signal.aborted ? 'ABORTED' : 'WORKER_START_ERROR' });
          if (!controller.signal.aborted) logger.warn('Recommendation cache paketi okunamadı', { error });
        });
      }
    };
    // A NO_ANCHORS request installs no worker. Retry only that cold-start gap;
    // once requested, the existing worker owns all window/append notifications.
    unsubscribeColdStart = recommendationSession.subscribePreparation(() => {
      if (preparationInputs.current.products.length > 0) startPreparation();
    });
    startPreparation();
    return () => {
      unsubscribeColdStart();
      recommendationFocused.current = false;
      if (__DEV__) discoverPrefetchTrace(recommendationSession).closeReason =
        preparationInputs.current.session !== recommendationSession ? 'context_changed'
          : preparationInputs.current.feedStatus !== 'success' ? 'feed_invalidated' : 'focus_lost';
      if (__DEV__) discoverPrefetchTrace(recommendationSession).diagnostic('effectCleanup', {
        reason: discoverPrefetchTrace(recommendationSession).closeReason, signalAborted: controller.signal.aborted });
      controller.abort();
    };
    // Context/focus own the request. Appending feed anchors does not invalidate it.
    // Window promotion only reprioritizes
    // its existing preparation queue; exposure refresh reuses prepared ranking.
  }, [recommendationSession, feedStatus, userId, wardrobeForRecommendations.userId]));
  useEffect(() => {
    if (__DEV__) discoverPrefetchTrace(recommendationSession).productsObserved(currentProducts, feedPreparationRevision);
  }, [recommendationSession, currentProducts, feedPreparationRevision]);

  const selectedRecommendationProductIds = useMemo(
    () => likedProducts.map(item => item.product.id), [likedProducts],
  );

  const [feedQuery, setFeedQuery] = useState<FeedQuery>(EMPTY_FEED_QUERY);
  const [searchInput, setSearchInput] = useState('');
  const [isSearchInputOpen, setIsSearchInputOpen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (isSearchInputOpen) searchInputRef.current?.focus();
    else searchInputRef.current?.blur();
  }, [isSearchInputOpen]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
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

  useFocusEffect(useCallback(() => {
    if (feedStatus === 'success' && hasMore && !isFetchingNext && currentProducts.length <= 5) {
      void loadMoreFeed();
    }
  }, [currentProducts.length, feedStatus, hasMore, isFetchingNext, loadMoreFeed]));

  // The visible card mounts its current/neighbor images itself; only warm the next covers.
  useFocusEffect(useCallback(() => {
    const urls: string[] = [];
    const next = nextProduct;
    if (next) {
      const first = getProductImages(next)[0];
      if (first) {
        urls.push(first);
      }
    }
    const warm = warmProduct;
    if (warm) {
      const first = getProductImages(warm)[0];
      if (first) {
        urls.push(first);
      }
    }
    const unique = Array.from(new Set(urls)).filter(
      (url): url is string => typeof url === 'string' && url.length > 0 && !prefetchedCovers.current.has(url),
    );
    if (unique.length === 0) {
      return;
    }
    const handle = requestIdleCallback(() => {
      const pending = unique.filter(url => !prefetchedCovers.current.has(url));
      if (pending.length === 0) return;
      pending.forEach(url => prefetchedCovers.current.add(url));
      void Image.prefetch(pending).catch(() => pending.forEach(url => prefetchedCovers.current.delete(url)));
    });
    return () => cancelIdleCallback(handle);
  }, [nextProduct, warmProduct]));

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
        if (__DEV__) {
          const products = useAppStore.getState?.().currentProducts ?? preparationInputs.current.products;
          discoverPrefetchTrace(preparationInputs.current.session).recordSwipe(
            preparationInputs.current.session, product, products[1]);
        }
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
      const parsed = parseSearchQuery(trimmed, {
        brands: DEFAULT_SEARCH_BRANDS,
      });
      // Merge with panel-only facets that NL didn't set? Prefer NL as full replace
      // of searchable state so bar + panel stay one source after commit.
      const next = feedQueryFromFilters(parsed.filters);
      applyFeedQuery(next, { inputText: trimmed });
      track('search', null, {
        query: trimmed,
        category: parsed.filters.category ?? null,
        color: parsed.filters.color ?? null,
        result_count: null,
      });
    },
    [applyFeedQuery],
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
  }, [
    topProductId,
    deckPoseKey,
    estimatedH,
    deckPages,
    dragOffset,
    pageHeight,
  ]);

  const hasDeck = currentProducts.length > 0;
  // Katalogda ürün var ama hepsi beğenildi/geçildi: tekrar yüklemek işe yaramaz.
  const isCatalogExhausted = !hasDeck && hasMore === false && seenCount > 0;
  const isLoading = feedStatus === 'loading' || feedStatus === 'idle' || (!hasDeck && isFetchingNext);
  const isSearchMode = feedQuery.mode === 'search';
  const activeFilterCount = countActiveFilters(feedQuery.filters);
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
          paddingTop: 0,
        },
      ]}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop:
              (insets.top > 0 ? insets.top : layout.statusBarFallback) +
              layout.headerPaddingTop,
          },
        ]}
      >
        <View style={styles.segmentWrap}>
          <FeedModeSegment
            value={feedMode}
            onChange={handleFeedModeChange}
            overlay
        />
        <View style={styles.headerActions}>
          <PressableScale
            onPress={() => {
              setIsSearchInputOpen(open => !open);
            }}
            style={styles.filterHit}
            accessibilityRole="button"
            accessibilityLabel="Aramayı aç"
            accessibilityState={{ expanded: isSearchInputOpen }}
          >
            <Search color={colors.inverseText} size={24} />
          </PressableScale>
          <PressableScale
            onPress={() => setIsFilterOpen(true)}
            style={styles.filterHit}
            accessibilityRole="button"
            accessibilityLabel="Filtreler"
          >
            <SlidersHorizontal color={colors.inverseText} size={21} />
            {activeFilterCount > 0 ? <View style={styles.filterDot} /> : null}
          </PressableScale>
        </View>
        <View style={[styles.searchBar, !isSearchInputOpen && styles.searchClosed]} pointerEvents={isSearchInputOpen ? 'auto' : 'none'}>
          <TextInput
            ref={searchInputRef}
            value={searchInput}
            onChangeText={handleSearchChange}
            onSubmitEditing={() => commitSearchText(searchInput)}
            placeholder="Ne arıyorsun?"
            placeholderTextColor={colors.inverseText}
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
              <X color={colors.inverseText} size={16} />
            </PressableScale>
          ) : null}
        </View>
        </View>
        {isSearchMode && showSearchBanner && searchBannerText ? (
          <View style={styles.searchMetaBlock}>
            <View style={styles.fallbackBanner}>
              <Text style={styles.fallbackBannerText}>{searchBannerText}</Text>
            </View>
          </View>
        ) : null}
      </View>
      <View
        style={[
          styles.body,
          {
            paddingBottom:
              !isLoading && hasDeck
                ? 0
                : layout.deckPadding + discoverCardLiftPx,
          },
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
                  recommendations={recommendationSession.lookup(product) ?? EMPTY_RECOMMENDATIONS}
                  selectedRecommendationProductIds={selectedRecommendationProductIds}
                  onSelectRecommendation={canLike ? handleSwipeRight : handleRequireAuth}
                />
              ))}
            </View>
          </View>
        )}
      </View>
      {hintStatus === 'visible' && !isLoading && !isSearchMode && hasDeck ? (
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    zIndex: HEADER_Z_INDEX,
  },
  searchBar: {
    position: 'absolute',
    right: FILTER_HIT_SIZE * 2 + spacing.sm + spacing.xs,
    top: (FILTER_HIT_SIZE - 36) / 2,
    width: '30%',
    maxWidth: 120,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.inverseText,
    marginBottom: 0,
    zIndex: 6,
  },
  segmentWrap: {
    alignItems: 'flex-start',
  },
  headerActions: {
    position: 'absolute',
    right: 0,
    top: (layout.segmentHeight - FILTER_HIT_SIZE) / 2,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  searchClosed: {
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    color: colors.inverseText,
    fontSize: 14,
    paddingVertical: 0,
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
    justifyContent: 'flex-start',
  },
  clearHit: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: colors.bg,
  },
  deck: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.bg,
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
