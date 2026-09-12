import { create } from 'zustand';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import { logger } from '../lib/logger';
import { track } from '../lib/analytics';
import { recordSessionProductAction, resetSessionIntent } from '../lib/sessionIntent';
import { setLastFeedMode } from '../lib/recsFeedState';
import type { FeedQueryFilters } from '../lib/feedQuery';
import { hasAnyFilter } from '../lib/feedQuery';
import {
  fetchFeedProducts,
  type FeedSource,
} from '../services/productService';
import {
  deleteLikedProduct,
  fetchLikedProducts,
  fetchPassedProductIds,
  insertLikedProduct,
  insertPassedProduct,
  updateLikedProductAlert,
} from '../services/likeService';
import type { LikedProduct, Product } from '../types/product';
import type { FeedMode } from '../types/recommendation';
import { DEFAULT_FEED_MODE } from '../types/recommendation';

export type FeedStatus = 'idle' | 'loading' | 'error' | 'success';
export type SessionSyncStatus = 'idle' | 'loading' | 'error' | 'success';

export interface LikeAlertPatch {
  notifyOnPriceDrop: boolean;
}

const FEED_LIMIT = 20;

interface AppState {
  currentProducts: Product[];
  likedProducts: LikedProduct[];
  passedProductIds: string[];
  passedStack: Product[];
  feedStatus: FeedStatus;
  feedSource: FeedSource | null;
  feedIsPersonalized: boolean;
  feedMode: FeedMode;
  feedFallback: boolean;
  sessionUserId: string | null;
  sessionSyncStatus: SessionSyncStatus;
  loadFeed: (
    userId: string | null,
    options?: {
      filters?: FeedQueryFilters;
      searchMode?: boolean;
    },
  ) => Promise<void>;
  setFeedMode: (mode: FeedMode) => void;
  hydrateSession: (userId: string) => Promise<void>;
  resetSession: () => void;
  swipeRight: (product: Product) => void;
  swipeLeft: (product: Product) => void;
  undoPass: () => boolean;
  unlikeProduct: (productId: string) => Promise<void>;
  updateLikeAlert: (productId: string, patch: LikeAlertPatch) => Promise<void>;
  refreshLikedProducts: () => Promise<void>;
}

const removeProduct = (products: Product[], productId: string): Product[] =>
  products.filter((item) => item.id !== productId);

const removeLiked = (
  products: LikedProduct[],
  productId: string,
): LikedProduct[] =>
  products.filter((item) => item.product.id !== productId);

/**
 * Sunucu yazımı başarısız olan ürünü desteye geri koyar. Araya giren diğer
 * swipe'lar korunsun diye dizinin tamamı snapshot'a döndürülmez.
 */
const restoreProduct = (products: Product[], product: Product): Product[] =>
  products.some((item) => item.id === product.id)
    ? products
    : [product, ...products];

const prependLikedUnique = (
  products: LikedProduct[],
  product: Product,
): LikedProduct[] => {
  if (products.some((item) => item.product.id === product.id)) {
    return products;
  }
  // Liste sunucuda liked_at'e göre azalan sıralı geldiği için en yeni beğeni başa.
  return [
    {
      product,
      notifyOnPriceDrop: true,
      likedAt: new Date().toISOString(),
    },
    ...products,
  ];
};

const insertLikedAt = (
  products: LikedProduct[],
  index: number,
  item: LikedProduct,
): LikedProduct[] => {
  if (products.some((existing) => existing.product.id === item.product.id)) {
    return products;
  }
  const next = [...products];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
};

const appendUniqueId = (ids: string[], productId: string): string[] => {
  if (ids.includes(productId)) {
    return ids;
  }
  return [...ids, productId];
};

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

const excludeSeen = (
  products: Product[],
  likedProducts: LikedProduct[],
  passedProductIds: string[],
): Product[] => {
  const seen = new Set([
    ...likedProducts.map((item) => item.product.id),
    ...passedProductIds,
  ]);
  return products.filter((item) => !seen.has(item.id));
};

