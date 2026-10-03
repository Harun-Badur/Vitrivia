import type { StateCreator } from 'zustand';
import { track } from '../lib/analytics';
import { logger } from '../lib/logger';
import { recordSessionProductAction } from '../lib/sessionIntent';
import {
  deleteLikedProduct,
  fetchLikedProducts,
  insertLikedProduct,
  updateLikedProductAlert,
} from '../services/likeService';
import type { LikedProduct, Product } from '../types/product';
import type { AppState } from './useAppStore';
import { removeProduct, restoreProduct } from './productState';

export interface LikeAlertPatch {
  notifyOnPriceDrop: boolean;
}

export interface FavoritesSlice {
  likedProducts: LikedProduct[];
  addLikedProductLocally: (product: Product) => void;
  swipeRight: (product: Product) => void;
  unlikeProduct: (productId: string) => Promise<void>;
  updateLikeAlert: (productId: string, patch: LikeAlertPatch) => Promise<void>;
  refreshLikedProducts: () => Promise<void>;
}

const removeLiked = (
  products: LikedProduct[],
  productId: string,
): LikedProduct[] =>
  products.filter((item) => item.product.id !== productId);

const prependLikedUnique = (
  products: LikedProduct[],
  product: Product,
): LikedProduct[] => {
  if (products.some((item) => item.product.id === product.id)) {
    return products;
  }
  // Server results are ordered by liked_at descending.
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

export const createFavoritesSlice: StateCreator<AppState, [], [], FavoritesSlice> =
  (set, get) => ({
    likedProducts: [],
    addLikedProductLocally: (product): void => {
      set((state) => {
        if (state.likedProducts.some((item) => item.product.id === product.id)) {
          return state;
        }
        return {
          likedProducts: prependLikedUnique(state.likedProducts, product),
        };
      });
    },
    swipeRight: (product): void => {
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
    unlikeProduct: async (productId): Promise<void> => {
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
  });
