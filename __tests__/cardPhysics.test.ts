import fs from 'fs';
import path from 'path';
import {
  CARD_SPRING_BACK,
  CARD_THROW_SPRING,
  PAN_ACTIVE_OFFSET_Y_PX,
  PAN_FAIL_OFFSET_X_PX,
  PASS_DISTANCE_PX,
  PASS_VELOCITY_PX,
  UNDO_DISTANCE_PX,
  UNDO_VELOCITY_PX,
  shouldCommitPass,
  shouldCommitUndo,
} from '../lib/motion';

describe('vertical pass intent', () => {
  it('eşiği aşan yukarı sürükleme commit eder', () => {
    expect(shouldCommitPass(-PASS_DISTANCE_PX, 0)).toBe(true);
    expect(shouldCommitPass(-120, -200)).toBe(true);
  });

  it('yüksek yukarı velocity kısa mesafede de commit eder', () => {
    expect(shouldCommitPass(-40, -PASS_VELOCITY_PX)).toBe(true);
  });

  it('eşik altı release spring-back', () => {
    expect(shouldCommitPass(-40, -400)).toBe(false);
  });

  it('aşağı hareket pass değildir', () => {
    expect(shouldCommitPass(120, 1400)).toBe(false);
    expect(shouldCommitPass(0, 0)).toBe(false);
  });
});

describe('vertical undo intent', () => {
  it('eşiği aşan veya hızlı aşağı sürükleme commit eder', () => {
    expect(shouldCommitUndo(UNDO_DISTANCE_PX, 0)).toBe(true);
    expect(shouldCommitUndo(40, UNDO_VELOCITY_PX)).toBe(true);
  });

  it('eşik altı ve yukarı hareket undo değildir', () => {
    expect(shouldCommitUndo(40, 400)).toBe(false);
    expect(shouldCommitUndo(-120, -1400)).toBe(false);
  });
});

describe('vertical pan lock', () => {
  it('yatay fail eşiği Y aktivasyonundan geniştir: hafif çapraz dikey kalır', () => {
    expect(PAN_FAIL_OFFSET_X_PX).toBeGreaterThan(PAN_ACTIVE_OFFSET_Y_PX);
  });
});

describe('paging contract: commit thresholds stay 84/920', () => {
  it('pass distance/velocity thresholds unchanged', () => {
    expect(PASS_DISTANCE_PX).toBe(84);
    expect(PASS_VELOCITY_PX).toBe(920);
    expect(UNDO_DISTANCE_PX).toBe(84);
    expect(UNDO_VELOCITY_PX).toBe(920);
  });
});

describe('paging contract: throw spring clamps overshoot', () => {
  it('CARD_THROW_SPRING and spring-back clamp overshoot', () => {
    expect(CARD_THROW_SPRING.overshootClamping).toBe(true);
    expect(CARD_SPRING_BACK.overshootClamping).toBe(true);
  });
});

