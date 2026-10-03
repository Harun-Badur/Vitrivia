import type { StateCreator } from 'zustand';
import { track } from '../lib/analytics';
import { hasAnyFilter, type FeedQueryFilters } from '../lib/feedQuery';
import { logger } from '../lib/logger';
import { setLastFeedMode } from '../lib/recsFeedState';
import { recordSessionProductAction } from '../lib/sessionIntent';
import { insertPassedProduct } from '../services/likeService';
import { fetchFeedProducts, type FeedSource } from '../services/productService';
import type { Product } from '../types/product';
import { DEFAULT_FEED_MODE, type FeedMode } from '../types/recommendation';
import type { AppState } from './useAppStore';
import { excludeSeen, removeProduct, restoreProduct } from './productState';

export type FeedStatus = 'idle' | 'loading' | 'error' | 'success';

export interface DiscoverySlice {
  currentProducts: Product[];
  passedProductIds: string[];
  passedStack: Product[];
  feedStatus: FeedStatus;
  feedSource: FeedSource | null;
  feedIsPersonalized: boolean;
  feedMode: FeedMode;
  feedFallback: boolean;
  feedRelaxed: string[];
  hasMore: boolean;
  isFetchingNext: boolean;
  /** Advances only when a fetched batch is accepted, never on swipe/undo. */
  feedPreparationRevision: number;
  loadMoreFeed: () => Promise<void>;
  loadFeed: (
    userId: string | null,
    options?: { filters?: FeedQueryFilters; searchMode?: boolean },
  ) => Promise<void>;
  setFeedMode: (mode: FeedMode) => void;
  swipeLeft: (product: Product) => void;
  undoPass: () => boolean;
}

const FEED_LIMIT = 20;

const appendUniqueId = (ids: string[], productId: string): string[] =>
  ids.includes(productId) ? ids : [...ids, productId];

const pushPassedProduct = (stack: Product[], product: Product): Product[] => {
  const without = stack.filter((item) => item.id !== product.id);
  return [...without, product];
};

const popPassedProduct = (
  stack: Product[],
): { stack: Product[]; product: Product | null } => {
  if (stack.length === 0) {
    return { stack, product: null };
  }
  const product = stack[stack.length - 1];
  if (product === undefined) {
    return { stack: [], product: null };
  }
  return { stack: stack.slice(0, -1), product };
};

