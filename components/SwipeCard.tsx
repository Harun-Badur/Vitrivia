import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Heart, ShoppingBag, Sparkles } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { logger } from '../lib/logger';
import {
  CARD_SPRING_BACK,
  CARD_THROW_SPRING,
  PAN_ACTIVE_OFFSET_Y_PX,
  PAN_FAIL_OFFSET_X_PX,
  shouldCommitPass,
  shouldCommitUndo,
} from '../lib/motion';
import { IMPRESSION_MIN_DWELL_MS } from '../types/analytics';
import {
  colors,
  estimateDiscoverCardHeight,
  layout,
  radius,
  shadows,
  spacing,
} from '../lib/theme';
import {
  formatTryPrice,
  GARMENT_CATEGORY_LABEL,
  getDisplayPrice,
  getDropPercent,
  getProductImages,
  hasCatalogPriceDrop,
  type Product,
} from '../types/product';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const DOUBLE_TAP_MAX_DISTANCE_PX = 16;
const DOUBLE_TAP_MAX_DURATION_MS = 280;
const HEART_BURST_IN_MS = 160;
const HEART_BURST_OUT_MS = 260;
const HEART_BURST_PEAK_SCALE = 1.18;
/** Soft crossfade when bitmap arrives; pairs with surface placeholder (no white flash). */
const IMAGE_CROSSFADE_MS = 0;
const IMAGE_PREFETCH_CAP = 6;
const ACTION_ICON_SIZE = 16;
const REASON_ICON_SIZE = 12;
/** Horizontal gallery: activate after 6px X; fail if 12px Y first (card vertical wins). */
const IMAGE_SWIPE_ACTIVE_OFFSET_X_PX = 6;
const IMAGE_SWIPE_FAIL_OFFSET_Y_PX = 12;
/** End rubber-band: excess translation ×0.3 at first/last index. */
const IMAGE_RUBBER_BAND = 0.3;
/** Release commit: |vX| > 500 or |tX| > width×0.25 → change index. */
const IMAGE_COMMIT_VELOCITY_X = 500;
const IMAGE_COMMIT_DISTANCE_RATIO = 0.25;
/** Snap settle — withTiming 180ms (not spring). */
const IMAGE_SNAP_DURATION_MS = 180;
const IMAGE_DOT_SIZE = 7;
const IMAGE_DOT_GAP = 6;
const IMAGE_DOT_TRANSITION_MS = 120;
/** object-position: top-center — tam boy kadraj (hedef oran ~0.68). */
const IMAGE_CONTENT_POSITION = { top: 0, left: '50%' } as const;

/** Ekran kökünün 16px yatay padding’iyle aynı grid; ekstra inset yok. */
const CARD_WIDTH = SCREEN_WIDTH - spacing.lg * 2;
const CARD_HEIGHT = estimateDiscoverCardHeight(SCREEN_HEIGHT);

/** Persists gallery index across unmount so undo restores the same image. */
const imageIndexByProductId = new Map<string, number>();

export type { Product };

/** Sayfa indeksi: -1 = prev, 0 = current, +1 = next. */
export type PageIndex = -1 | 0 | 1 | 2;

export interface SwipeCardProps {
  product: Product;
  /** Relatif sayfa: -1 prev, 0 current, +1 next, +2 warm-up. */
  pageIndex: PageIndex;
  /** Deck onLayout ile ölçülen viewport yüksekliği H. */
  pageHeight: SharedValue<number>;
  /** Ortak sürükleme ofseti; commit sonrası parent 0'a baslar. */
  dragOffset: SharedValue<number>;
  onAddToCloset: (product: Product) => void;
  /** Pass throw settle sonrası tek store reconcile. */
  onPass: (product: Product) => void;
  onVirtualTryOn: (product: Product) => void;
  onBuy: (product: Product) => void;
  /** Undo settle sonrası tek store reconcile. */
  onUndoPass?: () => void;
  onRequireAuth?: () => void;
  onImpression: (product: Product, dwellMs: number) => void;
  canLike?: boolean;
  canUndo?: boolean;
  /** Parent registry fill (render-time) for atomic pose batch. */
  registerPageIndexSV?: (productId: string, sv: SharedValue<number>) => void;
  /** Parent registry delete on unmount. */
  unregisterPageIndexSV?: (productId: string) => void;
}

const formatPrice = (product: Product): string =>
  formatTryPrice(getDisplayPrice(product));

