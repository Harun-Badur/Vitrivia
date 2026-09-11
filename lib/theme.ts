/**
 * Kabin tasarım sistemi: "Beyaz Taban + Mercan Aksan" (60-30-10).
 * 60 beyaz/kırık beyaz zemin, 30 antrasit tipografi, 10 mercan aksan.
 * Ekranlarda ham hex kullanılmaz; tüm renk/ölçü kararları buradan gelir.
 */
export const colors = {
  bg: '#F7F4F0',
  bgSoft: '#FAFAFA',
  /** Ürün ve liste kartlarının sıcak kırık beyaz zemini. */
  surface: '#F5F3EF',
  text: '#111827',
  textSecondary: '#6B7280',
  border: '#EAE6E1',
  hairline: '#F3F4F6',
  tabInactive: '#9CA3AF',
  /** Arama/filtre kontrollerinin beyaz zemini. */
  input: '#FFFFFF',
  /** Büyüteç ve sliders ikonları. */
  icon: '#1A1A1A',
  /** Input placeholder. */
  placeholder: '#9CA3AF',
  /** Arama/filtre gölge rengi. */
  inputShadow: '#000000',
  accent: '#FE382B',
  /** Küçük metin ve linklerde kontrast için koyu aksan. */
  accentDark: '#D92B1F',
  /** Rozet ve switch zeminleri. */
  accentSoft: 'rgba(254, 56, 43, 0.1)',
  /** Yalnızca minimal kullanım: silme metin butonları. */
  destructive: '#DC2626',
  /** Kaydırma damgaları: traffic-light. */
  stampAdd: '#22C55E',
  stampPass: '#EF4444',
  /** Görsel üzerindeki çip/damga zemini. */
  glass: 'rgba(255, 255, 255, 0.94)',
  /** Toast gibi ters kontrastlı geçici yüzeyler. */
  inverseSurface: 'rgba(17, 24, 39, 0.92)',
  inverseText: '#FFFFFF',
  /** Modal arka perdesi (opaklık animasyonla verilir). */
  backdrop: '#111827',
  likeWash: 'rgba(34, 197, 94, 0.18)',
  shadow: '#1E140A',
  /** Discover segment: track arka planı, kutu/border yok. */
  segmentTrackBg: 'transparent',
  /** Aktif pill zemini. */
  segmentActiveBg: '#FFFFFF',
  /** Aktif segment metni (mercan değil). */
  segmentActiveText: '#111827',
  /** Pasif segment metni. */
  segmentPassiveText: '#6B7280',
} as const;

export const radius = {
  card: 24,
  button: 16,
  chip: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Discover chrome ölçüleri. Kart yüksekliği ekranın kör bir yüzdesi değil;
 * bu token’lardan kalan dikey alana oturur.
 */
export const layout = {
  headerControl: 48,
  headerGap: 10,
  filterDot: 8,
  /** Status bar yoksa (bazı Android) üst boşluk. */
  statusBarFallback: 28,
  /** Safe area altındaki nefes payı. */
  headerPaddingTop: spacing.sm,
  /** Search → segment: eski 8px’in ~%25 sıkısı. */
  searchToSegment: 6,
  /** Segment → deck: eski 12px; kart 8–12px yukarı kayar. */
  headerToDeck: 6,
  headerToDeckMin: 4,
  headerToDeckTallScreen: 720,
  segmentHeight: 36,
  segmentInset: spacing.xs,
  segmentOptionPaddingX: spacing.lg,
  deckPadding: spacing.md,
  /** Discover deste: arka kart şeridi (px / derinlik). 4; uzun ekranda 6. */
  deckPeekStep: 4,
  deckPeekStepMin: 4,
  deckPeekStepMax: 6,
  tabBarContentHeight: 60,
  tabBarFallbackPadding: spacing.md,
  ctaPaddingVertical: 10,
} as const;

const DISCOVER_SEARCH_TO_SEGMENT_WAS = spacing.sm;
const DISCOVER_HEADER_TO_DECK_WAS = spacing.md;

/**
 * Segment → kart: kısa ekranda 4px, uzun ekranda 6px.
 * Search→segment 6px.
 */
export const headerToDeckForHeight = (screenHeight: number): number =>
  screenHeight >= layout.headerToDeckTallScreen
    ? layout.headerToDeck
    : layout.headerToDeckMin;

/** Arka kart şeridi: kısa ekranda 4px, uzun ekranda 6px. */
export const deckPeekStepForHeight = (screenHeight: number): number =>
  screenHeight >= layout.headerToDeckTallScreen
    ? layout.deckPeekStepMax
    : layout.deckPeekStepMin;

/**
 * Header sıkışınca kart boyutu değişmesin: aynı pay tab bar üstünde kalır.
 */
export const discoverCardLiftForHeight = (screenHeight: number): number =>
  DISCOVER_SEARCH_TO_SEGMENT_WAS -
  layout.searchToSegment +
  DISCOVER_HEADER_TO_DECK_WAS -
  headerToDeckForHeight(screenHeight);

/** Discover iskeleti: gerçek inset bilinmezken kart yüksekliği tahmini. */
export const estimateDiscoverCardHeight = (screenHeight: number): number => {
  const topChrome =
    layout.statusBarFallback +
    layout.headerPaddingTop +
    layout.headerControl +
    layout.searchToSegment +
    layout.segmentHeight +
    headerToDeckForHeight(screenHeight);
  const bottomChrome =
    layout.tabBarContentHeight +
    layout.tabBarFallbackPadding +
    layout.deckPadding +
    discoverCardLiftForHeight(screenHeight);
  return Math.max(0, screenHeight - topChrome - bottomChrome);
};

/** Açık zeminde iskelet parıltısı beyaz bir ışık bandıdır. */
export const gradients = {
  shimmer: [
    'rgba(255, 255, 255, 0)',
    'rgba(255, 255, 255, 0.85)',
    'rgba(255, 255, 255, 0)',
  ],
} as const;

/** Geniş, çok hafif, sıcak kart gölgesi — derinlik hissi. */
export const shadows = {
  card: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 24,
    elevation: 3,
  },
  chip: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  segment: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  /** Discover deste: sakin, düşük elevation. */
  stackSoft: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 1,
  },
  input: {
    shadowColor: colors.inputShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;

/** Discover park/clip: deste gölgesinin yayılımı. */
export const CARD_SHADOW_SPREAD_PX =
  shadows.stackSoft.shadowOffset.height + shadows.stackSoft.shadowRadius;
