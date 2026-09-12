import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  Linking,
  Modal,
  type LayoutChangeEvent,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Heart,
  ImageIcon,
  RotateCcw,
  Share2,
  ShoppingBag,
  Sparkles,
} from 'lucide-react-native';
import PressableScale from './PressableScale';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthContext } from '../hooks/useAuthContext';
import { track } from '../lib/analytics';
import { grantVtonConsent, hasVtonConsent } from '../lib/consent';
import { logger } from '../lib/logger';
import { checkLowResolutionPersonPhoto } from '../lib/personPhotoPrepare';
import { recordSessionProductAction } from '../lib/sessionIntent';
import { LEGACY_RECOMMENDATION_ID } from '../types/analytics';
import {
  CONSENT_ENTER_DURATION_MS,
  HERO_GROW_DURATION_MS,
  MODAL_BACKDROP_MAX_OPACITY,
  MODAL_SLIDE_DURATION_MS,
} from '../lib/motion';
import { PRIVACY_URL } from '../lib/privacy';
import { colors, radius, spacing } from '../lib/theme';
import { LOW_RES_MODEL_PHOTO_HINT } from '../lib/vtonPersonImage';
import { buildTryOnShareMessage } from '../lib/vtonShare';
import { openProductPage } from '../services/deeplinkService';
import { insertLikedProduct } from '../services/likeService';
import { resolveSavedModelPhotoUri } from '../services/profileService';
import { tryOnGarment, VtonServiceError } from '../services/vtonService';
import { useAppStore } from '../store/useAppStore';
import type { Product } from '../types/product';

const ICON_SIZE = 16;
const GARMENT_THUMB_SIZE = 36;
const GARMENT_THUMB_RADIUS = 12;
const BADGE_RADIUS = 18;
const BADGE_INSET = 16;
const BADGE_PADDING = 6;
const BADGE_PADDING_RIGHT = 12;
const BADGE_MAX_WIDTH = '70%';
const BADGE_BLUR_INTENSITY = 50;
const BADGE_GLASS = 'rgba(255, 255, 255, 0.82)';
const GLASS_BUTTON_SIZE = 44;
const TOAST_DURATION_MS = 1600;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_CLOSE_DURATION_MS = 220;
const LOADING_COPY = 'Kıyafet giydiriliyor...';
const SLOW_HINT_AFTER_MS = 20_000;
const SLOW_HINT_TEXT = 'İlk deneme biraz uzun sürebilir';
const SHIMMER_DURATION_MS = 2200;
const SHIMMER_BAND_RATIO = 0.4;
const LOADING_DIM = 'rgba(0, 0, 0, 0.40)';
const LOADING_META = '#D1D5DB';
const SHIMMER_GRADIENT = [
  'transparent',
  'rgba(255, 255, 255, 0.18)',
  'transparent',
] as const;
const IMMERSIVE_FADE_MS = 180;
const PINCH_SCALE_MIN = 1;
const PINCH_SCALE_MAX = 4;
const CANVAS_MARGIN_X = spacing.md;
const CANVAS_MARGIN_Y = spacing.xs;
const SCREEN_PAD_TOP_EXTRA = 8;
const SCREEN_PAD_BOTTOM = spacing.md;
const HEADER_CHROME_HEIGHT = 32;
const FOOTER_CHROME_HEIGHT = 80;
const PINCH_RESET_SPRING = { damping: 16, stiffness: 220 } as const;

type ConsentStatus = 'checking' | 'required' | 'granted';

type TryOnStatus = 'idle' | 'loading' | 'error' | 'success';

export interface VirtualTryOnModalProps {
  visible: boolean;
  product: Product | null;
  onClose: () => void;
}

interface GlassIconButtonProps {
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
}

function GlassIconButton({
  accessibilityLabel,
  onPress,
  children,
}: GlassIconButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      style={styles.glassButton}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <BlurView intensity={28} tint="light" style={StyleSheet.absoluteFill} />
      <View style={styles.glassButtonIcon}>{children}</View>
    </PressableScale>
  );
}

const resetMessage = '';