function GalleryDot({ active }: { active: boolean }) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: IMAGE_DOT_TRANSITION_MS });
  }, [active, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.5, 1]),
    transform: [
      {
        scale: interpolate(progress.value, [0, 1], [1, 1.2]),
      },
    ],
  }));

  return <Animated.View style={[styles.galleryDot, animatedStyle]} />;
}


function SwipeCard({
  product,
  pageIndex,
  pageHeight,
  dragOffset,
  onAddToCloset,
  onPass,
  onVirtualTryOn,
  onBuy,
  onUndoPass,
  onRequireAuth,
  onImpression,
  canLike = true,
  canUndo = false,
  registerPageIndexSV,
  unregisterPageIndexSV,
}: SwipeCardProps) {

  const isCurrent = pageIndex === 0;
  /** Pose slot index — parent atomically writes on deck remap; do not sync from React. */
  const pageIndexSV = useSharedValue<number>(pageIndex);
  // Register during render so parent useLayoutEffect sees SVs before paint.
  registerPageIndexSV?.(product.id, pageIndexSV);
  const [hasImageError, setHasImageError] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const imageCachedRef = useRef(false);

  const imagesKey =
    Array.isArray(product.images) && product.images.length > 0
      ? product.images.join('|')
      : product.imageUrl;
  const images = useMemo(
    () => getProductImages(product),
    // product fields captured via imagesKey + id
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable gallery key
    [product.id, imagesKey],
  );
  const imageCount = images.length;
  const [imageIndex, setImageIndex] = useState(() => {
    const stored = imageIndexByProductId.get(product.id) ?? 0;
    const max = Math.max(0, getProductImages(product).length - 1);
    return Math.min(Math.max(0, stored), max);
  });

  const [pagerWidth, setPagerWidth] = useState(CARD_WIDTH);
  const pageWidthSV = useSharedValue(CARD_WIDTH);
  const galleryX = useSharedValue(0);
  const imageIndexSV = useSharedValue(imageIndex);
  const imageCountSV = useSharedValue(imageCount);

  useEffect(() => {
    const stored = imageIndexByProductId.get(product.id) ?? 0;
    const max = Math.max(0, images.length - 1);
    const next = Math.min(Math.max(0, stored), max);
    setImageIndex(next);
    imageIndexSV.value = next;
    imageCountSV.value = images.length;
    cancelAnimation(galleryX);
    galleryX.value = -next * pageWidthSV.value;
  }, [product.id, images, galleryX, imageCountSV, imageIndexSV, pageWidthSV]);

  const selectedImageUrl =
    images[imageIndex] ?? product.imageUrl;

  useEffect(() => {
    let cancelled = false;
    imageCachedRef.current = false;
    setHasImageError(false);
    setIsImageLoading(true);
    // Prefetch/cache hit: onLoad gelmeden spinner'ı kapat.
    void Image.getCachePathAsync(selectedImageUrl).then((cachedPath) => {
      if (!cancelled && cachedPath) {
        imageCachedRef.current = true;
        setIsImageLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [product.id, selectedImageUrl]);

  // Current card: prefetch gallery (cap 6). Next/warm handled by Discover parent (images[0] only).
  useEffect(() => {
    if (pageIndex !== 0 || images.length === 0) {
      return;
    }
    void Image.prefetch(images.slice(0, IMAGE_PREFETCH_CAP));
  }, [pageIndex, product.id, images]);

  useEffect(() => {
    const id = product.id;
    return () => {
      unregisterPageIndexSV?.(id);
    };
  }, [product.id, unregisterPageIndexSV]);

  const hasExited = useSharedValue(false);
  const heartBurst = useSharedValue(0);

  useEffect(
    () => () => {
      cancelAnimation(heartBurst);
    },
    [heartBurst],
  );

  // Store settle / page rollover: current tekrar etkileşime açık olsun.
  useLayoutEffect(() => {
    if (isCurrent) {
      hasExited.value = false;
    }
  }, [hasExited, isCurrent, product.id]);

  useEffect(() => {
    if (!isCurrent) {
      return;
    }

    const startedAt = Date.now();
    let fired = false;
    const fire = (): void => {
      if (fired) {
        return;
      }
      const dwellMs = Date.now() - startedAt;
      if (dwellMs < IMPRESSION_MIN_DWELL_MS) {
        return;
      }
      fired = true;
      onImpression(product, dwellMs);
    };

    const timeoutId = setTimeout(fire, IMPRESSION_MIN_DWELL_MS);
    return () => {
      clearTimeout(timeoutId);
      fire();
    };
  }, [isCurrent, onImpression, product]);

  const handleAddToCloset = useCallback((): void => {
    try {
      onAddToCloset(product);
    } catch (error) {
      logger.error('Beğeni işlenemedi', { error, productId: product.id });
    }
  }, [onAddToCloset, product]);

  const handlePass = useCallback((): void => {
    try {
      onPass(product);
    } catch (error) {
      logger.error('Geçme işlenemedi', { error, productId: product.id });
    }
  }, [onPass, product]);

  const handleVirtualTryOn = useCallback((): void => {
    try {
      const vtonUrl = images[imageIndex] ?? product.imageUrl;
      onVirtualTryOn({ ...product, imageUrl: vtonUrl });
    } catch (error) {
      logger.error('Sanal deneme başlatılamadı', {
        error,
        productId: product.id,
      });
    }
  }, [images, imageIndex, onVirtualTryOn, product]);

  const prefetchNeighbor = useCallback(
    (index: number): void => {
      const url = images[index];
      if (typeof url === 'string' && url.length > 0) {
        void Image.prefetch(url);
      }
    },
    [images],
  );

  const commitImageIndex = useCallback(
    (nextIndex: number): void => {
      if (nextIndex < 0 || nextIndex >= images.length) {
        return;
      }
      setImageIndex(nextIndex);
      imageIndexByProductId.set(product.id, nextIndex);
      // Lazy prefetch ±1 from the new index.
      prefetchNeighbor(nextIndex - 1);
      prefetchNeighbor(nextIndex + 1);
    },
    [images.length, prefetchNeighbor, product.id],
  );

  const handleImagePagerLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const width = event.nativeEvent.layout.width;
      if (!(width > 0)) {
        return;
      }
      if (Math.abs(width - pageWidthSV.value) > 0.5) {
        setPagerWidth(width);
      }
      pageWidthSV.value = width;
      galleryX.value = -imageIndexSV.value * width;
    },
    [galleryX, imageIndexSV, pageWidthSV],
  );

  const handleRequireAuth = useCallback((): void => {
    try {
      onRequireAuth?.();
    } catch (error) {
      logger.error('Auth yönlendirmesi başarısız', { error });
    }
  }, [onRequireAuth]);

  const handleBuy = useCallback((): void => {
    try {
      onBuy(product);
    } catch (error) {
      logger.error('Pazaryeri sayfası açılamadı', {
        error,
        productId: product.id,
      });
    }
  }, [onBuy, product]);

  const handleUndoPass = useCallback((): void => {
    try {
      onUndoPass?.();
    } catch (error) {
      logger.error('Geçme geri alınamadı', { error });
    }
  }, [onUndoPass]);

  const handleStorePress = useCallback((): void => {
    handleBuy();
  }, [handleBuy]);

  const finishDoubleTapLike = useCallback((): void => {
    if (!canLike) {
      handleRequireAuth();
      return;
    }
    handleAddToCloset();
  }, [canLike, handleAddToCloset, handleRequireAuth]);

  const snapHome = (): void => {
    'worklet';
    dragOffset.value = withSpring(0, CARD_SPRING_BACK);
  };

  /**
   * Y eksenine kilitli Reels pager: translateY = pageIndexSV * H + dragOffset.
   * Yatay/çapraz sürüklemede pan hiç aktive olmaz.
   */
  const panGesture = Gesture.Pan()
    .enabled(isCurrent)
    .activeOffsetY([-PAN_ACTIVE_OFFSET_Y_PX, PAN_ACTIVE_OFFSET_Y_PX])
    .failOffsetX([-PAN_FAIL_OFFSET_X_PX, PAN_FAIL_OFFSET_X_PX])
    .onUpdate((event) => {
      if (hasExited.value) {
        return;
      }
      dragOffset.value = event.translationY;
    })
    .onEnd((event) => {
      if (hasExited.value) {
        return;
      }

      const y = event.translationY;
      const vy = event.velocityY;
      const H = pageHeight.value > 0 ? pageHeight.value : CARD_HEIGHT;

      if (shouldCommitPass(y, vy)) {
        hasExited.value = true;
        dragOffset.value = withSpring(
          -H,
          { ...CARD_THROW_SPRING, velocity: vy },
          (finished) => {
            if (finished) {
              runOnJS(handlePass)();
            }
          },
        );
        return;
      }

      if (shouldCommitUndo(y, vy)) {
        if (!canUndo) {
          snapHome();
          return;
        }
        hasExited.value = true;
        dragOffset.value = withSpring(
          H,
          { ...CARD_THROW_SPRING, velocity: vy },
          (finished) => {
            if (finished) {
              runOnJS(handleUndoPass)();
            }
          },
        );
        return;
      }

      snapHome();
    });

  const playHeartThenLike = (): void => {
    'worklet';
    if (hasExited.value) {
      return;
    }
    hasExited.value = true;
    heartBurst.value = withSequence(
      withTiming(1, { duration: HEART_BURST_IN_MS }),
      withTiming(0, { duration: HEART_BURST_OUT_MS }, (finished) => {
        if (finished) {
          runOnJS(finishDoubleTapLike)();
        }
      }),
    );
  };

  const doubleTapGesture = Gesture.Tap()
    .enabled(isCurrent)
    .numberOfTaps(2)
    .maxDuration(DOUBLE_TAP_MAX_DURATION_MS)
    .maxDistance(DOUBLE_TAP_MAX_DISTANCE_PX)
    .onEnd(() => {
      if (hasExited.value) {
        return;
      }
      if (!canLike) {
        runOnJS(handleRequireAuth)();
        return;
      }
      playHeartThenLike();
    });

  const cardGesture = Gesture.Exclusive(doubleTapGesture, panGesture);
  const ctaNativeGesture = Gesture.Native().blocksExternalGesture(
    doubleTapGesture,
    panGesture,
  );

  /**
   * Image-only horizontal pager. Separation from card vertical via offsets only:
   * X±6 activates gallery; Y±12 first fails so card pass/undo wins.
   * No simultaneousHandlers / exclusive / requireExternal / blocksExternal vs vertical.
   */
  const imagePanGesture = Gesture.Pan()
    .enabled(isCurrent && imageCount > 1)
    .minPointers(1)
    .activeOffsetX([-IMAGE_SWIPE_ACTIVE_OFFSET_X_PX, IMAGE_SWIPE_ACTIVE_OFFSET_X_PX])
    .failOffsetY([-IMAGE_SWIPE_FAIL_OFFSET_Y_PX, IMAGE_SWIPE_FAIL_OFFSET_Y_PX])
    .onUpdate((event) => {
      const width = pageWidthSV.value;
      if (!(width > 0)) {
        return;
      }
      const idx = imageIndexSV.value;
      const last = imageCountSV.value - 1;
      const tx = event.translationX;
      // Direct drag — no withSpring while dragging. Rubber-band excess at ends ×0.3.
      let dragX = tx;
      if (idx <= 0 && tx > 0) {
        dragX = tx * IMAGE_RUBBER_BAND;
      } else if (idx >= last && tx < 0) {
        dragX = tx * IMAGE_RUBBER_BAND;
      }
      galleryX.value = -idx * width + dragX;
    })
    .onEnd((event) => {
      const width = pageWidthSV.value;
      const count = imageCountSV.value;
      if (!(width > 0) || count <= 1) {
        return;
      }
      const idx = imageIndexSV.value;
      const tx = event.translationX;
      const vx = event.velocityX;
      let next = idx;
      if (
        Math.abs(vx) > IMAGE_COMMIT_VELOCITY_X ||
        Math.abs(tx) > width * IMAGE_COMMIT_DISTANCE_RATIO
      ) {
        const direction =
          Math.abs(vx) > IMAGE_COMMIT_VELOCITY_X ? Math.sign(vx) : Math.sign(tx);
        // Finger left (neg) → next image; finger right (pos) → previous.
        if (direction < 0) {
          next = Math.min(count - 1, idx + 1);
        } else if (direction > 0) {
          next = Math.max(0, idx - 1);
        }
      }
      // Dot/index commit on same tick as snap decision (before animation ends).
      imageIndexSV.value = next;
      runOnJS(commitImageIndex)(next);
      galleryX.value = withTiming(-next * width, { duration: IMAGE_SNAP_DURATION_MS });
    });

  const animatedCardStyle = useAnimatedStyle(() => {
    const H = pageHeight.value > 0 ? pageHeight.value : CARD_HEIGHT;
    return {
      transform: [{ translateY: pageIndexSV.value * H + dragOffset.value }],
    };
  });

  const heartBurstStyle = useAnimatedStyle(() => ({
    opacity: heartBurst.value,
    transform: [
      {
        scale: interpolate(
          heartBurst.value,
          [0, 1],
          [0.72, HEART_BURST_PEAK_SCALE],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const galleryStripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: galleryX.value }],
  }));

  const imageSource = useMemo(
    () => ({ uri: selectedImageUrl }),
    [selectedImageUrl],
  );

  const showGalleryPager = imageCount > 1;

  const slotTranslateStyle = useMemo(
    () => ({ transform: [{ translateY: pageIndex * CARD_HEIGHT }] }),
    [pageIndex],
  );

  const handleImageLoadStart = useCallback((): void => {
    if (!imageCachedRef.current) {
      setIsImageLoading(true);
    }
  }, []);

  const handleImageLoad = useCallback((): void => {
    setIsImageLoading(false);
  }, []);

  const handleImageError = useCallback((): void => {
    setHasImageError(true);
    setIsImageLoading(false);
  }, []);

  const reasonLabel = product.reason?.trim() ?? '';

  return (
    <Animated.View
      pointerEvents={isCurrent ? 'auto' : 'none'}
      collapsable={false}
      style={[
        styles.slot,
        slotTranslateStyle,
        animatedCardStyle,
      ]}
    >
      <GestureDetector gesture={cardGesture}>
        <Animated.View
          style={[styles.shadowWrap, styles.shadowWrapFront]}
          accessibilityRole="image"
          accessibilityLabel={`${product.brand} ${product.title}, ${formatPrice(product)}`}
        >
          <View style={styles.card}>
            <View style={styles.imageWrap} onLayout={handleImagePagerLayout}>
              {hasImageError ? (
                <View style={styles.imageFallback}>
                  <Text style={styles.imageFallbackText}>Görsel yüklenemedi</Text>
                </View>
              ) : showGalleryPager ? (
                <GestureDetector gesture={imagePanGesture}>
                  <Animated.View
                    style={styles.imagePager}
                    collapsable={false}
                    accessibilityRole="image"
                    accessibilityLabel={`Ürün görselleri, ${imageIndex + 1}/${imageCount}`}
                  >
                    <Animated.View
                      style={[
                        styles.imageStrip,
                        { width: pagerWidth * imageCount },
                        galleryStripStyle,
                      ]}
                    >
                      {images.map((uri, index) => (
                        <Image
                          key={`${product.id}:${index}`}
                          source={{ uri }}
                          style={[styles.imagePage, { width: pagerWidth }]}
                          contentFit="cover"
                          contentPosition={IMAGE_CONTENT_POSITION}
                          cachePolicy="memory-disk"
                          recyclingKey={`${product.id}:${index}`}
                          transition={IMAGE_CROSSFADE_MS}
                          priority={
                            pageIndex === 0 || pageIndex === 1 || pageIndex === 2
                              ? 'high'
                              : 'low'
                          }
                          onLoadStart={
                            index === imageIndex ? handleImageLoadStart : undefined
                          }
                          onLoad={index === imageIndex ? handleImageLoad : undefined}
                        />
                      ))}
                    </Animated.View>
                  </Animated.View>
                </GestureDetector>
              ) : (
                <Image
                  source={imageSource}
                  style={styles.image}
                  contentFit="cover"
                  contentPosition={IMAGE_CONTENT_POSITION}
                  cachePolicy="memory-disk"
                  recyclingKey={`${product.id}:${imageIndex}`}
                  transition={IMAGE_CROSSFADE_MS}
                  priority={pageIndex === 0 || pageIndex === 1 || pageIndex === 2 ? 'high' : 'low'}
                  onLoadStart={handleImageLoadStart}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              )}

              {isImageLoading && !hasImageError ? (
                <View style={styles.imageLoading} pointerEvents="none">
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null}

              {showGalleryPager ? (
                <View style={styles.dotsRow} pointerEvents="none">
                  {images.map((_, index) => (
                    <GalleryDot
                      key={`${product.id}:dot:${index}`}
                      active={index === imageIndex}
                    />
                  ))}
                </View>
              ) : null}

              <Animated.View
                pointerEvents="none"
                style={[styles.heartBurst, heartBurstStyle]}
              >
                <Heart color={colors.accent} fill={colors.accent} size={64} />
              </Animated.View>

              {reasonLabel.length > 0 ? (
                <View style={styles.reasonChip} pointerEvents="none">
                  <Sparkles color={colors.accent} size={REASON_ICON_SIZE} />
                  <Text style={styles.reasonChipText} numberOfLines={1}>
                    {reasonLabel}
                  </Text>
                </View>
              ) : null}

              {isCurrent && !canLike ? (
                <PressableScale
                  onPress={handleRequireAuth}
                  style={styles.authButton}
                  accessibilityRole="button"
                  accessibilityLabel="Beğenmek için giriş yap"
                >
                  <Heart color={colors.accent} size={ACTION_ICON_SIZE} />
                  <Text style={styles.authButtonText}>
                    Beğenmek için giriş yap
                  </Text>
                </PressableScale>
              ) : null}
            </View>

            <View style={styles.info}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>
                  {GARMENT_CATEGORY_LABEL[product.category]}
                </Text>
              </View>
              <Text style={styles.brand} numberOfLines={1}>
                {product.brand}
              </Text>
              <Text style={styles.title} numberOfLines={2}>
                {product.title}
              </Text>
              {(product.colors && product.colors.length > 0) ||
              (product.sizes && product.sizes.length > 0) ? (
                <View style={styles.variationRow}>
                  {product.colors && product.colors.length > 0
                    ? product.colors.slice(0, 4).map((swatch) => (
                        <View
                          key={`${swatch.name}-${swatch.hex}`}
                          style={[
                            styles.swatch,
                            { backgroundColor: swatch.hex },
                          ]}
                        />
                      ))
                    : null}
                  {product.sizes && product.sizes.length > 0 ? (
                    <Text style={styles.sizeHint}>
                      {`· ${product.sizes.length} beden`}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.priceRow}>
                {hasCatalogPriceDrop(product) &&
                typeof product.previousPrice === 'number' ? (
                  <Text style={styles.previousPrice}>
                    {formatTryPrice(product.previousPrice)}
                  </Text>
                ) : null}
                <Text style={styles.price}>{formatPrice(product)}</Text>
                {hasCatalogPriceDrop(product) &&
                typeof product.previousPrice === 'number' ? (
                  <View style={styles.dropBadge}>
                    <Text style={styles.dropBadgeText}>
                      {`↓ %${getDropPercent(product.previousPrice, getDisplayPrice(product))}`}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* CTA her zaman mount — page flip CTA unmount etmez. */}
              <GestureDetector gesture={ctaNativeGesture}>
                <View
                  style={styles.actions}
                  collapsable={false}
                  pointerEvents={isCurrent ? 'auto' : 'none'}
                >
                  <PressableScale
                    onPress={handleVirtualTryOn}
                    style={styles.primaryAction}
                    accessibilityRole="button"
                    accessibilityLabel="Dene"
                  >
                    <Sparkles
                      color={colors.inverseText}
                      size={ACTION_ICON_SIZE}
                    />
                    <Text style={styles.primaryActionText}>Dene</Text>
                  </PressableScale>
                  <PressableScale
                    onPress={handleStorePress}
                    style={styles.secondaryAction}
                    accessibilityRole="button"
                    accessibilityLabel="Mağazaya git"
                  >
                    <ShoppingBag color={colors.text} size={ACTION_ICON_SIZE} />
                    <Text style={styles.secondaryActionText}>Mağazaya Git</Text>
                  </PressableScale>
                </View>
              </GestureDetector>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

export default React.memo(SwipeCard);

export const SWIPE_CARD_WIDTH = CARD_WIDTH;
export const SWIPE_CARD_HEIGHT = CARD_HEIGHT;

const styles = StyleSheet.create({
  slot: {
    ...StyleSheet.absoluteFillObject,
  },
  shadowWrap: {
    width: '100%',
    height: '100%',
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  shadowWrapFront: {
    elevation: 0,
  },
  card: {
    flex: 1,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  imageWrap: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.surface,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  imageFallbackText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  imageLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePager: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  imageStrip: {
    flexDirection: 'row',
    height: '100%',
  },
  imagePage: {
    height: '100%',
  },
  dotsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.md,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: IMAGE_DOT_GAP,
  },
  galleryDot: {
    width: IMAGE_DOT_SIZE,
    height: IMAGE_DOT_SIZE,
    borderRadius: IMAGE_DOT_SIZE / 2,
    backgroundColor: '#FFFFFF',
  },
  heartBurst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonChip: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    maxWidth: '82%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  reasonChipText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  authButton: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.md,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.chip,
    ...shadows.chip,
  },
  authButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  info: {
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.chip,
    marginBottom: spacing.sm,
  },
  categoryBadgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  brand: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    marginBottom: spacing.xs,
  },
  variationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sizeHint: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  previousPrice: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  price: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
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
    marginTop: spacing.sm,
  },
  primaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: layout.ctaPaddingVertical,
  },
  primaryActionText: {
    color: colors.inverseText,
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: layout.ctaPaddingVertical,
  },
  secondaryActionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
});
