import { Container, Graphics } from 'pixi.js';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import { idleGlow, slideOffset } from './motion.ts';
import { decideCover, DECIDE_TIMELINE, pieceT } from './transition.ts';
import { DEFAULT_THEME as T, fillBgBands, fillTriangle, paintSceneCover, strokeClockRing } from './theme.ts';

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
  const lineT = pieceT(elapsed, DECIDE_TIMELINE.line);
  chrome.rect(0, cy - 1, designWidth * lineT, 2).fill({ color: T.cyan, alpha: 0.85 * lineT });

  const clockT = pieceT(elapsed, DECIDE_TIMELINE.clock);
  strokeClockRing(chrome, cx, cy - 24, 78, clockT, T.cyan, 0.55 * clockT, 2, model.nowMs / 1400);
  strokeClockRing(chrome, cx, cy - 24, 54, clockT, T.gold, 0.35 * clockT, 1.5, -model.nowMs / 900);
  fillTriangle(chrome, cx, cy - 24, 22 * clockT, T.gold, 0.8 * clockT, true);

  const shardT = pieceT(elapsed, DECIDE_TIMELINE.shards);
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8 + model.nowMs / 2000;
    const dist = 110 + (1 - shardT) * 40;
    fillTriangle(
      chrome,
      cx + Math.cos(angle) * dist,
      cy - 24 + Math.sin(angle) * dist,
      10,
      i % 2 === 0 ? T.cyan : T.ice,
      0.45 * shardT,
      i % 2 === 1,
    );
  }

  const titleT = pieceT(elapsed, DECIDE_TIMELINE.title);
  addChromeText(layer, song.title, cx, 78 + slideOffset(titleT, -20), {
    size: 26,
    weight: '700',
    fill: T.ice,
    fontFamily: DEFAULT_TEXT_FONT,
    anchorX: 0.5,
    maxWidth: 560,
    alpha: titleT,
    letterSpacing: 1.2,
  });
  const artistT = pieceT(elapsed, DECIDE_TIMELINE.artist);
  addChromeText(layer, song.artist || song.subtitle || '', cx, 112 + slideOffset(artistT, 12), {
    size: 13,
    weight: '500',
    fill: T.mute,
    anchorX: 0.5,
    maxWidth: 520,
    alpha: artistT,
  });
  const metaT = pieceT(elapsed, DECIDE_TIMELINE.meta);
  addChromeText(layer, model.difficultyLabel, cx, 318 + slideOffset(metaT, 16), {
    size: 14,
    weight: '700',
    fill: T.gold,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 4,
    anchorX: 0.5,
    alpha: metaT,
  });
  addChromeText(layer, 'READY', cx, 348, {
    size: 11,
    weight: '700',
    fill: T.cyan,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 8,
    anchorX: 0.5,
    alpha: metaT * idleGlow(model.nowMs, 900),
  });

  paintSceneCover(layer, decideCover(elapsed), model.nowMs, { width: designWidth, height: designHeight });
  layer.addChildAt(chrome, 0);
}