export default function VirtualTryOnModal({
  visible,
  product,
  onClose,
}: VirtualTryOnModalProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const likedProducts = useAppStore((state) => state.likedProducts);
  const [status, setStatus] = useState<TryOnStatus>('idle');
  const [errorMessage, setErrorMessage] = useState(resetMessage);
  const [personImageUri, setPersonImageUri] = useState<string | null>(null);
  const [isPersonPhotoLowRes, setIsPersonPhotoLowRes] = useState(false);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>('checking');
  const [isRendered, setIsRendered] = useState(visible);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [closetAdded, setClosetAdded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastProductRef = useRef(product);
  if (product) {
    lastProductRef.current = product;
  }
  const displayProduct = product ?? lastProductRef.current;
  const isInCloset =
    closetAdded ||
    (displayProduct !== null &&
      likedProducts.some((item) => item.product.id === displayProduct.id));

  const pulse = useSharedValue(0);
  const shimmerTravel = useSharedValue(0);
  const canvasHeightSv = useSharedValue(1);
  const sheetProgress = useSharedValue(0);
  const consentProgress = useSharedValue(0);
  const heroProgress = useSharedValue(0);
  const chromeVisible = useSharedValue(1);
  const pinchScale = useSharedValue(1);
  const savedPinchScale = useSharedValue(1);

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

  useEffect(() => {
    if (!visible) {
      return;
    }

    let isMounted = true;
    void hasVtonConsent().then((granted) => {
      if (isMounted) {
        setConsentStatus(granted ? 'granted' : 'required');
      }
    });

    return () => {
      isMounted = false;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || consentStatus !== 'granted' || !user?.id) {
      return;
    }

    let isMounted = true;
    void resolveSavedModelPhotoUri(user.id)
      .then((uri) => {
        if (!isMounted || !uri) {
          return;
        }
        setPersonImageUri((current) => current ?? uri);
      })
      .catch((error: unknown) => {
        logger.error('Kayıtlı model fotoğrafı yüklenemedi', { error });
      });

    return () => {
      isMounted = false;
    };
  }, [consentStatus, user?.id, visible]);

  useEffect(() => {
    if (!personImageUri) {
      setIsPersonPhotoLowRes(false);
      return;
    }
    let isMounted = true;
    void checkLowResolutionPersonPhoto(personImageUri)
      .then((lowRes) => {
        if (isMounted) {
          setIsPersonPhotoLowRes(lowRes);
        }
      })
      .catch((error: unknown) => {
        logger.warn('Model fotoğrafı boyutu okunamadı', { error });
      });
    return () => {
      isMounted = false;
    };
  }, [personImageUri]);

  useEffect(() => {
    if (status === 'loading') {
      pulse.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      return;
    }

    pulse.value = withTiming(0, { duration: 200 });
  }, [pulse, status]);

  useEffect(() => {
    if (status !== 'loading') {
      cancelAnimation(shimmerTravel);
      shimmerTravel.value = 0;
      return;
    }

    shimmerTravel.value = 0;
    shimmerTravel.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(shimmerTravel);
    };
  }, [shimmerTravel, status]);

  useEffect(() => {
    if (status !== 'loading') {
      setShowSlowHint(false);
      return;
    }

    const slowHintId = setTimeout(() => {
      setShowSlowHint(true);
    }, SLOW_HINT_AFTER_MS);

    return () => {
      clearTimeout(slowHintId);
    };
  }, [status]);

  // withRepeat sonsuz döngüde; unmount'ta iptal edilmezse worklet çalışmaya
  // devam eder ve shared value sızar.
  useEffect(
    () => () => {
      cancelAnimation(pulse);
      cancelAnimation(shimmerTravel);
      cancelAnimation(sheetProgress);
      cancelAnimation(consentProgress);
      cancelAnimation(heroProgress);
      cancelAnimation(chromeVisible);
      cancelAnimation(pinchScale);
    },
    [
      chromeVisible,
      consentProgress,
      heroProgress,
      pinchScale,
      pulse,
      shimmerTravel,
      sheetProgress,
    ],
  );

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.72, 1]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.08]) }],
  }));

  const shimmerStyle = useAnimatedStyle(() => {
    const band = canvasHeightSv.value * SHIMMER_BAND_RATIO;
    return {
      height: Math.max(band, 1),
      transform: [
        {
          translateY: interpolate(
            shimmerTravel.value,
            [0, 1],
            [-band, canvasHeightSv.value],
          ),
        },
      ],
    };
  });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: sheetProgress.value * MODAL_BACKDROP_MAX_OPACITY,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          sheetProgress.value,
          [0, 1],
          [SCREEN_HEIGHT, 0],
        ),
      },
    ],
  }));

  const consentEnterStyle = useAnimatedStyle(() => ({
    opacity: consentProgress.value,
    transform: [
      { scale: interpolate(consentProgress.value, [0, 1], [0.9, 1]) },
    ],
  }));

  const heroStyle = useAnimatedStyle(() => ({
    opacity: interpolate(heroProgress.value, [0, 1], [0.35, 1]),
    marginHorizontal: interpolate(
      chromeVisible.value,
      [0, 1],
      [0, CANVAS_MARGIN_X],
    ),
    marginVertical: interpolate(
      chromeVisible.value,
      [0, 1],
      [0, CANVAS_MARGIN_Y],
    ),
    borderRadius: interpolate(chromeVisible.value, [0, 1], [0, radius.card]),
    borderWidth: interpolate(chromeVisible.value, [0, 1], [0, 1]),
  }));

  const screenPadStyle = useAnimatedStyle(() => ({
    paddingTop: interpolate(
      chromeVisible.value,
      [0, 1],
      [0, insets.top + SCREEN_PAD_TOP_EXTRA],
    ),
    paddingBottom: interpolate(
      chromeVisible.value,
      [0, 1],
      [0, Math.max(insets.bottom, SCREEN_PAD_BOTTOM)],
    ),
  }));

  const headerChromeStyle = useAnimatedStyle(() => ({
    opacity: chromeVisible.value,
    maxHeight: interpolate(
      chromeVisible.value,
      [0, 1],
      [0, HEADER_CHROME_HEIGHT],
    ),
    marginBottom: interpolate(chromeVisible.value, [0, 1], [0, spacing.sm]),
  }));

  const footerChromeStyle = useAnimatedStyle(() => ({
    opacity: chromeVisible.value,
    maxHeight: interpolate(
      chromeVisible.value,
      [0, 1],
      [0, FOOTER_CHROME_HEIGHT],
    ),
    paddingTop: interpolate(chromeVisible.value, [0, 1], [0, 12]),
  }));

  const badgeChromeStyle = useAnimatedStyle(() => ({
    opacity: chromeVisible.value,
  }));

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pinchScale.value }],
  }));

  const resetState = useCallback((): void => {
    setStatus('idle');
    setErrorMessage(resetMessage);
    setPersonImageUri(null);
    setIsPersonPhotoLowRes(false);
    setResultImageUrl(null);
    setIsImmersive(false);
    setClosetAdded(false);
    setToastMessage(null);
  }, []);

  const finishExit = useCallback((): void => {
    resetState();
    setIsRendered(false);
  }, [resetState]);

  const handleClose = useCallback((): void => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      setIsRendered(true);
      sheetProgress.value = withTiming(1, {
        duration: MODAL_SLIDE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    sheetProgress.value = withTiming(
      0,
      {
        duration: SHEET_CLOSE_DURATION_MS,
        easing: Easing.in(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(finishExit)();
        }
      },
    );
  }, [finishExit, sheetProgress, visible]);

  useEffect(() => {
    if (!visible) {
      consentProgress.value = 0;
      heroProgress.value = 0;
      return;
    }

    if (consentStatus === 'required') {
      consentProgress.value = 0;
      consentProgress.value = withTiming(1, {
        duration: CONSENT_ENTER_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    }

    if (consentStatus === 'granted') {
      heroProgress.value = 0;
      heroProgress.value = withTiming(1, {
        duration: HERO_GROW_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [consentProgress, consentStatus, heroProgress, visible]);

  // Sekme katmanı, kök sekmedeyken geri tuşuyla uygulamadan çıkışı engelliyor.
  // Modal görünürken geri tuşunun sahibi burasıdır; aksi halde o engel modalın
  // kapanmasını da yutar.
  useEffect(() => {
    if (!visible) {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleClose();
        return true;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [handleClose, visible]);

  const resetImmersiveView = useCallback((): void => {
    setIsImmersive(false);
    cancelAnimation(chromeVisible);
    cancelAnimation(pinchScale);
    chromeVisible.value = 1;
    pinchScale.value = 1;
    savedPinchScale.value = 1;
  }, [chromeVisible, pinchScale, savedPinchScale]);

  const toggleImmersive = useCallback((): void => {
    setIsImmersive((current) => {
      const next = !current;
      chromeVisible.value = withTiming(next ? 0 : 1, {
        duration: IMMERSIVE_FADE_MS,
        easing: Easing.inOut(Easing.ease),
      });
      return next;
    });
  }, [chromeVisible]);

  useEffect(() => {
    if (status === 'success') {
      return;
    }
    resetImmersiveView();
  }, [resetImmersiveView, status]);

  const handlePickPhoto = useCallback(async (): Promise<void> => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setStatus('error');
        setErrorMessage(
          'Galerine erişim izni verilmedi. Ayarlardan izin verip tekrar dene.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      setPersonImageUri(result.assets[0].uri);
      setResultImageUrl(null);
      setErrorMessage(resetMessage);
      setStatus('idle');
    } catch (error) {
      logger.error('Fotoğraf seçilemedi', { error });
      setStatus('error');
      setErrorMessage('Fotoğraf seçilemedi. Lütfen tekrar dene.');
    }
  }, []);

  const handleTryOn = useCallback(async (): Promise<void> => {
    if (!product || !personImageUri) {
      setStatus('error');
      setErrorMessage('Önce tam boy bir fotoğrafını seç.');
      return;
    }

    setStatus('loading');
    setErrorMessage(resetMessage);

    const startedAt = Date.now();
    track('try_on_start', product.id, {
      recommendation_id: LEGACY_RECOMMENDATION_ID,
    });

    try {
      const outputUrl = await tryOnGarment(personImageUri, product.imageUrl, {
        productId: product.id,
        productTitle: product.title,
        productUrl: product.productUrl,
        affiliateUrl: product.affiliateUrl,
      });
      setResultImageUrl(outputUrl);
      setStatus('success');
      track('try_on_success', product.id, {
        result_shown: true,
        before_after_used: false,
        saved: isInCloset,
        duration_ms: Date.now() - startedAt,
      });
      recordSessionProductAction('try_on_success', product);
    } catch (error) {
      const message =
        error instanceof VtonServiceError
          ? error.message
          : 'Sanal deneme tamamlanamadı. Lütfen tekrar dene.';
      logger.error('Sanal deneme isteği başarısız', { error });
      setStatus('error');
      setErrorMessage(message);
      Alert.alert('Sanal deneme hatası', message);
      track('try_on_failure', product.id, {
        error_reason: message.slice(0, 120),
      });
    }
  }, [isInCloset, personImageUri, product]);

  const handleRetry = useCallback((): void => {
    setStatus('idle');
    setErrorMessage(resetMessage);
    setResultImageUrl(null);
    setIsImmersive(false);
  }, []);

  const handleShare = useCallback(async (): Promise<void> => {
    if (!displayProduct) {
      return;
    }
    try {
      await Share.share({ message: buildTryOnShareMessage(displayProduct) });
      track('share', displayProduct.id, { source: 'tryon' });
    } catch (error) {
      logger.error('Sanal deneme paylaşılamadı', { error });
    }
  }, [displayProduct]);

  const handleAddToCloset = useCallback(async (): Promise<void> => {
    if (!displayProduct) {
      return;
    }
    if (!user) {
      showToast('Beğenmek için giriş yap');
      return;
    }
    if (isInCloset) {
      setClosetAdded(true);
      showToast('Zaten dolabında');
      return;
    }

    try {
      await insertLikedProduct(user.id, displayProduct);
      useAppStore.setState((state) => {
        if (state.likedProducts.some((item) => item.product.id === displayProduct.id)) {
          return state;
        }
        return {
          likedProducts: [
            {
              product: displayProduct,
              notifyOnPriceDrop: true,
              likedAt: new Date().toISOString(),
            },
            ...state.likedProducts,
          ],
        };
      });
      setClosetAdded(true);
      showToast('Dolabına eklendi');
      track('dolap_add', displayProduct.id, { source: 'tryon' });
    } catch (error) {
      logger.error('Dolaba eklenemedi', { error });
      showToast('Dolaba eklenemedi. Tekrar dene.');
    }
  }, [displayProduct, isInCloset, showToast, user]);

  const handleOpenStore = useCallback((): void => {
    if (!displayProduct) {
      return;
    }
    void openProductPage(displayProduct);
  }, [displayProduct]);

  const handleAcceptConsent = useCallback((): void => {
    setConsentStatus('granted');
    void grantVtonConsent();
  }, []);

  const handleOpenPrivacy = useCallback((): void => {
    void Linking.openURL(PRIVACY_URL).catch((error: unknown) => {
      logger.error('Gizlilik politikası açılamadı', { error });
      Alert.alert(
        'Bağlantı açılamadı',
        'Gizlilik politikası bu cihazda açılamadı.',
      );
    });
  }, []);

  if (!displayProduct || !isRendered) {
    return null;
  }

  const isConsentFlow = consentStatus !== 'granted';
  const isSuccess = status === 'success' && resultImageUrl !== null;
  const isLoading = status === 'loading';
  const canvasUri = isSuccess ? resultImageUrl : personImageUri;
  const loadingBackdropUri = personImageUri;

  const handleCanvasLayout = (event: LayoutChangeEvent): void => {
    canvasHeightSv.value = event.nativeEvent.layout.height;
  };

  const doubleTap = Gesture.Tap()
    .enabled(isSuccess)
    .numberOfTaps(2)
    .onEnd((_event, success) => {
      if (!success) {
        return;
      }
      cancelAnimation(pinchScale);
      pinchScale.value = withSpring(1, PINCH_RESET_SPRING);
      savedPinchScale.value = 1;
    });

  const singleTap = Gesture.Tap()
    .enabled(isSuccess)
    .numberOfTaps(1)
    .onEnd((_event, success) => {
      if (!success) {
        return;
      }
      runOnJS(toggleImmersive)();
    });

  const pinch = Gesture.Pinch()
    .enabled(isSuccess)
    .onUpdate((event) => {
      const next = savedPinchScale.value * event.scale;
      pinchScale.value = Math.min(
        PINCH_SCALE_MAX,
        Math.max(PINCH_SCALE_MIN, next),
      );
    })
    .onEnd(() => {
      savedPinchScale.value = pinchScale.value;
    });

  const imageGestures = Gesture.Simultaneous(
    Gesture.Exclusive(doubleTap, singleTap),
    pinch,
  );

  return (
    <Modal
      visible={isRendered}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <GestureHandlerRootView style={styles.modalRoot}>
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, backdropStyle]}
        />
        <Animated.View style={[styles.screen, sheetStyle, screenPadStyle]}>
          {isConsentFlow ? (
            consentStatus === 'checking' ? (
              <View style={styles.centerBlock}>
                <ActivityIndicator color={colors.accent} size="large" />
              </View>
            ) : (
              <Animated.View style={[styles.consentFill, consentEnterStyle]}>
              <ScrollView contentContainerStyle={styles.consentBody}>
                <Text style={styles.kicker}>Sanal deneme</Text>
                <Text style={styles.consentTitle}>
                  Fotoğrafın nasıl işlenir?
                </Text>
                <Text style={styles.consentLead}>
                  Fotoğrafın yalnızca bu deneme için işlenir ve saklanmaz.
                </Text>
                <Text style={styles.consentItem}>
                  • Seçtiğin fotoğraf, giydirme işlemini yapan yapay zekâ
                  servisimize şifreli bağlantı üzerinden gönderilir.
                </Text>
                <Text style={styles.consentItem}>
                  • İşlem bittiğinde fotoğraf sunucuda tutulmaz; sonuç görseli
                  yalnızca senin cihazında gösterilir.
                </Text>
                <Text style={styles.consentItem}>
                  • Fotoğrafın reklam, model eğitimi veya üçüncü taraflarla
                  paylaşım için kullanılmaz.
                </Text>
                <Text style={styles.consentItem}>
                  • Bu izni istediğin zaman uygulamayı kaldırarak ya da
                  hesabını silerek geri alabilirsin.
                </Text>
                <PressableScale
                  onPress={handleOpenPrivacy}
                  accessibilityRole="link"
                  accessibilityLabel="Gizlilik Politikası"
                >
                  <Text style={styles.consentLink}>Gizlilik Politikası</Text>
                </PressableScale>
              </ScrollView>

              <View style={styles.footer}>
                <View style={styles.footerRow}>
                  <PressableScale
                    onPress={handleClose}
                    style={styles.secondaryButton}
                    accessibilityRole="button"
                    accessibilityLabel="Vazgeç"
                  >
                    <Text style={styles.secondaryButtonText}>Vazgeç</Text>
                  </PressableScale>
                  <PressableScale
                    onPress={handleAcceptConsent}
                    style={styles.primaryButton}
                    accessibilityRole="button"
                    accessibilityLabel="Kabul Et"
                  >
                    <Text style={styles.primaryButtonText}>Kabul Et</Text>
                  </PressableScale>
                </View>
              </View>
              </Animated.View>
            )
          ) : (
            <>
        <Animated.View
          style={[styles.header, headerChromeStyle]}
          pointerEvents={isImmersive ? 'none' : 'auto'}
        >
          <Text style={styles.studioTitle}>Deneme Kabini</Text>
        </Animated.View>

        <View style={styles.canvasSlot}>
        <Animated.View
          style={[styles.canvas, heroStyle]}
          onLayout={handleCanvasLayout}
        >
          <GestureDetector gesture={imageGestures}>
            <Animated.View
              collapsable={false}
              style={[styles.canvasImage, zoomStyle]}
              pointerEvents={isSuccess ? 'auto' : 'none'}
            >
              {isLoading && loadingBackdropUri ? (
                <Image
                  source={{ uri: loadingBackdropUri }}
                  style={styles.canvasImage}
                  contentFit="cover"
                  cachePolicy="none"
                  recyclingKey={`${loadingBackdropUri}-loading`}
                />
              ) : null}

              {!isLoading && status !== 'error' && canvasUri ? (
                <Image
                  source={{ uri: canvasUri }}
                  style={styles.canvasImage}
                  contentFit="contain"
                  cachePolicy="none"
                  recyclingKey={canvasUri}
                />
              ) : null}
            </Animated.View>
          </GestureDetector>

          {status === 'idle' && !personImageUri ? (
            <View style={styles.placeholder}>
              <ImageIcon color={colors.textSecondary} size={42} />
              <Text style={styles.placeholderTitle}>Fotoğrafını seç</Text>
              <Text style={styles.placeholderHint}>
                Ayakta, net ve tam boy bir fotoğraf seç. Orijinal kadraj korunur.
              </Text>
            </View>
          ) : null}

          {isPersonPhotoLowRes && personImageUri && status === 'idle' ? (
            <Text style={styles.lowResHint}>{LOW_RES_MODEL_PHOTO_HINT}</Text>
          ) : null}

          {status === 'error' ? (
            <View style={styles.centerBlock}>
              <Text style={styles.errorTitle}>Bir şeyler ters gitti</Text>
              <Text style={styles.errorMessage}>{errorMessage}</Text>
            </View>
          ) : null}

          {isLoading ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <View style={styles.loadingDim} />
              <Animated.View style={[styles.shimmerBand, shimmerStyle]}>
                <LinearGradient
                  colors={SHIMMER_GRADIENT}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <View style={styles.loadingCopy}>
                <Animated.View style={pulseStyle}>
                  <Sparkles color={colors.inverseText} size={36} />
                </Animated.View>
                <Text style={styles.loadingText}>{LOADING_COPY}</Text>
                <Text style={styles.loadingProduct} numberOfLines={1}>
                  {`${displayProduct.brand} · ${displayProduct.title}`}
                </Text>
                {showSlowHint ? (
                  <Text style={styles.slowHint}>{SLOW_HINT_TEXT}</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <Animated.View
            style={[styles.garmentBadge, badgeChromeStyle]}
            pointerEvents="none"
          >
            <BlurView
              intensity={BADGE_BLUR_INTENSITY}
              tint="light"
              style={StyleSheet.absoluteFill}
            />
            <Image
              source={{ uri: displayProduct.imageUrl }}
              style={styles.garmentThumb}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={displayProduct.id}
            />
            <Text
              style={styles.garmentBadgeLabel}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {displayProduct.title}
            </Text>
          </Animated.View>

          {isSuccess ? (
            <View style={styles.toolColumn}>
              <GlassIconButton
                accessibilityLabel="Paylaş"
                onPress={() => {
                  void handleShare();
                }}
              >
                <Share2 color={colors.icon} size={ICON_SIZE} />
              </GlassIconButton>
              <GlassIconButton
                accessibilityLabel="Dolaba ekle"
                onPress={() => {
                  void handleAddToCloset();
                }}
              >
                <Heart
                  color={isInCloset ? colors.accent : colors.icon}
                  fill={isInCloset ? colors.accent : 'transparent'}
                  size={ICON_SIZE}
                />
              </GlassIconButton>
            </View>
          ) : null}
        </Animated.View>
        </View>

        <Animated.View
          style={[styles.footerChrome, footerChromeStyle]}
          pointerEvents={isImmersive ? 'none' : 'auto'}
        >
          {isSuccess ? (
            <View
              style={styles.footerRow}
              pointerEvents={isLoading ? 'none' : 'auto'}
            >
              <PressableScale
                onPress={handleRetry}
                style={styles.secondaryButton}
                accessibilityRole="button"
                accessibilityLabel="Tekrar dene"
              >
                <RotateCcw color={colors.text} size={ICON_SIZE} />
                <Text style={styles.secondaryButtonText}>Tekrar Dene</Text>
              </PressableScale>
              <PressableScale
                onPress={handleOpenStore}
                style={styles.primaryButton}
                accessibilityRole="button"
                accessibilityLabel="Mağazaya git"
              >
                <ShoppingBag color={colors.inverseText} size={ICON_SIZE} />
                <Text style={styles.primaryButtonText}>Mağazaya Git</Text>
              </PressableScale>
            </View>
          ) : (
            <View
              style={[styles.footerRow, isLoading ? styles.footerHidden : null]}
              pointerEvents={isLoading ? 'none' : 'auto'}
            >
              <PressableScale
                onPress={handlePickPhoto}
                style={styles.secondaryButton}
                accessibilityRole="button"
                accessibilityLabel="Modeli değiştir"
              >
                <Text style={styles.secondaryButtonText}>Modeli Değiştir</Text>
              </PressableScale>
              <PressableScale
                onPress={handleTryOn}
                style={styles.primaryButton}
                accessibilityRole="button"
                accessibilityLabel="Üzerimde dene"
              >
                <Sparkles color={colors.inverseText} size={ICON_SIZE} />
                <Text style={styles.primaryButtonText}>Üzerimde Dene</Text>
              </PressableScale>
            </View>
          )}
        </Animated.View>
        {toastMessage ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        ) : null}
            </>
          )}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  consentFill: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  studioTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  kicker: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  canvasSlot: {
    flex: 1,
    justifyContent: 'center',
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.bgSoft,
    borderColor: colors.hairline,
  },
  canvasImage: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  loadingDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: LOADING_DIM,
  },
  shimmerBand: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  loadingCopy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  loadingProduct: {
    marginTop: spacing.xs,
    color: LOADING_META,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  garmentBadge: {
    position: 'absolute',
    bottom: BADGE_INSET,
    left: BADGE_INSET,
    zIndex: 4,
    maxWidth: BADGE_MAX_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: BADGE_PADDING,
    paddingRight: BADGE_PADDING_RIGHT,
    borderRadius: BADGE_RADIUS,
    overflow: 'hidden',
    backgroundColor: BADGE_GLASS,
  },
  garmentThumb: {
    zIndex: 1,
    width: GARMENT_THUMB_SIZE,
    height: GARMENT_THUMB_SIZE,
    borderRadius: GARMENT_THUMB_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.bgSoft,
  },
  garmentBadgeLabel: {
    zIndex: 1,
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  toolColumn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 4,
    gap: spacing.sm,
  },
  glassButton: {
    width: GLASS_BUTTON_SIZE,
    height: GLASS_BUTTON_SIZE,
    borderRadius: GLASS_BUTTON_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
  },
  glassButtonIcon: {
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  placeholderTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  placeholderHint: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  lowResHint: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    zIndex: 3,
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  consentBody: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  consentTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: spacing.md,
  },
  consentLead: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 25,
    marginBottom: 18,
  },
  consentItem: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: spacing.md,
  },
  consentLink: {
    color: colors.accentDark,
    fontSize: 15,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginTop: spacing.sm,
  },
  loadingText: {
    color: colors.inverseText,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: spacing.sm,
  },
  slowHint: {
    color: LOADING_META,
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  errorMessage: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: 18,
  },
  footerChrome: {
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  footerHidden: {
    opacity: 0,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    flex: 1,
    borderRadius: radius.button,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xxl,
    backgroundColor: colors.inverseSurface,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  toastText: {
    color: colors.inverseText,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
