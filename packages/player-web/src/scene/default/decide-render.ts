import { Container, Graphics } from 'pixi.js';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import { idlePulse, slamAlpha, slamOffset, slamScale } from './motion.ts';
import { decideCover, DECIDE_TIMELINE, pieceRawT } from './transition.ts';
import {
  DEFAULT_THEME as T,
  fillBgBands,
  fillDiamond,
  fillDiamondCluster,
  fillParallelogram,
  fillSlash,
  paintSceneCover,
  strokeDiamond,
} from './theme.ts';

export interface DefaultDecideModel {
  designWidth: number;
  designHeight: number;
  song: BrowserSongEntry;
  difficultyLabel: string;
  sceneElapsedMs: number;
  nowMs: number;
}

const DIFFICULTY_LABELS = ['READY', 'BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'INSANE'] as const;

export function formatDefaultDifficultyLabel(
  difficulty: number | undefined,
  playLevel: string | number | undefined,
): string {
  const index = difficulty !== undefined && Number.isInteger(difficulty) ? difficulty : 0;
  const name = DIFFICULTY_LABELS[index] ?? DIFFICULTY_LABELS[0];
  if (playLevel === undefined || playLevel === '') return name;
  return `${name}  Lv ${playLevel}`;
}

export function renderDefaultDecideChrome(layer: Container, model: DefaultDecideModel): void {
  const chrome = new Graphics();
  chrome.label = 'default-decide/chrome';
  const { designWidth, designHeight, song } = model;
  const elapsed = model.sceneElapsedMs;
  fillBgBands(chrome, model.nowMs);

  const cx = designWidth / 2;
  const cy = designHeight / 2;
  const lineT = pieceRawT(elapsed, DECIDE_TIMELINE.line);
  chrome.rect(0, cy - 1, designWidth * lineT, 2).fill({ color: T.accent, alpha: 0.85 * lineT });

  const slashT = pieceRawT(elapsed, DECIDE_TIMELINE.slash);
  fillSlash(chrome, -80, cy - 64, 360, 52, 28, T.accent, 0.95 * slashT);
  fillSlash(chrome, 280, cy - 48, 420, 18, 12, T.paper, 0.18 * slashT);
  fillParallelogram(chrome, cx - 210, cy - 28, 420, 56, 22, T.inkDeep, 0.92 * slashT);
  fillSlash(chrome, cx - 200, cy - 22, 400, 44, 16, T.accent, 0.88 * slashT);
  fillDiamondCluster(chrome, cx, cy - 8, 78, 96, model.nowMs, T.inkDeep, 0.55 * slashT, 7);
  strokeDiamond(chrome, { cx, cy: cy - 8, rx: 86, ry: 108, nowMs: model.nowMs, wobble: 8 }, T.accent, 2.5, 0.7 * slashT);
  for (let i = 0; i < 6; i += 1) {
    const ang = (Math.PI * 2 * i) / 6 + model.nowMs / 1400;
    fillDiamond(
      chrome,
      {
        cx: cx + Math.cos(ang) * 132,
        cy: cy - 8 + Math.sin(ang) * 96,
        rx: 9,
        ry: 12,
        nowMs: model.nowMs,
        phase: i * 0.4,
        wobble: 3.2,
      },
      i % 2 === 0 ? T.accent : T.paper,
      0.55 * slashT,
    );
  }

  const titleT = pieceRawT(elapsed, DECIDE_TIMELINE.title);
  fillDiamond(chrome, { cx: 48, cy: 86, rx: 10, ry: 13, nowMs: model.nowMs, wobble: 3.4 }, T.accent, 0.55 * titleT);
  fillDiamond(chrome, { cx: designWidth - 48, cy: 86, rx: 10, ry: 13, nowMs: model.nowMs, phase: 0.7, wobble: 3.4 }, T.paper, 0.4 * titleT);
  addChromeText(layer, song.title, cx, 78, {
    size: 28,
    fill: T.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    anchorX: 0.5,
    maxWidth: 560,
    letterSpacing: 1.2,
    rotation: -0.04,
    slam: slamScale(titleT, 2.2),
    offsetX: slamOffset(titleT, -72),
    alpha: slamAlpha(titleT),
    stroke: { color: T.ink, width: 6, alignment: 0.5, join: 'round' },
  });
  const artistT = pieceRawT(elapsed, DECIDE_TIMELINE.artist);
  addChromeText(layer, song.artist || song.subtitle || '', cx, 118, {
    size: 13,
    fill: T.mute,
    fontFamily: DEFAULT_TEXT_FONT,
    anchorX: 0.5,
    maxWidth: 520,
    slam: slamScale(artistT, 1.4),
    offsetY: slamOffset(artistT, 18),
    alpha: slamAlpha(artistT),
  });
  const metaT = pieceRawT(elapsed, DECIDE_TIMELINE.meta);
  addChromeText(layer, model.difficultyLabel, cx, 318, {
    size: 16,
    fill: T.gold,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 4,
    anchorX: 0.5,
    rotation: -0.05,
    slam: slamScale(metaT, 1.8),
    offsetX: slamOffset(metaT, 48),
    alpha: slamAlpha(metaT),
  });
  const readyT = pieceRawT(elapsed, DECIDE_TIMELINE.ready);
  addChromeText(layer, 'READY', cx, cy - 10, {
    size: 42,
    fill: T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 10,
    anchorX: 0.5,
    rotation: -0.1,
    slam: slamScale(readyT, 2.8),
    offsetX: slamOffset(readyT, -90),
    alpha: slamAlpha(readyT) * idlePulse(model.nowMs, 720),
    stroke: { color: T.ink, width: 7, alignment: 0.5, join: 'round' },
  });

  paintSceneCover(layer, decideCover(elapsed), model.nowMs, { width: designWidth, height: designHeight });
  const glow = new Graphics();
  glow.label = 'default-decide/glow';
  glow.blendMode = 'add';
  fillDiamond(glow, { cx, cy: cy - 8, rx: 96, ry: 120, nowMs: model.nowMs, wobble: 9 }, T.accent, 0.2 * slashT);
  fillDiamond(glow, { cx, cy: cy - 8, rx: 54, ry: 68, nowMs: model.nowMs, phase: 0.5, wobble: 6 }, T.paper, 0.12 * slashT);
  layer.addChildAt(chrome, 0);
  layer.addChildAt(glow, 1);
}