export const useAppStore = create<AppState>((set, get) => ({
  currentProducts: [],
  likedProducts: [],
  passedProductIds: [],
  passedStack: [],
  feedStatus: 'idle',
  feedSource: null,
  feedIsPersonalized: false,
  feedMode: DEFAULT_FEED_MODE,
  feedFallback: false,
  sessionUserId: null,
  sessionSyncStatus: 'idle',
  // userId çağıran ekrandan geçer: feed effect'i kök layout'un hidrasyonundan
  // önce koştuğu için sessionUserId burada henüz null olabiliyor.
  loadFeed: async (
    userId: string | null,
    options?: {
      filters?: FeedQueryFilters;
      searchMode?: boolean;
    },
  ): Promise<void> => {
    set({ feedStatus: 'loading' });
    try {
      const filters = options?.filters ?? {};
      const searchMode =
        options?.searchMode === true || hasAnyFilter(filters);
      const result = await fetchFeedProducts(
        FEED_LIMIT,
        userId,
        get().feedMode,
        filters,
        searchMode ? 'search' : get().feedMode,
      );
      logger.debug('Feed yüklendi', {
        source: result.source,
        isPersonalized: result.isPersonalized,
        fallback: result.fallback === true,
        searchMode,
      });
      set((state) => ({
        currentProducts: excludeSeen(
          result.products,
          state.likedProducts,
          state.passedProductIds,
        ),
        feedStatus: 'success',
        feedSource: result.source,
        feedIsPersonalized: result.isPersonalized,
        feedFallback: result.fallback === true,
      }));
    } catch (error) {
      logger.error('Feed yüklenemedi; mock ürünlere düşülüyor.', { error });
      set((state) => ({
        currentProducts: excludeSeen(
          MOCK_PRODUCTS,
          state.likedProducts,
          state.passedProductIds,
        ),
        feedStatus: 'error',
        feedSource: 'mock',
        feedIsPersonalized: false,
        feedFallback: false,
      }));
    }
  },
  setFeedMode: (mode: FeedMode): void => {
    setLastFeedMode(mode);
    set({ feedMode: mode });
  },
  hydrateSession: async (userId: string): Promise<void> => {
    set({ sessionUserId: userId, sessionSyncStatus: 'loading' });
    try {
      const [likedProducts, passedIds] = await Promise.all([
        fetchLikedProducts(userId),
        fetchPassedProductIds(userId),
      ]);
      set((state) => ({
        likedProducts,
        passedProductIds: passedIds,
        sessionSyncStatus: 'success',
        currentProducts: excludeSeen(
          state.currentProducts,
          likedProducts,
          passedIds,
        ),
      }));
    } catch (error) {
      logger.error('Oturum verisi yüklenemedi', { error });
      set({ sessionSyncStatus: 'error' });
    }
  },
  resetSession: (): void => {
    setLastFeedMode(DEFAULT_FEED_MODE);
    set({
      sessionUserId: null,
      sessionSyncStatus: 'idle',
      likedProducts: [],
      passedProductIds: [],
      passedStack: [],
      feedIsPersonalized: false,
      feedMode: DEFAULT_FEED_MODE,
      feedFallback: false,
    });
    resetSessionIntent();
  },
  swipeRight: (product: Product): void => {
    const userId = get().sessionUserId;

    set((state) => ({
      currentProducts: removeProduct(state.currentProducts, product.id),
      likedProducts: prependLikedUnique(state.likedProducts, product),
      passedProductIds: state.passedProductIds.filter(
        (id) => id !== product.id,
      ),
      passedStack: state.passedStack.filter((item) => item.id !== product.id),
    }));

    if (!userId) {
      logger.warn('Beğeni için oturum yok; kayıt yazılmadı.', {
        productId: product.id,
      });
      return;
    }

    track('like', product.id, { source: 'feed' });
    track('dolap_add', product.id, { source: 'feed' });
    recordSessionProductAction('like', product);
    recordSessionProductAction('dolap_add', product);

    void insertLikedProduct(userId, product).catch((error: unknown) => {
      logger.error('Beğeni yazılamadı, geri alınıyor', {
        error,
        productId: product.id,
      });
      set((state) => ({
        currentProducts: restoreProduct(state.currentProducts, product),
        likedProducts: removeLiked(state.likedProducts, product.id),
      }));
    });
  },
  swipeLeft: (product: Product): void => {
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
  unlikeProduct: async (productId: string): Promise<void> => {
    const { likedProducts, sessionUserId: userId } = get();
    const removedIndex = likedProducts.findIndex(
      (item) => item.product.id === productId,
    );
    const removed = likedProducts[removedIndex];

    set((state) => ({
      likedProducts: removeLiked(state.likedProducts, productId),
    }));

    if (!userId || !removed) {
      return;
    }

    try {
      await deleteLikedProduct(userId, productId);
    } catch (error) {
      logger.error('Beğeni silinemedi, geri alınıyor', { error, productId });
      set((state) => ({
        likedProducts: insertLikedAt(
          state.likedProducts,
          removedIndex,
          removed,
        ),
      }));
      throw error;
    }
  },
  updateLikeAlert: async (
    productId: string,
    patch: LikeAlertPatch,
  ): Promise<void> => {
    const { likedProducts, sessionUserId: userId } = get();
    const target = likedProducts.find((item) => item.product.id === productId);

    if (!target) {
      return;
    }

    const previousValue = target.notifyOnPriceDrop;
    const applyNotify = (value: boolean) => (state: AppState) => ({
      likedProducts: state.likedProducts.map((item) =>
        item.product.id === productId
          ? { ...item, notifyOnPriceDrop: value }
          : item,
      ),
    });

    set(applyNotify(patch.notifyOnPriceDrop));

    if (!userId) {
      return;
    }

    try {
      await updateLikedProductAlert({
        userId,
        productId,
        notifyOnPriceDrop: patch.notifyOnPriceDrop,
      });
    } catch (error) {
      logger.error('Fiyat alarmı geri alındı', { error, productId });
      set(applyNotify(previousValue));
      throw error;
    }
  },
  refreshLikedProducts: async (): Promise<void> => {
    const userId = get().sessionUserId;
    if (!userId) {
      return;
    }
    try {
      const likedProducts = await fetchLikedProducts(userId);
      set({ likedProducts, sessionSyncStatus: 'success' });
    } catch (error) {
      logger.error('Beğeniler yenilenemedi', { error });
      throw error;
    }
  },
}));
