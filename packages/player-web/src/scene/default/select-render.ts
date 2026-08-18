import { Container, Graphics } from 'pixi.js';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../collection/types.ts';
import { resolveChartPlayVariant } from '../../collection/collection.ts';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import { slamAlpha, slamOffset, slamScale } from './motion.ts';
import { DEFAULT_SELECT_LAYOUT, defaultSelectListWidth } from './select-layout.ts';
import { coverAmount, pieceRawT, SELECT_TIMELINE, selectRowRawT } from './transition.ts';
import {
  DEFAULT_THEME as T,
  fillBgBands,
  fillParallelogram,
  fillSlash,
  paintSceneCover,
  strokeParallelogram,
} from './theme.ts';

export interface DefaultSelectChromeModel {
  designWidth: number;
  designHeight: number;
  categoryName: string;
  songTitle: string;
  songArtist: string;
  modeLabel: string;
  playLevel: string;
  playLevelNumber: number;
  songBpm: string;
  fileLabel: string;
  selectedPosition: string;
  searchQuery: string;
  shownCount: number;
  libraryCount: number;
  sceneElapsedMs: number;
  nowMs: number;
  cursorY: number;
}

export interface DefaultSelectRowModel {
  entry: BrowserBrowseEntry;
  entryIndex: number;
  visibleIndex: number;
  active: boolean;
}