export const createDiscoverySlice: StateCreator<AppState, [], [], DiscoverySlice> =
  (set, get) => {
    let generation = 0;
    let context: { userId: string | null; filters: FeedQueryFilters; searchMode: boolean } | null = null;
    let deliveredIds = new Set<string>();
    const excludedIds = (): string[] => [...new Set([
      ...deliveredIds,
      ...get().currentProducts.map(product => product.id),
      ...get().likedProducts.map(item => item.product.id),
      ...get().passedProductIds,
    ])];
    return ({
    currentProducts: [],
    passedProductIds: [],
    passedStack: [],
    feedStatus: 'idle',
    feedSource: null,
    feedIsPersonalized: false,
    feedMode: DEFAULT_FEED_MODE,
    feedFallback: false,
    feedRelaxed: [],
    hasMore: true,
    isFetchingNext: false,
    feedPreparationRevision: 0,
    // The caller passes userId because the feed effect can run before session hydration.
    loadFeed: async (userId, options): Promise<void> => {
      const requestGeneration = ++generation;
      deliveredIds = new Set();
      const filters = options?.filters ?? {};
      const searchMode = options?.searchMode === true || hasAnyFilter(filters);
      context = { userId, filters, searchMode };
      set({ feedStatus: 'loading', hasMore: true, isFetchingNext: false });
      try {
        const result = await fetchFeedProducts(
          FEED_LIMIT,
          userId,
          get().feedMode,
          filters,
          searchMode ? 'search' : get().feedMode,
          [...new Set([...get().likedProducts.map(item => item.product.id), ...get().passedProductIds])],
        );
        if (requestGeneration !== generation) return;
        deliveredIds = new Set(result.products.map(product => product.id));
        logger.debug('Feed yüklendi', {
          source: result.source,
          isPersonalized: result.isPersonalized,
          fallback: result.fallback === true,
          relaxed: result.relaxed ?? [],
          searchMode,
        });
        set((state) => ({
          currentProducts: excludeSeen(
            [...new Map(result.products.map(product => [product.id, product])).values()],
            state.likedProducts,
            state.passedProductIds,
          ),
          feedStatus: 'success',
          feedPreparationRevision: state.feedPreparationRevision + 1,
          feedSource: result.source,
          feedIsPersonalized: result.isPersonalized,
          feedFallback: result.fallback === true,
          feedRelaxed: result.relaxed ?? [],
          hasMore: result.hasMore ?? true,
        }));
      } catch (error) {
        if (requestGeneration !== generation) return;
        logger.error('Feed yüklenemedi.', { error });
        set({
          feedStatus: 'error',
          feedIsPersonalized: false,
          feedFallback: false,
          feedRelaxed: [],
        });
      }
    },
    loadMoreFeed: async (): Promise<void> => {
      if (!context || !get().hasMore || get().isFetchingNext || get().feedStatus !== 'success') return;
      const requestGeneration = generation;
      const { userId, filters, searchMode } = context;
      const excluded = excludedIds();
      set({ isFetchingNext: true });
      try {
        const result = await fetchFeedProducts(FEED_LIMIT, userId, get().feedMode, filters,
          searchMode ? 'search' : get().feedMode, excluded);
        if (requestGeneration !== generation) return;
        const alreadyDelivered = new Set(excluded);
        const incoming = result.products.filter(product => {
          if (alreadyDelivered.has(product.id)) return false;
          alreadyDelivered.add(product.id);
          deliveredIds.add(product.id);
          return true;
        });
        set(state => ({
          currentProducts: [...state.currentProducts, ...excludeSeen(incoming, state.likedProducts, state.passedProductIds)],
          feedPreparationRevision: state.feedPreparationRevision + 1,
          hasMore: result.hasMore ?? incoming.length > 0,
          isFetchingNext: false,
        }));
      } catch (error) {
        if (requestGeneration !== generation) return;
        logger.warn('Feed sonraki batch yüklenemedi', { error });
        // Preserve both the existing deck and continuation; a network error is not exhaustion.
        set({ isFetchingNext: false, feedStatus: 'error' });
      }
    },
    setFeedMode: (mode): void => {
      setLastFeedMode(mode);
      set({ feedMode: mode });
    },
    swipeLeft: (product): void => {
      const userId = get().sessionUserId;

      set((state) => ({
        currentProducts: removeProduct(state.currentProducts, product.id),
        passedProductIds: appendUniqueId(state.passedProductIds, product.id),
        passedStack: pushPassedProduct(state.passedStack, product),
      }));

      if (!userId) {
        return;
      }

      track('pass', product.id, { source: 'feed' });
      recordSessionProductAction('pass', product);

      void insertPassedProduct(userId, product).catch((error: unknown) => {
        logger.error('Geçme yazılamadı, geri alınıyor', {
          error,
          productId: product.id,
        });
        set((state) => ({
          currentProducts: restoreProduct(state.currentProducts, product),
          passedProductIds: state.passedProductIds.filter(
            (id) => id !== product.id,
          ),
          passedStack: state.passedStack.filter((item) => item.id !== product.id),
        }));
      });
    },
    undoPass: (): boolean => {
      const { stack, product } = popPassedProduct(get().passedStack);
      if (product === null) {
        return false;
      }

      set((state) => ({
        currentProducts: restoreProduct(state.currentProducts, product),
        passedProductIds: state.passedProductIds.filter((id) => id !== product.id),
        passedStack: stack,
      }));

      return true;
    },
    });
  };
