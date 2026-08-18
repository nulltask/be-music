import { Container, Graphics } from 'pixi.js';
import { resolveChartPlayVariant } from '../../collection/collection.ts';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../collection/types.ts';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_NUMERIC_FONT, DEFAULT_TEXT_FONT } from './fonts.ts';
import { slamOffset, slamScale, staggerProgress } from './motion.ts';
import { DEFAULT_SELECT_LAYOUT } from './select-layout.ts';
import { DEFAULT_THEME, fillParallelogram, fillSlash, strokeParallelogram } from './theme.ts';

export interface DefaultSelectChromeInput {
  designWidth: number;
  designHeight: number;
  elapsedMs: number;
  selectedIndex: number;
  entries: readonly BrowserBrowseEntry[];
  searchQuery: string;
  categoryName: string;
  libraryShown: number;
  libraryTotal: number;
  song?: BrowserSongEntry;
  onSearchActivate?: () => void;
  onPlay?: () => void;
  onAutoPlay?: () => void;
}

export interface DefaultSelectRowInput {
  entry: BrowserBrowseEntry;
  entryIndex: number;
  visibleIndex: number;
  selectedIndex: number;
  elapsedMs: number;
  listX: number;
  listY: number;
  listWidth: number;
  rowHeight: number;
  selectedSlamT: number;
}

let lastSelectedIndex = Number.NaN;
let selectedSlamAtMs = 0;

export function beginDefaultSelectMotion(selectedIndex: number, elapsedMs: number): { selectedSlamT: number } {
  if (elapsedMs < 32) {
    lastSelectedIndex = selectedIndex;
    selectedSlamAtMs = elapsedMs - 1000;
    return { selectedSlamT: 1 };
  }
  if (selectedIndex !== lastSelectedIndex) {
    lastSelectedIndex = selectedIndex;
    selectedSlamAtMs = elapsedMs;
  }
  return { selectedSlamT: staggerProgress(elapsedMs, selectedSlamAtMs, 220) };
}

/**
 * Skinless song-select chrome: diagonal plates, slam-in title, and cut-in PLAY / AUTO stamps.
 */