export function renderDefaultSelectChrome(layer: Container, model: DefaultSelectChromeModel): Graphics {
  const chrome = new Graphics();
  chrome.label = 'default-select/chrome';
  const { designWidth, designHeight } = model;
  const elapsed = model.sceneElapsedMs;
  fillBgBands(chrome);
  fillParallelogram(chrome, -16, 0, designWidth + 32, 42, 22, T.inkDeep, 0.94);
  fillSlash(chrome, -80, -8, 340, 46, 26, T.accent, 0.92);

  const headerT = pieceRawT(elapsed, SELECT_TIMELINE.header);
  addChromeText(layer, 'MUSIC SELECT', 18, 6, {
    size: 22,
    fill: T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 2,
    rotation: -0.08,
    slam: slamScale(headerT, 2.4),
    offsetX: slamOffset(headerT, -64),
    alpha: slamAlpha(headerT),
    stroke: { color: T.ink, width: 5, alignment: 0.5, join: 'round' },
  });
  addChromeText(layer, model.categoryName, designWidth - 16, 10, {
    size: 11,
    fill: T.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    anchorX: 1,
    maxWidth: 240,
    slam: slamScale(headerT, 1.5),
    alpha: slamAlpha(headerT),
  });

  const detailT = pieceRawT(elapsed, SELECT_TIMELINE.detail);
  fillParallelogram(chrome, 8, 50, 300, 314, 16, T.panel, detailT);
  strokeParallelogram(chrome, 8, 50, 300, 314, 16, T.accent, 2, 0.85 * detailT);
  fillSlash(chrome, 4, 52, 40, 48, 10, T.accent, detailT);
  chrome.rect(22, 96, 268 * Math.max(0.08, detailT), 2).fill({ color: T.accent, alpha: 0.7 * detailT });

  fillParallelogram(chrome, 20, 148, 80, 50, 8, T.inkDeep, detailT);
  fillParallelogram(chrome, 108, 148, 80, 50, 8, T.inkDeep, detailT);
  fillParallelogram(chrome, 196, 148, 96, 50, 8, T.inkDeep, detailT);
  chrome.rect(22, 224, 268, 12).fill({ color: T.inkDeep, alpha: detailT });
  if (Number.isFinite(model.playLevelNumber)) {
    const levelRatio = Math.max(0.04, Math.min(1, model.playLevelNumber / 12));
    fillSlash(chrome, 22, 224, Math.round(268 * levelRatio * Math.max(0.12, detailT)), 12, 3, T.accent, 0.95 * detailT);
  }

  addChromeText(layer, 'SELECTED', 24, 62, { ...stampLabel(), alpha: slamAlpha(detailT) });
  addChromeText(layer, model.songTitle, 24, 100, {
    size: 17,
    fill: T.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    maxWidth: 268,
    slam: slamScale(detailT, 1.45),
    offsetX: slamOffset(detailT, -36),
    rotation: -0.02,
    alpha: slamAlpha(detailT),
  });
  if (model.songArtist) {
    addChromeText(layer, model.songArtist, 24, 126, {
      size: 10,
      fill: T.mute,
      fontFamily: DEFAULT_TEXT_FONT,
      maxWidth: 268,
      alpha: slamAlpha(detailT),
    });
  }
  addChromeText(layer, 'MODE', 32, 154, { ...stampLabel(), alpha: slamAlpha(detailT) });
  addChromeText(layer, model.modeLabel, 32, 170, {
    size: 13,
    fill: T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    maxWidth: 60,
    alpha: slamAlpha(detailT),
  });
  addChromeText(layer, 'BPM', 118, 154, { ...stampLabel(), alpha: slamAlpha(detailT) });
  addChromeText(layer, model.songBpm, 118, 168, {
    size: 18,
    fill: T.gold,
    fontFamily: DEFAULT_NUMERIC_FONT,
    slam: slamScale(detailT, 1.7),
    alpha: slamAlpha(detailT),
  });
  addChromeText(layer, 'LEVEL', 208, 154, { ...stampLabel(), alpha: slamAlpha(detailT) });
  addChromeText(layer, model.playLevel, 208, 164, {
    size: 22,
    fill: T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    rotation: -0.06,
    slam: slamScale(detailT, 2.2),
    alpha: slamAlpha(detailT),
  });
  if (model.fileLabel) {
    addChromeText(layer, model.fileLabel, 24, 248, {
      size: 8,
      fill: T.mute,
      fontFamily: DEFAULT_TEXT_FONT,
      maxWidth: 268,
      alpha: slamAlpha(detailT),
    });
  }
  addChromeText(layer, model.selectedPosition, 24, 346, {
    size: 12,
    fill: T.mute,
    fontFamily: DEFAULT_NUMERIC_FONT,
    alpha: slamAlpha(detailT),
  });

  const actionT = pieceRawT(elapsed, SELECT_TIMELINE.actions);
  const play = DEFAULT_SELECT_LAYOUT.play;
  const auto = DEFAULT_SELECT_LAYOUT.auto;
  fillParallelogram(chrome, play.x, play.y, play.w, play.h, 8, T.panelLift, actionT);
  strokeParallelogram(chrome, play.x, play.y, play.w, play.h, 8, T.paper, 1, 0.7 * actionT);
  fillParallelogram(chrome, auto.x, auto.y, auto.w, auto.h, 10, T.accent, actionT);
  addChromeText(layer, 'PLAY', play.x + play.w / 2, play.y + 6, {
    size: 14,
    fill: T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    letterSpacing: 1.4,
    slam: slamScale(actionT, 1.8),
    alpha: slamAlpha(actionT),
  });
  addChromeText(layer, 'AUTO PLAY', auto.x + auto.w / 2, auto.y + 6, {
    size: 14,
    fill: T.ink,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    letterSpacing: 1.2,
    maxWidth: 158,
    slam: slamScale(actionT, 1.8),
    alpha: slamAlpha(actionT),
  });

  const searchT = pieceRawT(elapsed, SELECT_TIMELINE.search);
  const search = DEFAULT_SELECT_LAYOUT.search;
  fillParallelogram(chrome, search.x, search.y, search.w, search.h, 8, T.inkDeep, searchT);
  strokeParallelogram(chrome, search.x, search.y, search.w, search.h, 8, T.line, 1, 0.8 * searchT);
  addChromeText(layer, 'SEARCH', 24, 382, { ...stampLabel(), alpha: slamAlpha(searchT) });
  addChromeText(layer, model.searchQuery || 'Title / artist / genre', 82, 380, {
    size: 10,
    fill: model.searchQuery ? T.paper : T.mute,
    fontFamily: DEFAULT_TEXT_FONT,
    maxWidth: 210,
    alpha: slamAlpha(searchT),
  });

  fillParallelogram(chrome, 8, 416, 300, 48, 10, T.panel, searchT);
  addChromeText(layer, 'LIBRARY', 24, 424, { ...stampLabel(), alpha: slamAlpha(searchT) });
  addChromeText(layer, `${model.shownCount} shown / ${model.libraryCount} charts`, 24, 438, {
    size: 11,
    fill: T.mute,
    fontFamily: DEFAULT_TEXT_FONT,
    alpha: slamAlpha(searchT),
  });

  const listT = pieceRawT(elapsed, SELECT_TIMELINE.list);
  fillParallelogram(
    chrome,
    DEFAULT_SELECT_LAYOUT.listX - 6,
    46,
    designWidth - DEFAULT_SELECT_LAYOUT.listX - 8,
    designHeight - 70,
    12,
    T.inkDeep,
    0.9 * listT,
  );
  strokeParallelogram(
    chrome,
    DEFAULT_SELECT_LAYOUT.listX - 6,
    46,
    designWidth - DEFAULT_SELECT_LAYOUT.listX - 8,
    designHeight - 70,
    12,
    T.line,
    1,
    0.85 * listT,
  );
  addChromeText(layer, model.searchQuery ? 'SEARCH RESULTS' : 'CHARTS', 328, 22, {
    size: 11,
    fill: T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 1.4,
    rotation: -0.05,
    slam: slamScale(listT, 1.7),
    alpha: slamAlpha(listT),
  });

  layer.addChildAt(chrome, 0);
  return chrome;
}

