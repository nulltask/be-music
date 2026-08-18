import { Container, Graphics } from 'pixi.js';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import { idlePulse, slamAlpha, slamOffset, slamScale } from './motion.ts';
import { decideCover, DECIDE_TIMELINE, pieceRawT } from './transition.ts';
import {
  DEFAULT_THEME as T,
  fillBgBands,
  fillParallelogram,
  fillSlash,
  paintSceneCover,
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
  fillBgBands(chrome);

  const cx = designWidth / 2;
  const cy = designHeight / 2;
  const lineT = pieceRawT(elapsed, DECIDE_TIMELINE.line);
  chrome.rect(0, cy - 1, designWidth * lineT, 2).fill({ color: T.accent, alpha: 0.85 * lineT });

  const slashT = pieceRawT(elapsed, DECIDE_TIMELINE.slash);
  fillSlash(chrome, -80, cy - 64, 360, 52, 28, T.accent, 0.95 * slashT);
  fillSlash(chrome, 280, cy - 48, 420, 18, 12, T.paper, 0.18 * slashT);
  fillParallelogram(chrome, cx - 210, cy - 28, 420, 56, 22, T.inkDeep, 0.92 * slashT);
  fillSlash(chrome, cx - 200, cy - 22, 400, 44, 16, T.accent, 0.88 * slashT);

  const titleT = pieceRawT(elapsed, DECIDE_TIMELINE.title);
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
  layer.addChildAt(chrome, 0);
}