describe('paging contract: page stride = H (no peek stack)', () => {
  const swipeCardSrc = fs.readFileSync(
    path.join(__dirname, '../components/SwipeCard.tsx'),
    'utf8',
  );
  const indexSrc = fs.readFileSync(
    path.join(__dirname, '../app/(tabs)/index.tsx'),
    'utf8',
  );

  it('pose is translateY = pageIndexSV * H + dragOffset only (no React pageIndex)', () => {
    expect(swipeCardSrc).toMatch(
      /pageIndexSV\.value \* H \+ dragOffset\.value/,
    );
    // Animated pose worklet stays pageIndexSV-based (React pageIndex is static mount only).
    const poseWorklet = swipeCardSrc.match(
      /const animatedCardStyle = useAnimatedStyle\(\(\) => \{[\s\S]*?\}\);/,
    );
    expect(poseWorklet).not.toBeNull();
    expect(poseWorklet![0]).toMatch(
      /translateY:\s*pageIndexSV\.value \* H \+ dragOffset\.value/,
    );
    expect(poseWorklet![0]).not.toMatch(/translateY:\s*pageIndex\s*\*/);
    expect(swipeCardSrc).not.toMatch(/getStackPose/);
    expect(swipeCardSrc).not.toMatch(/deckPullY/);
    expect(swipeCardSrc).not.toMatch(/UNDO_PARK/);
    expect(swipeCardSrc).not.toMatch(/peekStepPx/);
    expect(swipeCardSrc).not.toMatch(/stackIndex/);
    expect(swipeCardSrc).not.toMatch(/poseScale/);
  });

  it('static mount translateY = pageIndex * CARD_HEIGHT before animatedCardStyle', () => {
    expect(swipeCardSrc).toMatch(
      /slotTranslateStyle\s*=\s*useMemo\([\s\S]*?translateY:\s*pageIndex\s*\*\s*CARD_HEIGHT/,
    );
    const styleArray = swipeCardSrc.match(
      /style=\{\[\s*styles\.slot,[\s\S]*?animatedCardStyle,?[\s\S]*?\]\}/,
    );
    expect(styleArray).not.toBeNull();
    const block = styleArray![0];
    const staticIdx = block.indexOf('slotTranslateStyle');
    const animatedIdx = block.indexOf('animatedCardStyle');
    expect(staticIdx).toBeGreaterThanOrEqual(0);
    expect(animatedIdx).toBeGreaterThan(staticIdx);
  });

  it('Discover index atomically writes all pageIndexSVs + dragOffset via runOnUI', () => {
    expect(indexSrc).toMatch(/runOnUI/);
    expect(indexSrc).toMatch(/pageIndexSVByIdRef/);
    expect(indexSrc).toMatch(/registerPageIndexSV/);
    expect(indexSrc).toMatch(/dragOffset\.value = nextDrag/);
  });

  it('Discover index mounts prev/current/next without peek band', () => {
    expect(indexSrc).toMatch(/pageIndex: -1/);
    expect(indexSrc).toMatch(/pageIndex: 0/);
    expect(indexSrc).toMatch(/pageIndex: 1/);
    expect(indexSrc).toMatch(/pageIndex: 2/);
    expect(indexSrc).not.toMatch(/deckPeekStepForHeight/);
    expect(indexSrc).not.toMatch(/peekBandPx/);
    expect(indexSrc).not.toMatch(/deckPullY/);
    expect(indexSrc).not.toMatch(/stackIndex/);
    expect(indexSrc).not.toMatch(/getStackPose/);
  });

  it('commit springs keep velocity transfer on pass and undo', () => {
    const throwWithVelocity = /\.\.\.CARD_THROW_SPRING,\s*velocity:\s*vy/g;
    const matches = swipeCardSrc.match(throwWithVelocity) ?? [];
    // Pass (+H hedefi -H) ve undo (+H) — ikisi de velocity taşır.
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(swipeCardSrc).toMatch(/shouldCommitPass\(y, vy\)/);
    expect(swipeCardSrc).toMatch(/shouldCommitUndo\(y, vy\)/);
  });
});

describe('overlay cleanup: pass wash gone, undo toast gone, undoPass stays', () => {
  const swipeCardSrc = fs.readFileSync(
    path.join(__dirname, '../components/SwipeCard.tsx'),
    'utf8',
  );
  const indexSrc = fs.readFileSync(
    path.join(__dirname, '../app/(tabs)/index.tsx'),
    'utf8',
  );
  const motionSrc = fs.readFileSync(
    path.join(__dirname, '../lib/motion.ts'),
    'utf8',
  );
  const themeSrc = fs.readFileSync(
    path.join(__dirname, '../lib/theme.ts'),
    'utf8',
  );

  it('SwipeCard/motion/index have no pass-wash overlay writers', () => {
    const washResidue =
      /passWash|passChrome|throwFade|passOverlay|passStamp|passProgress/;
    expect(swipeCardSrc).not.toMatch(washResidue);
    expect(motionSrc).not.toMatch(washResidue);
    expect(indexSrc).not.toMatch(washResidue);
    expect(themeSrc).not.toMatch(/passWash/);
  });

  it('undo toast is gone; ↓ undoPass wiring remains', () => {
    expect(indexSrc).not.toMatch(/Geri alındı/);
    expect(indexSrc).not.toMatch(/UNDO_TOAST/);
    expect(indexSrc).toMatch(/const undoPass = useAppStore/);
    expect(indexSrc).toMatch(/undoPass\(\)/);
    expect(indexSrc).toMatch(/onUndoPass=\{handleUndoPass\}/);
    expect(swipeCardSrc).toMatch(/shouldCommitUndo\(y, vy\)/);
    expect(swipeCardSrc).toMatch(/runOnJS\(handleUndoPass\)\(\)/);
  });
});