export function renderDefaultSelectRow(
  layer: Container,
  row: DefaultSelectRowModel,
  cursorY: number,
  sceneElapsedMs: number,
): void {
  const { listX, rowHeight } = DEFAULT_SELECT_LAYOUT;
  const listWidth = defaultSelectListWidth(DEFAULT_SELECT_LAYOUT.designWidth);
  const y = DEFAULT_SELECT_LAYOUT.listTop + row.visibleIndex * rowHeight;
  const t = selectRowRawT(sceneElapsedMs, row.visibleIndex);
  const throwX = slamOffset(t, row.active ? -18 : -22);
  const rowSlam = slamScale(t, row.active ? 1.18 : 1.12);
  const gfx = new Graphics();
  gfx.label = `fallback-row[idx=${row.entryIndex},kind=${row.entry.kind}${row.active ? ',active' : ''}]`;
  gfx.alpha = slamAlpha(t);
  const song = row.entry.kind === 'song' ? row.entry.song : undefined;
  const folder = row.entry.kind === 'folder' ? row.entry.folder : undefined;
  const titleText = song?.title ?? folder?.label ?? '';
  const keyText = song ? `${resolveChartPlayVariant(song)}` : 'DIR';
  const metaText = song
    ? [song.playLevel !== undefined ? `Lv ${song.playLevel}` : undefined, song.bpm ? `${song.bpm}BPM` : undefined]
        .filter(Boolean)
        .join('  ·  ')
    : `${folder?.songs.length ?? 0} chart${folder?.songs.length === 1 ? '' : 's'}`;
  const playLevelText =
    song?.playLevel !== undefined ? String(song.playLevel) : folder ? String(folder.songs.length) : '-';
  const keyPillX = listX + 6;
  const keyPillW = 28;
  const levelPillX = keyPillX + keyPillW + 4;
  const levelPillW = 28;
  const titleX = levelPillX + levelPillW + 8;
  const textMaxWidth = Math.max(24, listWidth - (titleX - listX) - 8);

  if (row.active) {
    fillParallelogram(gfx, listX - 8 + throwX, y - 2, listWidth + 16, rowHeight + 2, 10, T.accent, 0.96);
    strokeParallelogram(gfx, listX - 8 + throwX, y - 2, listWidth + 16, rowHeight + 2, 10, T.paper, 1.5, 0.8);
    fillSlash(gfx, listX - 18 + throwX, cursorY + 4, 22, rowHeight - 8, 4, T.paper, 0.9);
  } else {
    fillParallelogram(gfx, listX + throwX, y, listWidth, rowHeight - 3, 6, T.panel, 0.82);
    strokeParallelogram(gfx, listX + throwX, y, listWidth, rowHeight - 3, 6, T.line, 1, 0.7);
  }

  fillParallelogram(gfx, keyPillX + throwX, y + 5, keyPillW, rowHeight - 12, 4, row.active ? T.ink : T.panelLift, 1);
  fillParallelogram(gfx, levelPillX + throwX, y + 5, levelPillW, rowHeight - 12, 4, row.active ? T.ink : T.inkDeep, 1);
  layer.addChild(gfx);

  addChromeText(layer, keyText, keyPillX + keyPillW / 2 + throwX, y + rowHeight / 2 - 1, {
    size: 10,
    fill: row.active ? T.paper : T.mute,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    anchorY: 0.5,
    maxWidth: keyPillW - 4,
    slam: rowSlam,
    alpha: slamAlpha(t),
  });
  addChromeText(layer, playLevelText, levelPillX + levelPillW / 2 + throwX, y + rowHeight / 2 - 1, {
    size: 12,
    fill: row.active ? T.gold : T.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    anchorY: 0.5,
    maxWidth: levelPillW - 4,
    slam: rowSlam,
    alpha: slamAlpha(t),
  });
  addChromeText(layer, titleText, titleX + throwX, y + 3, {
    size: 11,
    fill: row.active ? T.ink : T.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    maxWidth: textMaxWidth,
    slam: rowSlam,
    rotation: row.active ? -0.02 : 0,
    alpha: slamAlpha(t),
  });
  addChromeText(layer, metaText, titleX + throwX, y + 16, {
    size: 8,
    fill: row.active ? T.accentDeep : T.mute,
    fontFamily: DEFAULT_NUMERIC_FONT,
    maxWidth: textMaxWidth,
    alpha: slamAlpha(t),
  });
}

