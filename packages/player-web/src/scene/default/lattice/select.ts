import { Container, Graphics, type Text } from 'pixi.js';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../../collection/types.ts';
import type {
  BeMusicSelectFrame,
  BeMusicSelectLayout,
  BeMusicSelectRenderer,
  BeMusicSelectSkin,
} from '../../../skin/be-music/types.ts';
import { easeOutCubic, stageProgress } from '../phantom-style.ts';
import { addHitArea, addSkinText, formatPlayVariantLabel, type SkinTextOptions } from '../skin-text.ts';
import { addStaggeredSkinText, drawNeedleField, drawPaperGrid, type Rect } from './draw.ts';
import { scrambleText, scrambleTick, springEase, tileFlipPhase } from './field.ts';
import { bounceHeight } from './physics.ts';
import type { BeMusicAudioFrame } from '../../../skin/be-music/types.ts';
import { audioDrive, bandLevel } from '../audio-drive.ts';
import {
  LAT_ACCENT,
  LAT_DISPLAY_FONT,
  LAT_GRAPHITE,
  LAT_INK,
  LAT_MONO_FONT,
  LAT_PAPER,
  LAT_RULE,
  LAT_TEXT_FONT,
  LAT_WHITE,
} from './style.ts';

const LAYOUT: BeMusicSelectLayout = { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 };
const CURSOR_MS = 360;
const OUTRO_MS = 650;
const INTRO_STAGGER_MS = 40;
const OUTRO_COLUMNS = 16;
const OUTRO_ROWS = 12;

export const latticeSelectSkin: BeMusicSelectSkin = {
  layout: LAYOUT,
  createRenderer: () => new LatticeSelectRenderer(),
};

function mono(fill: number = LAT_GRAPHITE, extra: SkinTextOptions = {}): SkinTextOptions {
  return { size: 9, weight: '500', fill, fontFamily: LAT_MONO_FONT, letterSpacing: 0.6, ...extra };
}

function display(size: number, fill: number, weight: SkinTextOptions['weight'] = '300'): SkinTextOptions {
  return { size, fill, fontFamily: LAT_DISPLAY_FONT, weight };
}

/**
 * Lattice song select: a typographic table on graph paper. The back layer is a needle field whose strokes all lean
 * toward the focused row (and ripple when it changes), with a beat wave at the chart's tempo; the cursor is an ink bar
 * that springs from row to row; the focused title sets itself letter by letter. Launching flips the page to ink tile
 * by tile.
 */
class LatticeSelectRenderer implements BeMusicSelectRenderer {
  public readonly backLayer = new Container();
  public readonly frontLayer = new Container();
  public readonly outroMs = OUTRO_MS;
  private readonly field = new Graphics();
  private built = false;
  private designWidth = 640;
  private designHeight = 480;
  private effects: BeMusicSelectFrame['effects'] = 'full';
  private selected: number | undefined;
  private previousSelected: number | undefined;
  private cursorChangedAt = Number.NEGATIVE_INFINITY;
  /** Where the needles lean: the focused row's leading edge. */
  private target: { x: number; y: number } | undefined;
  /** Text-heavy areas the field leaves blank. */
  private occupied: Rect[] = [];
  /** Live cursor y (updated while the bar springs) and the readouts that tick every frame. */
  private barY = 0;
  private focusedRow = 0;
  private clockText: Text | undefined;
  private levelText: Text | undefined;
  /** Recent onsets of the BGM / preview, each rippling out of the list. */
  private onsets: number[] = [];
  private cursorText: Text | undefined;

  public constructor() {
    this.backLayer.label = 'lattice-select/paper';
    this.frontLayer.label = 'lattice-select/front';
  }

  public render(input: BeMusicSelectFrame): boolean {
    this.effects = input.effects;
    const frame =
      input.effects === 'off'
        ? { ...input, sceneStartedAt: Number.NEGATIVE_INFINITY, cursorChangedAt: Number.NEGATIVE_INFINITY }
        : input;
    this.ensureBuilt(frame.designWidth, frame.designHeight);
    if (this.selected !== frame.selectedIndex) {
      this.previousSelected = this.selected;
      this.selected = frame.selectedIndex;
    }
    this.cursorChangedAt = frame.cursorChangedAt;
    let needsFrame = this.renderChrome(frame);
    needsFrame = this.renderList(frame) || needsFrame;
    if (frame.launchAt !== undefined) {
      this.renderOutro(frame);
      return true;
    }
    return needsFrame;
  }

