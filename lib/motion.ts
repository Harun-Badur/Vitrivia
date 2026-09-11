import { CARD_SHADOW_SPREAD_PX, layout } from './theme';

/** Ortak süreler: JS thread’de interpolasyon yok, hepsi Reanimated worklet’e gider. */
export const PRESS_SCALE = 0.95;
export const PRESS_DURATION_MS = 100;

export const TAB_TRANSITION_MS = 200;
export const STACK_TRANSITION_MS = 200;

/** Deste hissi: önde 1 kart; 2 arka katman ince şerit + düşük opaklık. */
export const DECK_VISIBLE_COUNT = 3;
export const DECK_SCALE_BY_DEPTH: readonly [number, number, number] = [
  1, 0.98, 0.96,
];
/** Alt kenar şeridi: tema token (4); runtime kısa/uzun ekranda 4–6. */
export const DECK_PEEK_STEP_PX = layout.deckPeekStep;
/** Ana kart opak; arka katmanlar sakin, yarışmaz. */
export const DECK_OPACITY_BY_DEPTH: readonly [number, number, number] = [
  1, 0.6, 0.35,
];
export const DECK_SPRING = { damping: 18, stiffness: 200, mass: 0.7 } as const;
/** Promotion: kısa, overshoot yok — “yeni kart doğdu” hissi yok. */
export const DECK_PROMOTE_SPRING = {
  damping: 28,
  stiffness: 240,
  mass: 0.72,
  overshootClamping: true,
} as const;

/** Discover kart fiziği: yalnızca dikey drag, rotation yok, overshoot yok. */
export const PASS_DISTANCE_PX = 84;
export const PASS_VELOCITY_PX = 920;
export const UNDO_DISTANCE_PX = 84;
export const UNDO_VELOCITY_PX = 920;
/** Pan yalnız bu Y eşiği aşılınca açılır; yatay/çapraz sürükleme hiç aktive etmez. */
export const PAN_ACTIVE_OFFSET_Y_PX = 18;
/**
 * Bu X eşiği Y’den önce aşılırsa jest iptal: sağ/sol kartı kıpırdatmaz.
 * Y biraz daha erken açılır ki hafif çaprazda yalnız dikey 1:1 kalsın.
 */
export const PAN_FAIL_OFFSET_X_PX = 40;
export const CARD_SPRING_BACK = {
  damping: 24,
  stiffness: 280,
  mass: 0.7,
  overshootClamping: true,
} as const;
export const CARD_THROW_SPRING = {
  damping: 15,
  stiffness: 78,
  mass: 0.85,
  overshootClamping: true,
} as const;
export const UNDO_SETTLE_SPRING = {
  damping: 20,
  stiffness: 210,
  mass: 0.75,
  overshootClamping: true,
} as const;

export interface StackPose {
  scale: number;
  translateY: number;
  opacity: number;
}

/**
 * Destenin TEK geometri kaynağı. JS thread’de çalışır (worklet değil): Reanimated 4
 * `as const`/dinamik dizi indeksini UI thread’e kopyalayamaz, açılışta çöker.
 */
export const getStackPose = (
  depth: number,
  cardHeightPx: number,
  peekStepPx: number = DECK_PEEK_STEP_PX,
): StackPose => {
  const step: 0 | 1 | 2 = depth <= 0 ? 0 : depth === 1 ? 1 : 2;
  const scale = DECK_SCALE_BY_DEPTH[step];
  const opacity = DECK_OPACITY_BY_DEPTH[step];
  const shrinkCompensation = ((1 - scale) * cardHeightPx) / 2;
  const peek = step * peekStepPx;
  return {
    scale,
    translateY: peek + shrinkCompensation,
    opacity,
  };
};

/**
 * Idle park: kart, deck clip üst kenarının tamamen dışında durur.
 * 24px minimum boşluk + gölge yayılımı; tahmin/layout sapması şerit bırakmaz.
 */
export const UNDO_PARK_CLEARANCE_PX = 24;

/** Park = -(kart yüksekliği + clearance + gölge). Gesture eşiğine dokunulmaz. */
export const deckClearTravelPx = (cardHeightPx: number): number =>
  cardHeightPx + UNDO_PARK_CLEARANCE_PX + CARD_SHADOW_SPREAD_PX;

/**
 * Geçilen kart unmount edilmez; clip'in hemen üstünde park eder. Görünürlüğü
 * opacity değil yalnızca geometri belirler.
 */
export const getUndoParkY = (cardHeightPx: number): number =>
  -deckClearTravelPx(cardHeightPx);

/** JS thread lerp — Reanimated `interpolate` worklet’ini useLayoutEffect’te çağırma. */
export const lerp = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress;

/**
 * Park eden kartın desteye dönüş oranı. Ön kart aynı oranla arka slota iner,
 * böylece iki hareket tek fiziksel devir gibi okunur.
 */
export const undoReturnProgress = (
  pullY: number,
  travelPx: number,
): number => {
  'worklet';
  if (pullY <= 0 || travelPx <= 0) {
    return 0;
  }
  return Math.min(pullY / travelPx, 1);
};

export const shouldCommitPass = (
  translationY: number,
  velocityY: number,
): boolean => {
  'worklet';
  return translationY <= -PASS_DISTANCE_PX || velocityY <= -PASS_VELOCITY_PX;
};

export const shouldCommitUndo = (
  translationY: number,
  velocityY: number,
): boolean => {
  'worklet';
  return translationY >= UNDO_DISTANCE_PX || velocityY >= UNDO_VELOCITY_PX;
};

/** Segment pill: kısa, overshoot yok. */
export const SEGMENT_PILL_SPRING = {
  damping: 24,
  stiffness: 320,
  mass: 0.6,
  overshootClamping: true,
} as const;

export const HINT_ENTER_DURATION_MS = 260;
export const HINT_EXIT_DURATION_MS = 180;
export const HINT_BOB_DURATION_MS = 900;
export const HINT_BOB_OFFSET_PX = 6;

export const CARD_SNAP_SCALE = 0.9;
export const CARD_SNAP_DURATION_MS = 200;
export const CARD_EXIT_DURATION_MS = 300;
export const CARD_EXIT_LIFT_PX = 200;

export const ONBOARDING_PAGE_COUNT = 3;
export const ONBOARDING_STAGGER_MS = 90;
export const ONBOARDING_ENTER_SPRING = { damping: 14, stiffness: 170 } as const;
export const ONBOARDING_DOT_SPRING = { damping: 16, stiffness: 220 } as const;
export const ONBOARDING_PARALLAX_FACTOR = 0.28;
export const ONBOARDING_SWAY_DEG = 7;
export const ONBOARDING_SWAY_DURATION_MS = 1400;
export const ONBOARDING_SCAN_DURATION_MS = 1800;
export const ONBOARDING_PULSE_DURATION_MS = 900;
export const ONBOARDING_ARROW_DURATION_MS = 1100;

export const MODAL_SLIDE_DURATION_MS = 280;
export const MODAL_BACKDROP_MAX_OPACITY = 0.56;
export const CONSENT_ENTER_DURATION_MS = 200;
export const HERO_GROW_DURATION_MS = 280;

export const SHIMMER_DURATION_MS = 1200;
export const SPINNER_ROTATION_DURATION_MS = 800;
