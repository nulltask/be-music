import { Container, Graphics } from 'pixi.js';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../collection/types.ts';
import { resolveChartPlayVariant } from '../../collection/collection.ts';
import { addChromeText } from './chrome-text.ts';
import { DEFAULT_NUMERIC_FONT } from './fonts.ts';
import { scanlineY, slideOffset } from './motion.ts';
import { DEFAULT_SELECT_LAYOUT, defaultSelectListWidth } from './select-layout.ts';
import { coverAmount, pieceT, SELECT_TIMELINE, selectRowT } from './transition.ts';
import { DEFAULT_THEME as T, fillBgBands, fillTriangle, paintSceneCover, strokeCornerBrackets } from './theme.ts';

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
  const scanY = scanlineY(model.nowMs, designHeight, 3200);
  chrome.rect(0, scanY, designWidth, 1).fill({ color: T.cyan, alpha: 0.07 });

  const headerT = pieceT(elapsed, SELECT_TIMELINE.header);
  chrome.rect(0, 0, designWidth, 40).fill({ color: T.void, alpha: 0.96 });
  chrome.rect(0, 38, designWidth * headerT, 2).fill({ color: T.cyan, alpha: 0.7 * headerT });
  fillTriangle(chrome, 22, 20, 10, T.cyan, 0.85 * headerT, true);
  addChromeText(layer, 'MUSIC SELECT', 34, 12 + slideOffset(headerT, -16), {
    size: 13,
    weight: '700',
    fill: T.ice,
    letterSpacing: 2.2,
    fontFamily: DEFAULT_NUMERIC_FONT,
    alpha: headerT,
  });
  addChromeText(layer, model.categoryName, designWidth - 16, 12 + slideOffset(headerT, -12), {
    size: 10,
    weight: '700',
    fill: T.mute,
    anchorX: 1,
    maxWidth: 260,
    alpha: headerT,
  });

  const detailT = pieceT(elapsed, SELECT_TIMELINE.detail);
  chrome.rect(12, 54, 292, 306).fill({ color: T.panel, alpha: 0.94 * detailT }).stroke({ color: T.line, width: 1, alpha: detailT });
  chrome.rect(12, 54, 3, 306).fill({ color: T.cyan, alpha: 0.8 * detailT });
  strokeCornerBrackets(chrome, 18, 62, 280, 40, 8, T.cyan, 0.35 * detailT);
  chrome.rect(24, 94, 268 * detailT, 1).fill({ color: T.cyan, alpha: 0.45 * detailT });

  chrome.rect(24, 150, 76, 48).fill({ color: T.panelDeep, alpha: detailT }).stroke({ color: T.line, width: 1, alpha: detailT });
  chrome.rect(112, 150, 76, 48).fill({ color: T.panelDeep, alpha: detailT }).stroke({ color: T.line, width: 1, alpha: detailT });
  chrome.rect(200, 150, 92, 48).fill({ color: T.panelDeep, alpha: detailT }).stroke({ color: T.line, width: 1, alpha: detailT });
  chrome.rect(24, 226, 268, 12).fill({ color: T.panelDeep, alpha: detailT });
  if (Number.isFinite(model.playLevelNumber)) {
    const levelRatio = Math.max(0.04, Math.min(1, model.playLevelNumber / 12));
    chrome.rect(24, 226, Math.round(268 * levelRatio * detailT), 12).fill({ color: T.cyan, alpha: 0.85 * detailT });
  }

  addChromeText(layer, 'SELECTED', 24, 66, { size: 8, weight: '700', fill: T.subtle, letterSpacing: 1.2, alpha: detailT }, undefined);
  addChromeText(layer, model.songTitle, 24, 104 + slideOffset(detailT, 10), {
    size: 18,
    weight: '700',
    fill: T.ice,
    maxWidth: 268,
    alpha: detailT,
  });
  if (model.songArtist) {
    addChromeText(layer, model.songArtist, 24, 128, { size: 10, weight: '500', fill: T.mute, maxWidth: 268, alpha: detailT });
  }
  addChromeText(layer, 'MODE', 34, 156, { size: 8, weight: '700', fill: T.subtle, alpha: detailT });
  addChromeText(layer, model.modeLabel, 34, 172, { size: 12, weight: '700', fill: T.ice, fontFamily: DEFAULT_NUMERIC_FONT, maxWidth: 56, alpha: detailT });
  addChromeText(layer, 'BPM', 122, 156, { size: 8, weight: '700', fill: T.subtle, alpha: detailT });
  addChromeText(layer, model.songBpm, 122, 170, { size: 16, weight: '700', fill: T.cyan, fontFamily: DEFAULT_NUMERIC_FONT, alpha: detailT });
  addChromeText(layer, 'LEVEL', 210, 156, { size: 8, weight: '700', fill: T.subtle, alpha: detailT });
  addChromeText(layer, model.playLevel, 210, 168, { size: 18, weight: '700', fill: T.gold, fontFamily: DEFAULT_NUMERIC_FONT, alpha: detailT });
  if (model.fileLabel) {
    addChromeText(layer, model.fileLabel, 24, 250, { size: 8, weight: '500', fill: T.mute, maxWidth: 268, alpha: detailT });
  }
  addChromeText(layer, model.selectedPosition, 24, 348, { size: 10, weight: '700', fill: T.mute, fontFamily: DEFAULT_NUMERIC_FONT, alpha: detailT });

  const actionT = pieceT(elapsed, SELECT_TIMELINE.actions);
  const play = DEFAULT_SELECT_LAYOUT.play;
  const auto = DEFAULT_SELECT_LAYOUT.auto;
  chrome.rect(play.x, play.y, play.w, play.h).fill({ color: T.panelDeep, alpha: actionT }).stroke({ color: T.cyan, width: 1, alpha: actionT });
  chrome.rect(auto.x, auto.y, auto.w, auto.h).fill({ color: T.panelDeep, alpha: actionT }).stroke({ color: T.gold, width: 1, alpha: 0.85 * actionT });
  fillTriangle(chrome, play.x + 12, play.y + 14, 8, T.cyan, 0.9 * actionT);
  addChromeText(layer, 'PLAY', play.x + play.w / 2 + 4, play.y + 8, {
    size: 10,
    weight: '700',
    fill: T.ice,
    anchorX: 0.5,
    fontFamily: DEFAULT_NUMERIC_FONT,
    alpha: actionT,
  });
  addChromeText(layer, 'AUTO PLAY', auto.x + auto.w / 2, auto.y + 8, {
    size: 10,
    weight: '700',
    fill: T.gold,
    anchorX: 0.5,
    fontFamily: DEFAULT_NUMERIC_FONT,
    maxWidth: 158,
    alpha: actionT,
  });

  const searchT = pieceT(elapsed, SELECT_TIMELINE.search);
  const search = DEFAULT_SELECT_LAYOUT.search;
  chrome.rect(search.x, search.y, search.w, search.h).fill({ color: T.panelDeep, alpha: searchT }).stroke({ color: T.line, width: 1, alpha: searchT });
  addChromeText(layer, 'SEARCH', 24, 384, { size: 8, weight: '700', fill: T.subtle, letterSpacing: 1.1, alpha: searchT });
  addChromeText(layer, model.searchQuery || 'Title / artist / genre', 82, 382, {
    size: 10,
    weight: '500',
    fill: model.searchQuery ? T.ice : T.subtle,
    maxWidth: 210,
    alpha: searchT,
  });

  chrome.rect(12, 420, 292, 42).fill({ color: T.panel, alpha: searchT }).stroke({ color: T.line, width: 1, alpha: searchT });
  addChromeText(layer, 'LIBRARY', 24, 428, { size: 8, weight: '700', fill: T.subtle, letterSpacing: 1.1, alpha: searchT });
  addChromeText(layer, `${model.shownCount} shown / ${model.libraryCount} charts`, 24, 442, {
    size: 11,
    weight: '700',
    fill: T.mute,
    alpha: searchT,
  });

  const listT = pieceT(elapsed, SELECT_TIMELINE.list);
  chrome
    .rect(316, 50, designWidth - 332, designHeight - 76)
    .fill({ color: T.panelDeep, alpha: 0.88 * listT })
    .stroke({ color: T.line, width: 1, alpha: listT });
  addChromeText(layer, model.searchQuery ? 'SEARCH RESULTS' : 'CHARTS', 328, 28, {
    size: 8,
    weight: '700',
    fill: T.subtle,
    letterSpacing: 1.2,
    alpha: listT,
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
  const t = selectRowT(sceneElapsedMs, row.visibleIndex);
  const gfx = new Graphics();
  gfx.label = `fallback-row[idx=${row.entryIndex},kind=${row.entry.kind}${row.active ? ',active' : ''}]`;
  gfx.alpha = t;
  gfx.position.set(slideOffset(t, 28), 0);
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
    gfx.rect(listX - 4, y - 1, listWidth + 8, rowHeight).fill({ color: T.gold, alpha: 0.92 }).stroke({
      color: T.ice,
      width: 1,
      alpha: 0.55,
    });
    fillTriangle(gfx, listX - 12, cursorY + rowHeight / 2 - 2, 12, T.gold, 0.95);
  } else {
    gfx.rect(listX, y, listWidth, rowHeight - 3).fill({ color: T.panel, alpha: 0.78 }).stroke({
      color: T.line,
      width: 1,
      alpha: 0.7,
    });
  }

  gfx.rect(keyPillX, y + 5, keyPillW, rowHeight - 12).fill(row.active ? T.void : T.panelDeep);
  gfx.rect(levelPillX, y + 5, levelPillW, rowHeight - 12).fill(row.active ? T.void : T.navy).stroke({
    color: row.active ? T.ice : T.line,
    width: 1,
    alpha: row.active ? 0.4 : 0.75,
  });
  layer.addChild(gfx);

  addChromeText(layer, keyText, keyPillX + keyPillW / 2, y + rowHeight / 2 - 6, {
    size: 8,
    weight: '700',
    fill: row.active ? T.void : T.mute,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    maxWidth: keyPillW - 4,
    alpha: t,
  });
  addChromeText(layer, playLevelText, levelPillX + levelPillW / 2, y + rowHeight / 2 - 6, {
    size: 10,
    weight: '700',
    fill: row.active ? T.void : T.gold,
    fontFamily: DEFAULT_NUMERIC_FONT,
    anchorX: 0.5,
    maxWidth: levelPillW - 4,
    alpha: t,
  });
  addChromeText(layer, titleText, titleX, y + 3, {
    size: 11,
    weight: '700',
    fill: row.active ? T.void : T.ice,
    maxWidth: textMaxWidth,
    alpha: t,
  });
  addChromeText(layer, metaText, titleX, y + 16, {
    size: 8,
    weight: '500',
    fill: row.active ? 0x3a2a10 : T.mute,
    fontFamily: DEFAULT_NUMERIC_FONT,
    maxWidth: textMaxWidth,
    alpha: t,
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

