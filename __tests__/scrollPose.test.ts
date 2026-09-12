import {
  clampScrollY,
  nearestPage,
  pageStride,
  PAN_ACTIVE_OFFSET_Y_PX,
  PAN_FAIL_OFFSET_X_PX,
  PASS_DISTANCE_PX,
  PASS_VELOCITY_PX,
  slotTranslateY,
  targetPageAfterRelease,
} from '../components/deckv2/scrollPose';

describe('pageStride', () => {
  it('kart yüksekliği eksi peek şeridi', () => {
    expect(pageStride(600, 4)).toBe(596);
    expect(pageStride(600, 6)).toBe(594);
  });

  it('sıfır/negatif stride yerine en az 1', () => {
    expect(pageStride(4, 4)).toBe(1);
    expect(pageStride(3, 10)).toBe(1);
  });
});

describe('slotTranslateY', () => {
  const stride = 596;

  it('rest: ön kart 0, sonraki pageStride', () => {
    expect(slotTranslateY(0, 0, stride)).toBe(0);
    expect(slotTranslateY(0, 1, stride)).toBe(stride);
    expect(slotTranslateY(0, 2, stride)).toBe(2 * stride);
  });

  it('scrollY artınca kartlar yukarı kayar (Instagram)', () => {
    expect(slotTranslateY(stride, 0, stride)).toBe(-stride);
    expect(slotTranslateY(stride, 1, stride)).toBe(0);
  });

  it('undo yönü: negatif scrollY, index -1 öne gelir', () => {
    expect(slotTranslateY(-stride, -1, stride)).toBe(0);
    expect(slotTranslateY(-stride, 0, stride)).toBe(stride);
  });
});

describe('nearestPage', () => {
  it('pageStride ile yuvarlar', () => {
    expect(nearestPage(0, 596)).toBe(0);
    expect(nearestPage(297, 596)).toBe(0);
    expect(nearestPage(298, 596)).toBe(1);
    expect(nearestPage(-298, 596)).toBe(0); // JS Math.round(-0.5) → -0 → 0
    expect(nearestPage(-299, 596)).toBe(-1);
  });

  it('geçersiz stride 0 sayfa', () => {
    expect(nearestPage(100, 0)).toBe(0);
  });
});

describe('targetPageAfterRelease', () => {
  const stride = 596;

  it('mesafe eşiği aşılınca sonraki sayfaya commit', () => {
    expect(
      targetPageAfterRelease(PASS_DISTANCE_PX, 0, stride, PASS_DISTANCE_PX, PASS_VELOCITY_PX),
    ).toBe(1);
    expect(
      targetPageAfterRelease(120, -200, stride, PASS_DISTANCE_PX, PASS_VELOCITY_PX),
    ).toBe(1);
  });

  it('yukarı velocity kısa mesafede sonraki sayfa', () => {
    expect(
      targetPageAfterRelease(40, -PASS_VELOCITY_PX, stride, PASS_DISTANCE_PX, PASS_VELOCITY_PX),
    ).toBe(1);
  });

  it('aşağı mesafe/velocity önceki sayfa (undo)', () => {
    expect(
      targetPageAfterRelease(-PASS_DISTANCE_PX, 0, stride, PASS_DISTANCE_PX, PASS_VELOCITY_PX),
    ).toBe(-1);
    expect(
      targetPageAfterRelease(-40, PASS_VELOCITY_PX, stride, PASS_DISTANCE_PX, PASS_VELOCITY_PX),
    ).toBe(-1);
  });

  it('eşik altı nearest (genelde 0)', () => {
    expect(
      targetPageAfterRelease(40, -400, stride, PASS_DISTANCE_PX, PASS_VELOCITY_PX),
    ).toBe(0);
    expect(
      targetPageAfterRelease(0, 0, stride, PASS_DISTANCE_PX, PASS_VELOCITY_PX),
    ).toBe(0);
  });
});

describe('clampScrollY', () => {
  const stride = 596;

  it('min/max sayfa aralığında tutar', () => {
    expect(clampScrollY(2000, 0, 1, stride)).toBe(stride);
    expect(clampScrollY(-2000, 0, 1, stride)).toBe(0);
    expect(clampScrollY(-2000, -1, 1, stride)).toBe(-stride);
    expect(clampScrollY(100, -1, 1, stride)).toBe(100);
  });
});

describe('re-exported pan/pass constants', () => {
  it('motion eşikleriyle aynı', () => {
    expect(PAN_ACTIVE_OFFSET_Y_PX).toBe(8);
    expect(PAN_FAIL_OFFSET_X_PX).toBe(12);
    expect(PASS_DISTANCE_PX).toBe(84);
    expect(PASS_VELOCITY_PX).toBe(920);
    expect(PAN_FAIL_OFFSET_X_PX).toBeGreaterThan(PAN_ACTIVE_OFFSET_Y_PX);
  });
});