export function renderDefaultSelectChrome(layer: Container, input: DefaultSelectChromeInput): void {
  const { designWidth, designHeight, elapsedMs } = input;
  const intro = staggerProgress(elapsedMs, 0, 420);
  const chrome = new Graphics();
  chrome.label = 'default-select/chrome';
  chrome.rect(0, 0, designWidth, designHeight).fill(DEFAULT_THEME.ink);
  fillSlash(chrome, -80, -10, 360, 48, 28, DEFAULT_THEME.crimson, 0.95);
  fillSlash(chrome, 300, 8, 380, 18, 10, DEFAULT_THEME.paper, 0.18);
  fillParallelogram(chrome, -16, 0, designWidth + 32, 42, 22, DEFAULT_THEME.inkDeep, 0.92);

  const song = input.song;
  const songTitle = song?.title ?? 'No chart selected';
  const songArtist = song?.artist || song?.subtitle || '';
  const playLevel = song?.playLevel !== undefined ? String(song.playLevel) : '-';
  const playLevelNumber =
    song?.playLevel !== undefined ? Number.parseFloat(String(song.playLevel).replace(/^[^\d.]+/u, '')) : NaN;
  const songBpm = song?.bpm !== undefined ? String(Math.round(song.bpm)) : '-';
  const fileLabel = song?.fileLabel ?? '';
  const modeLabel = formatDefaultSelectModeLabel(song);
  const selectedPosition =
    input.entries.length > 0
      ? `${Math.min(input.selectedIndex + 1, input.entries.length)} / ${input.entries.length}`
      : '0 / 0';

  addChromeText(layer, 'MUSIC SELECT', 18, 6, {
    size: 22,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 2,
    rotation: -0.08,
    slam: slamScale(intro, 2.4),
    offsetX: slamOffset(intro, -64),
    stroke: { color: DEFAULT_THEME.ink, width: 5, alignment: 0.5, join: 'round' },
  });
  addChromeText(layer, input.categoryName, designWidth - 16, 10, {
    size: 11,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    anchorX: 1,
    maxWidth: 240,
    slam: slamScale(staggerProgress(elapsedMs, 80, 280), 1.5),
  });

  fillParallelogram(chrome, 8, 50, 300, 314, 16, DEFAULT_THEME.panel, 1);
  strokeParallelogram(chrome, 8, 50, 300, 314, 16, DEFAULT_THEME.crimson, 2, 0.85);
  fillSlash(chrome, 4, 52, 40, 48, 10, DEFAULT_THEME.crimson, 1);
  chrome.rect(22, 96, 268, 2).fill({ color: DEFAULT_THEME.crimson, alpha: 0.7 });

  fillParallelogram(chrome, 20, 148, 80, 50, 8, DEFAULT_THEME.inkDeep, 1);
  fillParallelogram(chrome, 108, 148, 80, 50, 8, DEFAULT_THEME.inkDeep, 1);
  fillParallelogram(chrome, 196, 148, 96, 50, 8, DEFAULT_THEME.inkDeep, 1);
  chrome.rect(22, 224, 268, 12).fill(DEFAULT_THEME.inkDeep);
  if (Number.isFinite(playLevelNumber)) {
    const levelRatio = Math.max(0.04, Math.min(1, playLevelNumber / 12));
    fillSlash(chrome, 22, 224, Math.round(268 * levelRatio), 12, 3, DEFAULT_THEME.crimson, 0.95);
  }

  const play = DEFAULT_SELECT_LAYOUT.play;
  const autoPlay = DEFAULT_SELECT_LAYOUT.autoPlay;
  fillParallelogram(chrome, play.x, play.y, play.w, play.h, 8, DEFAULT_THEME.panelLift, 1);
  strokeParallelogram(chrome, play.x, play.y, play.w, play.h, 8, DEFAULT_THEME.paper, 1, 0.7);
  fillParallelogram(chrome, autoPlay.x, autoPlay.y, autoPlay.w, autoPlay.h, 10, DEFAULT_THEME.crimson, 1);

  addChromeText(layer, 'SELECTED', 24, 62, stampLabel());
  addChromeText(layer, songTitle, 24, 100, {
    size: 17,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    maxWidth: 268,
    slam: slamScale(staggerProgress(elapsedMs, 60, 280), 1.45),
    offsetX: slamOffset(staggerProgress(elapsedMs, 60, 280), -36),
    rotation: -0.02,
  });
  if (songArtist) {
    addChromeText(layer, songArtist, 24, 126, {
      size: 10,
      fill: DEFAULT_THEME.mute,
      fontFamily: DEFAULT_TEXT_FONT,
      maxWidth: 268,
    });
  }
  addChromeText(layer, 'MODE', 32, 154, stampLabel());
  addChromeText(layer, modeLabel, 32, 170, {
    size: 13,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    maxWidth: 60,
  });
  addChromeText(layer, 'BPM', 118, 154, stampLabel());
  addChromeText(layer, songBpm, 118, 168, {
    size: 18,
    fill: DEFAULT_THEME.gold,
    fontFamily: DEFAULT_NUMERIC_FONT,
  });
  addChromeText(layer, 'LEVEL', 208, 154, stampLabel());
  addChromeText(layer, playLevel, 208, 164, {
    size: 22,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    rotation: -0.06,
    slam: slamScale(staggerProgress(elapsedMs, 90, 240), 2.2),
  });
  if (fileLabel) {
    addChromeText(layer, fileLabel, 24, 248, {
      size: 8,
      fill: DEFAULT_THEME.mute,
      fontFamily: DEFAULT_TEXT_FONT,
      maxWidth: 268,
    });
  }
  addChromeText(layer, 'PLAY', play.x + play.w / 2, play.y + 6, {
    size: 14,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    letterSpacing: 1.4,
    slam: slamScale(staggerProgress(elapsedMs, 140, 240), 1.8),
  });
  addChromeText(layer, 'AUTO PLAY', autoPlay.x + autoPlay.w / 2, autoPlay.y + 6, {
    size: 14,
    fill: DEFAULT_THEME.ink,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    letterSpacing: 1.2,
    maxWidth: 158,
    slam: slamScale(staggerProgress(elapsedMs, 170, 240), 1.8),
  });
  addChromeText(layer, selectedPosition, 24, 346, {
    size: 12,
    fill: DEFAULT_THEME.mute,
    fontFamily: DEFAULT_NUMERIC_FONT,
  });

  fillParallelogram(
    chrome,
    DEFAULT_SELECT_LAYOUT.listX - 6,
    46,
    designWidth - DEFAULT_SELECT_LAYOUT.listX - 8,
    designHeight - 70,
    12,
    DEFAULT_THEME.inkDeep,
    0.9,
  );
  strokeParallelogram(
    chrome,
    DEFAULT_SELECT_LAYOUT.listX - 6,
    46,
    designWidth - DEFAULT_SELECT_LAYOUT.listX - 8,
    designHeight - 70,
    12,
    DEFAULT_THEME.line,
    1,
    0.85,
  );
  addChromeText(layer, input.searchQuery ? 'SEARCH RESULTS' : 'CHARTS', 328, 22, {
    size: 11,
    fill: DEFAULT_THEME.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    letterSpacing: 1.4,
    rotation: -0.05,
    slam: slamScale(staggerProgress(elapsedMs, 50, 260), 1.7),
  });

  const search = DEFAULT_SELECT_LAYOUT.search;
  fillParallelogram(chrome, search.x, search.y, search.w, search.h, 8, DEFAULT_THEME.inkDeep, 1);
  strokeParallelogram(chrome, search.x, search.y, search.w, search.h, 8, DEFAULT_THEME.line, 1, 0.8);
  addChromeText(layer, 'SEARCH', 24, 382, stampLabel());
  addChromeText(layer, input.searchQuery || 'Title / artist / genre', 82, 380, {
    size: 10,
    fill: input.searchQuery ? DEFAULT_THEME.paper : DEFAULT_THEME.mute,
    fontFamily: DEFAULT_TEXT_FONT,
    maxWidth: 210,
  });

  fillParallelogram(chrome, 8, 416, 300, 48, 10, DEFAULT_THEME.panel, 1);
  addChromeText(layer, 'LIBRARY', 24, 424, stampLabel());
  addChromeText(layer, `${input.libraryShown} shown / ${input.libraryTotal} charts`, 24, 438, {
    size: 11,
    fill: DEFAULT_THEME.mute,
    fontFamily: DEFAULT_TEXT_FONT,
  });

  const searchHit = new Graphics();
  searchHit.rect(search.x, search.y, search.w, search.h).fill({ color: 0xffffff, alpha: 0.001 });
  searchHit.eventMode = 'static';
  searchHit.cursor = 'text';
  searchHit.on('pointerdown', () => input.onSearchActivate?.());
  layer.addChild(searchHit);

  const playHit = new Graphics();
  playHit.rect(play.x, play.y, play.w, play.h).fill({ color: 0xffffff, alpha: 0.001 });
  playHit.eventMode = 'static';
  playHit.cursor = 'pointer';
  playHit.on('pointerdown', () => input.onPlay?.());
  layer.addChild(playHit);

  const autoPlayHit = new Graphics();
  autoPlayHit.rect(autoPlay.x, autoPlay.y, autoPlay.w, autoPlay.h).fill({ color: 0xffffff, alpha: 0.001 });
  autoPlayHit.eventMode = 'static';
  autoPlayHit.cursor = 'pointer';
  autoPlayHit.on('pointerdown', () => input.onAutoPlay?.());
  layer.addChild(autoPlayHit);

  layer.addChildAt(chrome, 0);
}