export function attachDefaultSelectHits(
  layer: Container,
  handlers: { onPlay: () => void; onAuto: () => void; onSearch: () => void },
): void {
  const searchHit = new Graphics();
  const search = DEFAULT_SELECT_LAYOUT.search;
  searchHit.rect(search.x, search.y, search.w, search.h).fill({ color: 0xffffff, alpha: 0.001 });
  searchHit.eventMode = 'static';
  searchHit.cursor = 'text';
  searchHit.on('pointerdown', handlers.onSearch);
  layer.addChild(searchHit);

  const playHit = new Graphics();
  const play = DEFAULT_SELECT_LAYOUT.play;
  playHit.rect(play.x, play.y, play.w, play.h).fill({ color: 0xffffff, alpha: 0.001 });
  playHit.eventMode = 'static';
  playHit.cursor = 'pointer';
  playHit.on('pointerdown', handlers.onPlay);
  layer.addChild(playHit);

  const autoHit = new Graphics();
  const auto = DEFAULT_SELECT_LAYOUT.auto;
  autoHit.rect(auto.x, auto.y, auto.w, auto.h).fill({ color: 0xffffff, alpha: 0.001 });
  autoHit.eventMode = 'static';
  autoHit.cursor = 'pointer';
  autoHit.on('pointerdown', handlers.onAuto);
  layer.addChild(autoHit);
}

export function formatDefaultSelectModeLabel(song: BrowserSongEntry | undefined): string {
  if (!song) return '- KEYS';
  return `${resolveChartPlayVariant(song)} KEYS`;
}

export function paintDefaultSelectCover(
  layer: Container,
  sceneElapsedMs: number,
  nowMs: number,
  designWidth: number,
  designHeight: number,
): void {
  paintSceneCover(
    layer,
    coverAmount(sceneElapsedMs, SELECT_TIMELINE.coverDelay, SELECT_TIMELINE.coverDuration, 'open'),
    nowMs,
    { width: designWidth, height: designHeight },
  );
}

function stampLabel(): { size: number; fill: number; fontFamily: string; letterSpacing: number } {
  return { size: 9, fill: T.mute, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 1.2 };
}
