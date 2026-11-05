import type { Container } from 'pixi.js';
import {
  effectProfile,
  flashingGreatColor,
  isFlashingGreat,
  judgeDisplayWord,
  resolveLanePlayLabel,
  punchScale,
  type BeMusicGameplayLayout,
  type BeMusicGameplayRuntime,
} from '@be-music/player-skin-sdk';
import { addHUDText, addHUDNumber, type ChildPool } from '../pixi-kit/index.ts';
import {
  SYN_AMBER,
  SYN_EMBER,
  SYN_CYAN,
  SYN_WHITE,
  SYN_MAGENTA,
  SYN_GREEN,
  SYN_RED,
  SYN_FLARE,
  displayStyle,
  labelStyle,
} from './style.ts';
type Runtime = BeMusicGameplayRuntime;
const JUDGE_COLORS: Record<string, number> = {
  PERFECT: SYN_FLARE,
  GREAT: SYN_AMBER,
  GOOD: SYN_CYAN,
  BAD: SYN_MAGENTA,
  POOR: SYN_RED,
};

/** Colours the PERFECT judgement's flashing GREAT cycles through. */
const FLASHING_GREAT = [SYN_CYAN, SYN_WHITE, SYN_AMBER, SYN_MAGENTA, SYN_GREEN] as const;

/**
 * Judgement word and combo as light: wide tracked type with a same-colour bloom. PERFECT prints as a GREAT that flashes
 * through the prism colours, so a clean run literally shimmers.
 */
export function drawJudgements(
  layer: Container,
  runtime: Runtime,
  layout: BeMusicGameplayLayout,
  wordY: number,
  pool: ChildPool,
): void {
  for (const side of ['1P', '2P'] as const) {
    const bounds = layout.playfield.sides[side];
    const mode = resolveLanePlayLabel(runtime, side);
    if (!bounds || !mode) continue;
    addHUDText(
      layer,
      mode,
      (bounds.left + bounds.right) / 2,
      wordY + ((bounds.judgementY ?? layout.playfield.judgementY) - layout.playfield.judgementY) - 28,
      { ...labelStyle(), fill: SYN_WHITE, anchorX: 0.5, anchorY: 0.5, maxWidth: bounds.right - bounds.left - 12 },
      pool,
    );
  }
  const displays = resolveJudgeDisplays(runtime, layout);
  const nowMs = runtime.nowMs ?? 0;
  const amount = effectProfile(runtime.effects).amount;
  for (const display of displays) {
    const judgeScale = punchScale(runtime.judgeAtMs, nowMs, 120, 0.22 * amount);
    const color = isFlashingGreat(display.judge)
      ? flashingGreatColor(nowMs, FLASHING_GREAT)
      : (JUDGE_COLORS[display.judge] ?? SYN_WHITE);
    addHUDText(
      layer,
      judgeDisplayWord(display.judge),
      display.x,
      wordY + display.lift,
      {
        scale: judgeScale,
        ...displayStyle(16, color),
        letterSpacing: 4,
        anchorX: 0.5,
        anchorY: 0.5,
        maxWidth: display.maxWidth,
        dropShadow: { color, alpha: 0.95, blur: 10, distance: 0 },
      },
      pool,
    );
    const combo = resolveVisibleCombo(display.judge, display.combo);
    if (combo > 0) {
      addHUDNumber(
        layer,
        formatCount(combo),
        display.x,
        wordY + display.lift + 28,
        {
          scale: punchScale(runtime.judgeAtMs, nowMs, 150, (combo % 100 === 0 ? 0.45 : 0.14) * amount),
          ...displayStyle(22, combo >= 200 ? SYN_AMBER : SYN_WHITE),
          anchorX: 0.5,
          anchorY: 0.5,
          maxWidth: Math.max(60, display.maxWidth - 40),
          dropShadow: { color: combo >= 200 ? SYN_AMBER : SYN_EMBER, alpha: 0.85, blur: 10, distance: 0 },
        },
        pool,
      );
    }
  }
}

function resolveJudgeDisplays(
  runtime: Runtime,
  layout: BeMusicGameplayLayout,
): Array<{ judge: string; combo: number | undefined; x: number; lift: number; maxWidth: number }> {
  const centerOf = (side: '1P' | '2P'): number | undefined => {
    const bounds = layout.playfield.sides[side];
    return bounds ? (bounds.left + bounds.right) / 2 : undefined;
  };
  // A side's LIFT raises its judgement line, and its judgement word with it.
  const liftOf = (side: '1P' | '2P'): number =>
    (layout.playfield.sides[side]?.judgementY ?? layout.playfield.judgementY) - layout.playfield.judgementY;
  const doublePlay = centerOf('2P') !== undefined;
  const maxWidth = doublePlay ? 122 : 180;
  const fallbackX = layout.playfield.centerX;
  const sides = runtime.judgeSides?.filter((state) => typeof state.judge === 'string' && state.judge.length > 0);
  if (sides?.length) {
    return sides.map((state) => ({
      judge: state.judge!,
      combo: state.combo,
      x: centerOf(state.side) ?? fallbackX,
      lift: liftOf(state.side),
      maxWidth,
    }));
  }
  if (!runtime.lastJudge) return [];
  return [
    { judge: runtime.lastJudge, combo: runtime.combo, x: centerOf('1P') ?? fallbackX, lift: liftOf('1P'), maxWidth },
  ];
}

function resolveVisibleCombo(judge: string, combo: number | undefined): number {
  if (judge !== 'PERFECT' && judge !== 'GREAT' && judge !== 'GOOD') return 0;
  return combo !== undefined && Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
}

function formatCount(value: number | undefined): string {
  return String(Math.max(0, Math.floor(value ?? 0)));
}