export function renderDefaultSelectEntryRow(layer: Container, input: DefaultSelectRowInput): void {
  const {
    entry,
    entryIndex,
    visibleIndex,
    selectedIndex,
    elapsedMs,
    listX,
    listY,
    listWidth,
    rowHeight,
    selectedSlamT,
  } = input;
  const y = listY + visibleIndex * rowHeight;
  const active = entryIndex === selectedIndex;
  const introT = staggerProgress(elapsedMs, visibleIndex * 36, 260);
  const rowSlam = active ? slamScale(selectedSlamT, 1.18) : slamScale(introT, 1.12);
  const throwX = active ? slamOffset(selectedSlamT, -18) : slamOffset(introT, -22);
  const row = new Graphics();
  const song = entry.kind === 'song' ? entry.song : undefined;
  const folder = entry.kind === 'folder' ? entry.folder : undefined;
  const titleText = song?.title ?? folder?.label ?? '';
  const keyText = song ? formatDefaultSelectModeLabel(song).replace(' KEYS', '') : 'DIR';
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
  row.label = `fallback-row[idx=${entryIndex},kind=${entry.kind}${active ? ',active' : ''}]`;
  if (active) {
    fillParallelogram(row, listX - 8 + throwX, y - 2, listWidth + 16, rowHeight + 2, 10, DEFAULT_THEME.crimson, 0.96);
    strokeParallelogram(
      row,
      listX - 8 + throwX,
      y - 2,
      listWidth + 16,
      rowHeight + 2,
      10,
      DEFAULT_THEME.paper,
      1.5,
      0.8,
    );
    fillSlash(row, listX - 16 + throwX, y + 4, 22, rowHeight - 8, 4, DEFAULT_THEME.paper, 0.9);
  } else {
    fillParallelogram(row, listX + throwX, y, listWidth, rowHeight - 3, 6, DEFAULT_THEME.panel, 0.82);
    strokeParallelogram(row, listX + throwX, y, listWidth, rowHeight - 3, 6, DEFAULT_THEME.line, 1, 0.7);
  }
  layer.addChild(row);

  fillParallelogram(
    row,
    keyPillX + throwX,
    y + 5,
    keyPillW,
    rowHeight - 12,
    4,
    active ? DEFAULT_THEME.ink : DEFAULT_THEME.panelLift,
    1,
  );
  fillParallelogram(
    row,
    levelPillX + throwX,
    y + 5,
    levelPillW,
    rowHeight - 12,
    4,
    active ? DEFAULT_THEME.ink : DEFAULT_THEME.inkDeep,
    1,
  );

  addChromeText(layer, keyText, keyPillX + keyPillW / 2 + throwX, y + rowHeight / 2 - 1, {
    size: 10,
    fill: active ? DEFAULT_THEME.paper : DEFAULT_THEME.mute,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    anchorY: 0.5,
    maxWidth: keyPillW - 4,
    slam: rowSlam,
  });
  addChromeText(layer, playLevelText, levelPillX + levelPillW / 2 + throwX, y + rowHeight / 2 - 1, {
    size: 12,
    fill: active ? DEFAULT_THEME.gold : DEFAULT_THEME.paper,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    anchorY: 0.5,
    maxWidth: levelPillW - 4,
    slam: rowSlam,
  });

  const title = addChromeText(layer, titleText, titleX + throwX, y + 3, {
    size: 11,
    fill: active ? DEFAULT_THEME.ink : DEFAULT_THEME.paper,
    fontFamily: DEFAULT_TEXT_FONT,
    maxWidth: textMaxWidth,
    slam: rowSlam,
    rotation: active ? -0.02 : 0,
  });
  title.label = `fallback-title[idx=${entryIndex}]`;

  const meta = addChromeText(layer, metaText, titleX + throwX, y + 16, {
    size: 8,
    fill: active ? DEFAULT_THEME.blood : DEFAULT_THEME.mute,
    fontFamily: DEFAULT_NUMERIC_FONT,
    maxWidth: textMaxWidth,
  });
  meta.label = `fallback-meta[idx=${entryIndex}]`;
}

export function formatDefaultSelectModeLabel(song: BrowserSongEntry | undefined): string {
  if (!song) return '- KEYS';
  return `${resolveChartPlayVariant(song)} KEYS`;
}

function stampLabel(): { size: number; fill: number; fontFamily: string; letterSpacing: number } {
  return { size: 9, fill: DEFAULT_THEME.mute, fontFamily: DEFAULT_NUMERIC_FONT, letterSpacing: 1.2 };
}