  public tick(
    nowMs: number,
    focusedSong: BrowserSongEntry | undefined,
    _launchAt?: number,
    audio?: BeMusicAudioFrame,
  ): void {
    const rate = this.effects === 'off' ? 0 : this.effects === 'reduced' ? 0.5 : 1;
    // The BGM / chart preview: needles along the lower page stand up into an equalizer, onsets ripple out of the list,
    // and the footer reads the level in dB.
    const drive = audioDrive(audio, this.effects);
    if (drive.onsetAtMs !== undefined && this.onsets[this.onsets.length - 1] !== drive.onsetAtMs) {
      this.onsets.push(drive.onsetAtMs);
      if (this.onsets.length > 4) this.onsets.shift();
    }
    if (this.levelText) {
      this.levelText.text = `dB ${drive.db <= -95 ? '-inf' : drive.db.toFixed(1).padStart(5, ' ')}`;
    }
    const bpm = focusedSong?.bpm;
    const beatsPerSecond = (bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? Math.min(bpm, 300) : 120) / 60;
    const seconds = (nowMs / 1000) * rate;
    const cursorAge = nowMs - this.cursorChangedAt;
    const target = this.target;
    if (this.cursorText) {
      this.cursorText.text = `ROW ${String(this.focusedRow + 1).padStart(3, '0')}  Y ${this.barY.toFixed(1).padStart(5, '0')}`;
    }
    if (this.clockText) {
      const ms = Math.max(0, nowMs);
      const minutes = Math.floor(ms / 60000);
      this.clockText.text = `T ${String(minutes % 100).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
    }
    this.field.clear();
    drawNeedleField(
      this.field,
      { x: 0, y: 44, w: this.designWidth, h: this.designHeight - 44 },
      {
        seconds,
        beatPhase: (seconds * beatsPerSecond) % 1,
        flow: 0.3 * rate,
        beatWave: 0.4 * rate,
        ripples:
          rate > 0
            ? [
                ...(target ? [{ x: target.x, y: target.y, ageMs: cursorAge, strength: 0.8 }] : []),
                ...this.onsets.map((atMs) => ({ x: 470, y: 250, ageMs: nowMs - atMs, strength: 0.7 * rate })),
              ]
            : [],
        attractor: target ? { x: target.x, y: target.y, strength: 0.55 } : undefined,
        tremble: 0.06 * rate + 0.08 * drive.high,
        spectrum: {
          levels: Array.from({ length: 32 }, (_, column) => bandLevel(drive.bands, column, 32)),
          left: 0,
          right: this.designWidth,
          top: this.designHeight - 190,
          bottom: this.designHeight - 8,
        },
      },
      {
        alpha: 0.5,
        skip: (x, y) =>
          this.occupied.some((rect) => x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h),
      },
    );
  }

  public dispose(): void {
    this.backLayer.destroy({ children: true });
    this.frontLayer.destroy({ children: true });
  }

  private ensureBuilt(designWidth: number, designHeight: number): void {
    if (this.built) return;
    this.built = true;
    this.designWidth = designWidth;
    this.designHeight = designHeight;
    const paper = new Graphics();
    paper.rect(0, 0, designWidth, designHeight).fill(LAT_PAPER);
    drawPaperGrid(paper, { x: 0, y: 0, w: designWidth, h: designHeight }, 0.45);
    this.backLayer.addChild(paper, this.field);
    // Readouts in the footer, updated in `tick` so they run every frame without rebuilding the page.
    this.cursorText = addSkinText(this.frontLayer, '', 330, designHeight - 20, mono(LAT_GRAPHITE));
    this.clockText = addSkinText(this.frontLayer, '', 470, designHeight - 20, mono(LAT_GRAPHITE));
    this.levelText = addSkinText(this.frontLayer, '', 226, designHeight - 20, mono(LAT_GRAPHITE));
  }

  private renderChrome(frame: BeMusicSelectFrame): boolean {
    const { layer, designWidth, designHeight, entries, focusedSong: song } = frame;
    const chrome = new Graphics();
    chrome.label = 'lattice-select/chrome';
    const text = (value: string, x: number, y: number, options: SkinTextOptions) =>
      addSkinText(layer, value, x, y, options);
    const intro = easeOutCubic(stageProgress(frame.nowMs - frame.sceneStartedAt, 0, 700));
    const tick = scrambleTick(frame.nowMs);
    const sceneAge = frame.nowMs - frame.sceneStartedAt;
    const titleAge = frame.nowMs - frame.cursorChangedAt;
    // Text scramble: every string decodes in on scene entry, the focused chart's details again on each cursor move.
    const onEntry = (value: string, delayMs: number, seed: number, durationMs = 420) =>
      scrambleText(value, stageProgress(sceneAge, delayMs, durationMs), tick, seed);
    const onCursor = (value: string, delayMs: number, seed: number, durationMs = 360) =>
      scrambleText(
        value,
        Math.min(stageProgress(titleAge, delayMs, durationMs), stageProgress(sceneAge, delayMs, durationMs)),
        tick,
        seed,
      );

    // Header.
    chrome.rect(0, 0, designWidth, 38).fill({ color: LAT_PAPER, alpha: 0.96 });
    chrome.rect(0, 37, designWidth * intro, 1).fill(LAT_INK);
    addStaggeredSkinText(
      layer,
      onEntry('MUSIC SELECT', 0, 1, 600),
      18,
      14,
      mono(LAT_INK, { size: 11, letterSpacing: 4 }),
      (index) => {
        const local = Math.max(0, (frame.nowMs - frame.sceneStartedAt - index * 30) / 300);
        return { dy: -8 * (1 - springEase(Math.min(1, local))), alpha: Math.min(1, local * 3) };
      },
    );
    const categoryName = frame.searchQuery ? `Search: ${frame.searchQuery}` : (frame.folderLabel ?? 'Library');
    text(onEntry(categoryName, 200, 2), designWidth - 18, 13, {
      size: 10,
      weight: '500',
      fill: LAT_INK,
      fontFamily: LAT_TEXT_FONT,
      anchorX: 1,
      maxWidth: 220,
    });

    // Focused chart.
    const songTitle = song?.title ?? 'No chart selected';
    const songArtist = song?.artist || song?.subtitle || '';
    const position =
      entries.length > 0
        ? `No. ${String(Math.min(frame.selectedIndex + 1, entries.length)).padStart(3, '0')} / ${String(entries.length).padStart(3, '0')}`
        : 'No. 000 / 000';
    chrome.rect(14, 56, 290, 1).fill(LAT_INK);
    text(onEntry('NOW SELECTING', 120, 3), 14, 63, mono());
    text(onCursor(position, 0, 4, 260), 304, 63, mono(LAT_INK, { anchorX: 1 }));
    addStaggeredSkinText(
      layer,
      onCursor(songTitle, 0, 5, 460),
      14,
      84,
      { size: 20, weight: '500', fill: LAT_INK, fontFamily: LAT_TEXT_FONT, maxWidth: 290 },
      (index) => {
        const local = Math.max(0, (titleAge - index * 14) / 260);
        return { dy: 10 * (1 - springEase(Math.min(1, local), 2.2, 0.5)), alpha: Math.min(1, local * 3) };
      },
    );
    if (songArtist) {
      text(onCursor(songArtist, 90, 6), 14, 114, {
        size: 10,
        weight: '300',
        fill: LAT_GRAPHITE,
        fontFamily: LAT_TEXT_FONT,
        maxWidth: 290,
        alpha: Math.min(1, Math.max(0, (titleAge - 120) / 200)),
      });
    }

    // Stats table.
    chrome.rect(14, 140, 290, 1).fill(LAT_INK);
    chrome.rect(14, 196, 290, 1).fill({ color: LAT_RULE, alpha: 1 });
    const playLevel = song?.playLevel !== undefined ? String(song.playLevel) : '-';
    const stats: ReadonlyArray<readonly [x: number, label: string, value: string, fill: number]> = [
      [14, '01 MODE', song ? formatPlayVariantLabel(song) : '- KEYS', LAT_INK],
      [114, '02 BPM', song?.bpm !== undefined ? String(Math.round(song.bpm)) : '-', LAT_INK],
      [214, '03 LEVEL', playLevel, LAT_ACCENT],
    ];
    stats.forEach(([x, label, value, fill], index) => {
      if (x > 14) chrome.rect(x - 8, 148, 1, 40).fill({ color: LAT_RULE, alpha: 1 });
      text(onEntry(label, 200 + index * 60, 10 + index), x, 148, mono());
      text(onCursor(value, 60 + index * 60, 20 + index, 300), x, 164, { ...display(20, fill, '300'), maxWidth: 88 });
    });
    // Level as a row of squares.
    const levelNumber =
      song?.playLevel !== undefined ? Number.parseFloat(String(song.playLevel).replace(/^[^\d.]+/u, '')) : NaN;
    const lit = Number.isFinite(levelNumber) ? Math.max(1, Math.min(12, Math.round(levelNumber))) : 0;
    for (let dot = 0; dot < 12; dot += 1) {
      const x = 14 + dot * 24;
      if (dot < lit) {
        // Physics: the lit squares drop onto the baseline one after another and bounce.
        const drop = bounceHeight((titleAge - dot * 28) / 1000, 34, 2600, 0.42);
        chrome.rect(x, 210 - drop, 12, 12).fill(dot >= 9 ? LAT_ACCENT : LAT_INK);
      } else {
        chrome.rect(x + 0.5, 210.5, 11, 11).stroke({ color: LAT_RULE, width: 1 });
      }
    }
    chrome.rect(14, 223, 288, 1).fill({ color: LAT_INK, alpha: 0.6 });
    if (song?.fileLabel) {
      text(onCursor(song.fileLabel, 220, 7), 14, 234, mono(LAT_GRAPHITE, { maxWidth: 290 }));
    }

    // PLAY (ink) / AUTO (outline).
    chrome.rect(14, 296, 182, 40).fill(LAT_INK);
    text(onEntry('PLAY', 380, 8), 30, 316, { ...display(13, LAT_WHITE, '600'), letterSpacing: 6, anchorY: 0.5 });
    text('→', 180, 315, { ...display(14, LAT_WHITE, '300'), anchorX: 1, anchorY: 0.5 });
    chrome.rect(206.5, 296.5, 97, 39).stroke({ color: LAT_INK, width: 1 });
    text(onEntry('AUTO', 440, 9), 255, 316, {
      ...display(10, LAT_INK, '600'),
      letterSpacing: 4,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    addHitArea(layer, 14, 296, 182, 40, 'pointer', frame.actions.play);
    addHitArea(layer, 206, 296, 98, 40, 'pointer', frame.actions.autoPlay);

    // Search and library.
    text(onEntry('SEARCH', 480, 30), 14, 372, mono());
    text(onEntry(frame.searchQuery || 'Title / artist / genre', 520, 31), 70, 369, {
      size: 11,
      weight: '300',
      fill: frame.searchQuery ? LAT_INK : LAT_GRAPHITE,
      fontFamily: LAT_TEXT_FONT,
      maxWidth: 230,
    });
    chrome.rect(14, 388, 290, 1).fill(LAT_INK);
    addHitArea(layer, 14, 362, 290, 30, 'text', frame.actions.activateSearch);
    text(onEntry('LIBRARY', 560, 32), 14, 420, mono());
    text(onEntry(`${entries.length} shown / ${frame.totalCharts} charts`, 600, 33), 14, 434, {
      size: 11,
      weight: '500',
      fill: LAT_INK,
      fontFamily: LAT_TEXT_FONT,
    });
    text(
      onEntry(frame.searchQuery ? 'SEARCH RESULTS' : frame.folderLabel ? 'CHARTS' : 'FOLDERS', 640, 34),
      designWidth - 18,
      designHeight - 20,
      {
        ...mono(),
        anchorX: 1,
      },
    );

    layer.addChildAt(chrome, 0);
    // The field fills the page but leaves the type blocks (and the rows actually shown) clean.
    const shownRows = Math.max(0, Math.min(frame.visibleRows, entries.length - frame.firstVisibleIndex));
    this.occupied = [
      { x: 6, y: 48, w: 306, h: 196 },
      { x: 6, y: 288, w: 306, h: 56 },
      { x: 6, y: 360, w: 306, h: 36 },
      { x: 6, y: 412, w: 200, h: 36 },
      {
        x: LAYOUT.listX - 18,
        y: LAYOUT.listTop - 6,
        w: designWidth - LAYOUT.listX + 18,
        h: shownRows * LAYOUT.rowHeight + 6,
      },
    ];
    return intro < 1 || titleAge < 1200 || sceneAge < 1400;
  }

  private renderList(frame: BeMusicSelectFrame): boolean {
    const { listX, listTop, rowHeight } = LAYOUT;
    const listWidth = frame.designWidth - listX - 14;
    const rows = new Graphics();
    rows.label = 'lattice-select/rows';
    frame.layer.addChild(rows);
    // Cursor bar: springs from the previous row to the focused one.
    const cursorAge = frame.nowMs - frame.cursorChangedAt;
    const cursorT = springEase(Math.min(1, Math.max(0, cursorAge / CURSOR_MS)), 2.6, 0.42);
    const rowY = (index: number) => listTop + (index - frame.firstVisibleIndex) * rowHeight;
    const fromIndex = this.previousSelected ?? frame.selectedIndex;
    const fromY = Math.max(listTop - rowHeight, Math.min(rowY(fromIndex), listTop + frame.visibleRows * rowHeight));
    const barY = fromY + (rowY(frame.selectedIndex) - fromY) * cursorT;
    this.barY = barY;
    this.focusedRow = frame.selectedIndex;
    const visibleSelected =
      frame.selectedIndex >= frame.firstVisibleIndex &&
      frame.selectedIndex < frame.firstVisibleIndex + frame.visibleRows;
    if (visibleSelected && frame.entries.length > 0) {
      // The bar stretches while it travels, like a mechanism taking up slack.
      const stretch = Math.abs(rowY(frame.selectedIndex) - fromY) * (1 - cursorT) * 0.25;
      rows.rect(listX - 10, barY - stretch / 2, listWidth + 10, rowHeight - 4 + stretch).fill(LAT_INK);
      this.target = { x: listX - 16, y: rowY(frame.selectedIndex) + (rowHeight - 4) / 2 };
    } else {
      this.target = undefined;
    }
    let animating = cursorAge < CURSOR_MS;
    for (let visibleIndex = 0; visibleIndex < frame.visibleRows; visibleIndex += 1) {
      const entryIndex = frame.firstVisibleIndex + visibleIndex;
      const entry = frame.entries[entryIndex];
      if (!entry) break;
      animating = this.renderRow(frame, rows, entry, entryIndex, visibleIndex, listWidth) || animating;
    }
    return animating;
  }

  private renderRow(
    frame: BeMusicSelectFrame,
    rows: Graphics,
    entry: BrowserBrowseEntry,
    entryIndex: number,
    visibleIndex: number,
    listWidth: number,
  ): boolean {
    const { listX, listTop, rowHeight } = LAYOUT;
    const y = listTop + visibleIndex * rowHeight;
    const active = entryIndex === frame.selectedIndex;
    const song = entry.kind === 'song' ? entry.song : undefined;
    const folder = entry.kind === 'folder' ? entry.folder : undefined;
    const introT = stageProgress(frame.nowMs - frame.sceneStartedAt, 100 + visibleIndex * INTRO_STAGGER_MS, 700);
    const x = listX;
    const alpha = Math.min(1, introT * 4);
    // Physics: rows drop into place from above and bounce on their rule.
    const drop = bounceHeight(
      (frame.nowMs - frame.sceneStartedAt - 100 - visibleIndex * INTRO_STAGGER_MS) / 1000,
      22,
      3000,
      0.38,
    );
    const midY = y + (rowHeight - 4) / 2 - drop;
    const ink = active ? LAT_WHITE : LAT_INK;
    // Rows decode in on entry; the focused row's title decodes again when the cursor lands on it.
    const tick = scrambleTick(frame.nowMs);
    const rowDelay = 100 + visibleIndex * INTRO_STAGGER_MS;
    const rowScramble = stageProgress(frame.nowMs - frame.sceneStartedAt, rowDelay, 460);
    const titleScramble = active
      ? Math.min(rowScramble, stageProgress(frame.nowMs - frame.cursorChangedAt, 0, 320))
      : rowScramble;
    rows.rect(listX - 10, y + rowHeight - 2, (listWidth + 10) * alpha, 1).fill({ color: LAT_RULE, alpha: 1 });
    addSkinText(
      frame.layer,
      scrambleText(String(entryIndex + 1).padStart(3, '0'), rowScramble, tick, entryIndex),
      x,
      midY,
      {
        ...mono(active ? LAT_WHITE : LAT_GRAPHITE),
        anchorY: 0.5,
        alpha,
      },
    ).label = `fallback-index[idx=${entryIndex}]`;
    const level = song?.playLevel !== undefined ? String(song.playLevel) : folder ? 'DIR' : '-';
    rows.rect(x + 30.5, midY - 7.5, 22, 15).stroke({ color: active ? LAT_WHITE : LAT_INK, width: 1, alpha });
    addSkinText(frame.layer, level, x + 41.5, midY, {
      ...display(level.length > 2 ? 8 : 10, ink, '600'),
      anchorX: 0.5,
      anchorY: 0.5,
      alpha,
      maxWidth: 20,
    });
    const meta = song
      ? `${song.bpm ? `${Math.round(song.bpm)} BPM` : ''}`
      : `${folder?.songs.length ?? 0} chart${folder?.songs.length === 1 ? '' : 's'}`;
    const metaNode = addSkinText(
      frame.layer,
      scrambleText(meta, rowScramble, tick, entryIndex + 500),
      listX + listWidth - 10,
      midY,
      {
        ...mono(active ? LAT_WHITE : LAT_GRAPHITE),
        anchorX: 1,
        anchorY: 0.5,
        alpha,
        maxWidth: 70,
      },
    );
    metaNode.label = `fallback-meta[idx=${entryIndex}]`;
    const metaWidth = meta ? Math.min(70, metaNode.width) + 12 : 0;
    const title = addSkinText(
      frame.layer,
      scrambleText(song?.title ?? folder?.label ?? '', titleScramble, tick, entryIndex + 900),
      x + 62,
      midY,
      {
        size: 11,
        weight: active ? '500' : '300',
        fill: ink,
        fontFamily: LAT_TEXT_FONT,
        anchorY: 0.5,
        alpha,
        maxWidth: Math.max(24, listX + listWidth - x - 72 - metaWidth),
      },
    );
    title.label = `fallback-title[idx=${entryIndex}]`;
    return introT < 1 || titleScramble < 1;
  }

  /** Launch outro: ink tiles flip over the page in a diagonal wave and the chosen title sets itself in white. */
  private renderOutro(frame: BeMusicSelectFrame): void {
    const t = Math.min(1, (frame.nowMs - (frame.launchAt ?? frame.nowMs)) / OUTRO_MS);
    const { designWidth, designHeight, layer } = frame;
    const g = new Graphics();
    g.label = 'lattice-select/outro';
    const tileW = designWidth / OUTRO_COLUMNS;
    const tileH = designHeight / OUTRO_ROWS;
    for (let row = 0; row < OUTRO_ROWS; row += 1) {
      for (let column = 0; column < OUTRO_COLUMNS; column += 1) {
        const phase = tileFlipPhase(column, row, OUTRO_COLUMNS, OUTRO_ROWS, t, 0.5);
        if (phase <= 0) continue;
        const h = tileH * Math.min(1, springEase(phase, 1.8, 0.6));
        g.rect(column * tileW, row * tileH + (tileH - h) / 2, tileW + 0.5, h).fill(LAT_INK);
      }
    }
    layer.addChild(g);
    const textIn = Math.max(0, (t - 0.35) / 0.5);
    addStaggeredSkinText(
      layer,
      scrambleText(frame.focusedSong?.title ?? '', textIn * 1.4, scrambleTick(frame.nowMs), 77),
      designWidth / 2,
      designHeight / 2,
      {
        size: 22,
        weight: '500',
        fill: LAT_WHITE,
        fontFamily: LAT_TEXT_FONT,
        anchorX: 0.5,
        anchorY: 0.5,
        maxWidth: designWidth - 80,
      },
      (index, count) => {
        const local = Math.max(0, textIn * (1 + count * 0.04) - index * 0.04);
        return { dy: 12 * (1 - springEase(Math.min(1, local))), alpha: Math.min(1, local * 3) };
      },
    );
  }
}
