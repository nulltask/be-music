import { Container, Graphics } from 'pixi.js';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../../collection/types.ts';
import type {
  BeMusicSelectFrame,
  BeMusicSelectLayout,
  BeMusicSelectRenderer,
  BeMusicSelectSkin,
} from '../../../skin/be-music/types.ts';
import { DEFAULT_DISPLAY_FONT, DEFAULT_HEADLINE_FONT } from '../fonts.ts';
import {
  PHANTOM_ASH,
  PHANTOM_BLACK,
  PHANTOM_CHARCOAL,
  PHANTOM_GOLD,
  PHANTOM_INK,
  PHANTOM_PAPER,
  PHANTOM_RED,
  PHANTOM_RED_HOT,
  PHANTOM_SLATE,
  PHANTOM_WHITE,
  drawNoteEmblem,
  easeOutBack,
  easeOutCubic,
  halftoneField,
  hash01,
  parallelogramPoints,
  stageProgress,
  starburstPoints,
  tornEdgePoints,
} from '../phantom-style.ts';
import { addHitArea, addSkinText, formatPlayVariantLabel, type SkinTextOptions } from '../skin-text.ts';
import type { BeMusicAudioFrame } from '../../../skin/be-music/types.ts';
import { audioDrive, bandLevel } from '../audio-drive.ts';
import { addRansomText, type GlyphFactory } from './tear.ts';

const LAYOUT: BeMusicSelectLayout = { listX: 320, listTop: 60, listBottomInset: 26, rowHeight: 28 };
const SLIDE_MS = 240;
const OUTRO_MS = 860;
const INTRO_STAGGER_MS = 40;
const KICKER_PITCH = 20;
const GLINT_W = 14;
/** Authored glint height; scaled to the focused card's height at tick time. */
const GLINT_H = 25;
const DOT_PITCH = 10;
/** Vertical repeat of the staggered halftone grid (two rows), so the drift loops seamlessly. */
const DOT_PERIOD = DOT_PITCH * 2;

function slabPoints(designHeight: number): number[] {
  return [0, 40, 236, 40, 118, designHeight, 0, designHeight];
}

function tagStyle(fill: number): SkinTextOptions {
  return { size: 9, fill, fontFamily: DEFAULT_DISPLAY_FONT, letterSpacing: 1.2, skewX: -0.18 };
}

export const phantomSelectSkin: BeMusicSelectSkin = {
  layout: LAYOUT,
  createRenderer: () => new PhantomSelectRenderer(),
};

/**
 * Phantom song select: an ink ground under a red halftone slab (both persistent, with drifting dots, a BPM-pulsed
 * starburst, and speed streaks), a slanted info panel, PLAY / AUTO PLAY cards, and a racked song list whose focused
 * card slides out with a pointer and a glint.
 */
class PhantomSelectRenderer implements BeMusicSelectRenderer {
  public readonly backLayer = new Container();
  public readonly frontLayer = new Container();
  private readonly pointer = new Graphics();
  private readonly kicker = new Graphics();
  private readonly glint = new Graphics();
  private built = false;
  private dots: Graphics | undefined;
  private burst: Graphics | undefined;
  private streaks: Graphics[] = [];
  private streakAlpha: number[] = [];
  /** Equalizer bars rising off the bottom edge behind the list, redrawn from the BGM / preview spectrum. */
  private readonly spectrum = new Graphics();
  private designHeight = 480;
  private activeRowY: number | undefined;
  private activeCard: { x: number; y: number; w: number; h: number } | undefined;
  private designWidth = 640;

  public constructor() {
    this.backLayer.label = 'default-select/motion';
    this.frontLayer.label = 'default-select/front-motion';
    this.pointer.label = 'default-select/pointer';
    this.frontLayer.addChild(this.kicker, this.glint, this.pointer);
  }

  public readonly outroMs = OUTRO_MS;
  private effects: BeMusicSelectFrame['effects'] = 'full';

  public render(input: BeMusicSelectFrame): boolean {
    this.effects = input.effects;
    // With effects off every entrance / focus transition renders settled.
    const frame =
      input.effects === 'off'
        ? { ...input, sceneStartedAt: Number.NEGATIVE_INFINITY, cursorChangedAt: Number.NEGATIVE_INFINITY }
        : input;
    this.ensureBuilt(frame.designWidth, frame.designHeight);
    this.activeRowY = undefined;
    this.activeCard = undefined;
    let needsFrame = this.renderChrome(frame);
    const listWidth = frame.designWidth - LAYOUT.listX - 16;
    for (let visibleIndex = 0; visibleIndex < frame.visibleRows; visibleIndex += 1) {
      const entryIndex = frame.firstVisibleIndex + visibleIndex;
      const entry = frame.entries[entryIndex];
      if (!entry) break;
      needsFrame = this.renderRow(frame, entry, entryIndex, visibleIndex, listWidth) || needsFrame;
    }
    this.pointer.visible = this.activeRowY !== undefined;
    this.glint.visible = this.activeCard !== undefined;
    if (frame.launchAt !== undefined) {
      this.renderOutro(frame);
      return true;
    }
    return needsFrame;
  }

  /**
   * Launch outro — the split screen: a blood-red quarter full of out-of-focus bokeh slides in from the left while a
   * black-and-white starburst slams in from the right; they meet on a torn diagonal seam, the chosen title lands on
   * a tilted ink label, LET'S GO! is cut out of magazines letter by letter, and the page falls to ink for the count-in.
   */
  private renderOutro(frame: BeMusicSelectFrame): void {
    const t = Math.min(1, (frame.nowMs - (frame.launchAt ?? frame.nowMs)) / OUTRO_MS);
    const { designWidth: w, designHeight: h, layer, nowMs } = frame;
    const g = new Graphics();
    g.label = 'default-select/outro';
    layer.addChild(g);
    const meet = easeOutCubic(Math.min(1, t / 0.32));
    // The seam: a torn line leaning right, from (seamTop, 0) to (seamBottom, h). The red half keeps to the left
    // quarter so the starburst half carries the title.
    const seamTop = w * 0.32;
    const seamBottom = w * 0.18;
    const seam = tornEdgePoints(seamTop, -10, seamBottom, h + 10, 9, 13, 12);
    // Red half, entering from the left.
    const redShift = (1 - meet) * -(w * 0.7);
    const red: number[] = [-20 + redShift, -10];
    for (let index = 0; index < seam.length; index += 2) red.push(seam[index]! + redShift, seam[index + 1]!);
    red.push(-20 + redShift, h + 10);
    // Starburst half, slamming in from the right.
    const burstShift = (1 - meet) * (w * 0.7);
    const paper: number[] = [w + 20 + burstShift, -10, w + 20 + burstShift, h + 10];
    for (let index = seam.length - 2; index >= 0; index -= 2) paper.push(seam[index]! + burstShift, seam[index + 1]!);
    g.poly(paper).fill(PHANTOM_PAPER);
    const rayX = w * 0.66 + burstShift;
    const rayY = h * 0.42;
    const spin = t * 0.5;
    for (let ray = 0; ray < 18; ray += 1) {
      const a0 = (ray / 18) * Math.PI * 2 + spin;
      const a1 = a0 + Math.PI / 18;
      const reach = w * 0.9;
      const poly = [
        rayX,
        rayY,
        rayX + Math.cos(a0) * reach,
        rayY + Math.sin(a0) * reach,
        rayX + Math.cos(a1) * reach,
        rayY + Math.sin(a1) * reach,
      ];
      g.poly(poly).fill(PHANTOM_INK);
    }
    // The red half is laid over the fan (so the rays stop at the seam), full of out-of-focus bokeh.
    g.poly(red).fill(PHANTOM_RED);
    for (let bokeh = 0; bokeh < 16; bokeh += 1) {
      const bx = hash01(bokeh * 3 + 1) * seamBottom * 1.05 + redShift + Math.sin(nowMs / 900 + bokeh) * 6;
      const by = hash01(bokeh * 3 + 2) * h;
      const radius = 12 + 40 * hash01(bokeh * 3 + 3);
      const color = bokeh % 4 === 0 ? PHANTOM_WHITE : PHANTOM_RED_HOT;
      // Stacked translucent discs read as a soft, out-of-focus light.
      for (let ring = 3; ring >= 1; ring -= 1) {
        g.circle(bx, by, (radius * ring) / 3).fill({ color, alpha: bokeh % 4 === 0 ? 0.08 : 0.12 });
      }
    }
    const rip: number[] = [];
    for (let index = 0; index < seam.length; index += 2)
      rip.push(seam[index]! + (redShift + burstShift) / 2, seam[index + 1]!);
    g.poly(rip, false).stroke({ color: PHANTOM_WHITE, width: 6, join: 'miter' });
    g.poly(rip, false).stroke({ color: PHANTOM_INK, width: 2, join: 'miter' });

    // Title on a tilted ink label, and LET'S GO! cut from magazines, on the starburst half.
    const land = stageProgress(t, 0.3, 0.2);
    if (land > 0) {
      const labelX = w * 0.62;
      const labelY = h * 0.3;
      const pop = 1.5 - 0.5 * easeOutBack(land, 2);
      const title = frame.focusedSong?.title ?? '';
      g.poly(parallelogramPoints(labelX - 150 * pop, labelY - 22 * pop, 300 * pop, 44 * pop, 12)).fill(PHANTOM_INK);
      addSkinText(layer, title, labelX, labelY, {
        size: 20,
        fill: PHANTOM_WHITE,
        fontFamily: DEFAULT_HEADLINE_FONT,
        anchorX: 0.5,
        anchorY: 0.5,
        maxWidth: 270,
        alpha: Math.min(1, land * 3),
      }).scale.y *= pop;
      const glyph: GlyphFactory = (char, options) =>
        addSkinText(layer, char, 0, 0, {
          size: options.size,
          weight: options.weight,
          fill: options.fill,
          fontFamily: options.fontFamily,
        });
      addRansomText(g, glyph, "LET'S GO!", w * 0.62, h * 0.56, {
        size: 44,
        seed: 17,
        angle: -0.1,
        appear: (index) => stageProgress(t, 0.38 + index * 0.035, 0.12),
      });
    }
    // Fall to ink for the handoff.
    const dark = Math.max(0, (t - 0.86) / 0.14);
    if (dark > 0) {
      const cover = new Graphics();
      cover.rect(0, 0, w, h).fill({ color: PHANTOM_INK, alpha: dark });
      layer.addChild(cover);
    }
  }

  public tick(
    nowMs: number,
    focusedSong: BrowserSongEntry | undefined,
    _launchAt?: number,
    audio?: BeMusicAudioFrame,
  ): void {
    // Ambient motion: frozen with effects off, half speed when reduced.
    const seconds = this.effects === 'off' ? 0 : (nowMs / 1000) * (this.effects === 'reduced' ? 0.5 : 1);
    // The BGM / chart preview drives the poster: burst and halftone pump with it, streaks flare, an equalizer rises.
    const drive = audioDrive(audio, this.effects);
    if (this.dots) {
      this.dots.y = (seconds * 14) % DOT_PERIOD;
      this.dots.alpha = Math.min(1, 0.75 + 0.6 * drive.level);
    }
    // Beat clock from the focused chart's BPM, so the whole screen previews the song's tempo.
    const bpm = focusedSong?.bpm;
    const beatsPerSecond = (bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? Math.min(bpm, 300) : 120) / 60;
    const beatPulse = (1 - ((seconds * beatsPerSecond) % 1)) ** 3;
    if (this.burst) {
      this.burst.rotation = seconds * 0.12 + 0.12 * drive.onset;
      this.burst.scale.set(1 + 0.06 * beatPulse + 0.24 * drive.bass + 0.1 * drive.onset);
    }
    this.kicker.x = -((seconds * 36) % KICKER_PITCH);
    const card = this.activeCard;
    if (card) {
      // One sweep across the focused card every couple of seconds.
      const sweep = (seconds % 2.2) / 0.5;
      this.glint.visible = sweep <= 1;
      this.glint.position.set(card.x + sweep * (card.w - GLINT_W), card.y);
      this.glint.scale.set(1, card.h / GLINT_H);
    }
    for (let index = 0; index < this.streaks.length; index += 1) {
      const streak = this.streaks[index]!;
      const speed = 120 + hash01(index + 21) * 160;
      const span = this.designWidth + 260;
      streak.x = ((seconds * speed + hash01(index + 31) * span) % span) - 200;
      streak.y = 60 + hash01(index + 41) * 380;
      streak.alpha = Math.min(1, (this.streakAlpha[index] ?? 0.2) * (1 + 2.2 * drive.high + 1.5 * drive.onset));
    }
    this.drawSpectrum(drive.bands);
    if (this.activeRowY !== undefined) {
      // Pointer kicks toward the card on every beat.
      const kick = Math.max(beatPulse, drive.onset);
      this.pointer.position.set(LAYOUT.listX - 12 + 5 * kick, this.activeRowY);
      this.pointer.scale.set(1 + 0.18 * kick);
    }
  }

  /** 24 slanted red bars along the bottom edge under the list, capped in white; hot bands go gold. */
  private drawSpectrum(bands: readonly number[]): void {
    const g = this.spectrum;
    g.clear();
    const count = 24;
    const left = LAYOUT.listX;
    const pitch = (this.designWidth - 10 - left) / count;
    const base = this.designHeight;
    for (let bar = 0; bar < count; bar += 1) {
      const value = bandLevel(bands, bar, count);
      const h = Math.round(70 * value);
      if (h < 3) continue;
      const x = left + bar * pitch;
      g.poly(parallelogramPoints(x, base - h, pitch - 4, h, 6)).fill({
        color: value > 0.85 ? PHANTOM_GOLD : PHANTOM_RED,
        alpha: 0.55,
      });
      g.poly(parallelogramPoints(x + 6 * (1 - 3 / h), base - h, pitch - 4, 3, (6 * 3) / h)).fill({
        color: PHANTOM_WHITE,
        alpha: 0.8,
      });
    }
  }

  public dispose(): void {
    this.backLayer.destroy({ children: true });
    this.frontLayer.destroy({ children: true });
  }

  /**
   * Builds the persistent layers once: the ink ground and red slab, a masked halftone field that drifts down the slab,
   * a starburst turning behind the lower-left corner, speed streaks, the header kicker, the glint, and the pointer.
   */
  private ensureBuilt(designWidth: number, designHeight: number): void {
    if (this.built) return;
    this.built = true;
    this.designWidth = designWidth;
    this.designHeight = designHeight;
    const ground = new Graphics();
    ground.rect(0, 0, designWidth, designHeight).fill(PHANTOM_BLACK);
    ground.poly(slabPoints(designHeight)).fill(PHANTOM_RED);

    const slabMask = new Graphics().poly(slabPoints(designHeight)).fill(0xffffff);
    const dots = new Graphics();
    for (const dot of halftoneField({
      x: 0,
      y: 40 - DOT_PERIOD,
      w: 236,
      h: designHeight - 40 + DOT_PERIOD,
      pitch: DOT_PITCH,
      maxRadius: 4.4,
      direction: { x: -0.4, y: 1 },
    })) {
      dots.circle(dot.x, dot.y, dot.r).fill({ color: PHANTOM_INK, alpha: 0.5 });
    }
    dots.mask = slabMask;

    const burst = new Graphics();
    burst.poly(starburstPoints(0, 0, 190, 120, 16, 0, 0.18, 9)).fill({ color: PHANTOM_INK, alpha: 0.28 });
    burst.poly(starburstPoints(0, 0, 118, 74, 16, 0.1, 0.2, 4)).fill({ color: PHANTOM_RED_HOT, alpha: 0.55 });
    burst.position.set(36, designHeight - 30);
    const burstMask = new Graphics().poly(slabPoints(designHeight)).fill(0xffffff);
    burst.mask = burstMask;

    const edge = new Graphics().poly([244, 40, 250, 40, 132, designHeight, 126, designHeight]).fill(PHANTOM_WHITE);

    const streakLayer = new Container();
    for (let index = 0; index < 7; index += 1) {
      const streak = new Graphics();
      const length = 60 + hash01(index + 11) * 110;
      streak.poly(parallelogramPoints(0, 0, length, 2 + Math.round(hash01(index + 3) * 2), 3)).fill(PHANTOM_WHITE);
      streak.alpha = 0.12 + hash01(index + 5) * 0.2;
      streakLayer.addChild(streak);
      this.streaks.push(streak);
      this.streakAlpha.push(streak.alpha);
    }
    this.dots = dots;
    this.burst = burst;
    this.backLayer.addChild(ground, burst, burstMask, dots, slabMask, edge, this.spectrum, streakLayer);

    // Header kicker, one tooth wider than the canvas so scrolling by a tooth pitch loops seamlessly.
    const teeth: number[] = [-KICKER_PITCH, 38];
    for (let x = -KICKER_PITCH; x <= designWidth + KICKER_PITCH; x += KICKER_PITCH) {
      teeth.push(x, 38, x + KICKER_PITCH / 2, 44);
    }
    teeth.push(designWidth + KICKER_PITCH, 38);
    this.kicker.poly(teeth).fill(PHANTOM_RED);
    this.kicker.rect(-KICKER_PITCH, 37, designWidth + KICKER_PITCH * 2, 1).fill(PHANTOM_WHITE);
    this.glint.poly(parallelogramPoints(0, 0, GLINT_W, GLINT_H, 6)).fill({ color: PHANTOM_RED_HOT, alpha: 0.45 });
    this.pointer.poly([-14, -9, 2, 0, -14, 9, -10, 0]).fill(PHANTOM_RED).stroke({ color: PHANTOM_WHITE, width: 1 });
  }

  /** Header, info panel, action cards, search box, and library footer. Returns true while the title slides in. */
  private renderChrome(frame: BeMusicSelectFrame): boolean {
    const { layer, designWidth, designHeight, entries, focusedSong: song } = frame;
    const chrome = new Graphics();
    chrome.label = 'default-select/chrome';
    const addText = (text: string, x: number, y: number, options: SkinTextOptions = {}) =>
      addSkinText(layer, text, x, y, options);

    const songTitle = song?.title ?? 'No chart selected';
    const songArtist = song?.artist || song?.subtitle || '';
    const playLevel = song?.playLevel !== undefined ? String(song.playLevel) : '-';
    const playLevelNumber =
      song?.playLevel !== undefined ? Number.parseFloat(String(song.playLevel).replace(/^[^\d.]+/u, '')) : NaN;
    const songBpm = song?.bpm !== undefined ? String(Math.round(song.bpm)) : '-';
    const fileLabel = song?.fileLabel ?? '';
    const modeLabel = song ? formatPlayVariantLabel(song) : '- KEYS';
    const categoryName = frame.searchQuery ? `Search: ${frame.searchQuery}` : (frame.folderLabel ?? 'Library');
    const selectedPosition =
      entries.length > 0 ? `${Math.min(frame.selectedIndex + 1, entries.length)} / ${entries.length}` : '0 / 0';

    // Header: ink bar (the kicker is on the front layer), poster title with a hard red shadow, folder tag.
    chrome.rect(0, 0, designWidth, 38).fill(PHANTOM_INK);
    addText('MUSIC SELECT', 16, 3, {
      size: 24,
      fill: PHANTOM_WHITE,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 1.5,
      skewX: -0.18,
      dropShadow: { color: PHANTOM_RED, distance: 3 },
    });
    drawNoteEmblem(chrome, 214, 27, 22, PHANTOM_WHITE, PHANTOM_RED);
    chrome.poly(parallelogramPoints(designWidth - 196, 9, 180, 20, -8)).fill(PHANTOM_WHITE);
    addText(categoryName, designWidth - 28, 19, {
      size: 11,
      weight: '800',
      fill: PHANTOM_INK,
      anchorX: 1,
      anchorY: 0.5,
      maxWidth: 160,
    });

    // Info panel — ink card with a white rim over a red-shifted shadow card.
    // Left column on a 16 px rhythm: info card, search, library — the card's top and the library's bottom line up with
    // the list well's.
    chrome.poly(parallelogramPoints(18, 60, 286, 292, -6)).fill(PHANTOM_INK);
    chrome
      .poly(parallelogramPoints(12, 54, 286, 292, -6))
      .fill(PHANTOM_BLACK)
      .stroke({ color: PHANTOM_WHITE, width: 2, join: 'miter' });
    chrome.poly(parallelogramPoints(20, 62, 74, 16, 6)).fill(PHANTOM_RED);
    addText('SELECTED', 28, 70, { ...tagStyle(PHANTOM_WHITE), anchorY: 0.5 });
    // Title / artist slide in from the right after each cursor move.
    const slide = 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS));
    addText(songTitle, 24 + slide * 28, 90, {
      size: 18,
      fontFamily: DEFAULT_HEADLINE_FONT,
      fill: PHANTOM_WHITE,
      maxWidth: 268,
      alpha: 1 - slide,
    });
    if (songArtist) {
      addText(songArtist, 24 + slide * 44, 116, {
        size: 10,
        weight: '700',
        fill: PHANTOM_RED_HOT,
        maxWidth: 268,
        alpha: 1 - slide,
      });
    }
    chrome.rect(24, 136, 268, 1).fill(PHANTOM_SLATE);

    // MODE / BPM / LEVEL chips.
    const chips: ReadonlyArray<
      readonly [x: number, w: number, label: string, value: string, fill: number, size: number]
    > = [
      [24, 76, 'MODE', modeLabel, PHANTOM_WHITE, 16],
      [112, 76, 'BPM', songBpm, PHANTOM_WHITE, 22],
      [200, 92, 'LEVEL', playLevel, PHANTOM_GOLD, 24],
    ];
    for (const [x, w, label, value, fill, size] of chips) {
      chrome
        .poly(parallelogramPoints(x, 150, w - 6, 48, 6))
        .fill(PHANTOM_CHARCOAL)
        .stroke({ color: PHANTOM_SLATE, width: 1 });
      addText(label, x + 12, 156, tagStyle(PHANTOM_RED));
      addText(value, x + 10, 168, { size, fill, fontFamily: DEFAULT_DISPLAY_FONT, skewX: -0.18, maxWidth: w - 20 });
    }

    // Level meter as twelve slanted segments.
    const levelRatio = Number.isFinite(playLevelNumber) ? Math.max(0.04, Math.min(1, playLevelNumber / 12)) : 0;
    const segments = 12;
    const segmentW = 268 / segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const lit = segment < Math.round(levelRatio * segments);
      chrome
        .poly(parallelogramPoints(24 + segment * segmentW, 226, segmentW - 3, 12, 4))
        .fill(lit ? (segment >= 9 ? PHANTOM_GOLD : PHANTOM_RED_HOT) : PHANTOM_SLATE);
    }
    if (fileLabel) {
      addText(fileLabel, 24, 249, { size: 9, weight: '600', fill: PHANTOM_ASH, maxWidth: 268 });
    }

    // PLAY is the primary action (big red card); AUTO PLAY is a secondary paper tag. Hit areas below mirror these.
    chrome.poly(parallelogramPoints(29, 303, 168, 36, 8)).fill(PHANTOM_INK);
    chrome
      .poly(parallelogramPoints(24, 298, 168, 36, 8))
      .fill(PHANTOM_RED)
      .stroke({ color: PHANTOM_WHITE, width: 2, join: 'miter' });
    chrome.poly(parallelogramPoints(206, 303, 80, 26, 6)).fill(PHANTOM_PAPER);
    addText('PLAY', 112, 316, {
      size: 24,
      fill: PHANTOM_WHITE,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 3,
      skewX: -0.18,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    addText('AUTO PLAY', 249, 316, {
      size: 12,
      fill: PHANTOM_INK,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 1,
      skewX: -0.18,
      anchorX: 0.5,
      anchorY: 0.5,
      maxWidth: 70,
    });
    addText(selectedPosition, 292, 276, {
      size: 14,
      fill: PHANTOM_ASH,
      fontFamily: DEFAULT_DISPLAY_FONT,
      skewX: -0.18,
      anchorX: 1,
    });

    // Song list well.
    chrome.rect(316, 54, designWidth - 332, designHeight - 80).fill({ color: PHANTOM_INK, alpha: 0.9 });
    chrome.rect(316, 54, 3, designHeight - 80).fill(PHANTOM_RED);
    addText(
      frame.searchQuery ? 'SEARCH RESULTS' : frame.folderLabel ? 'CHARTS' : 'FOLDERS',
      designWidth - 16,
      designHeight - 20,
      { ...tagStyle(PHANTOM_ASH), anchorX: 1 },
    );

    chrome
      .poly(parallelogramPoints(12, 368, 286, 28, -6))
      .fill(PHANTOM_INK)
      .stroke({ color: PHANTOM_WHITE, width: 1.5, join: 'miter' });
    addText('SEARCH', 24, 377, tagStyle(PHANTOM_RED));
    addText(frame.searchQuery || 'Title / artist / genre', 82, 376, {
      size: 10,
      weight: '600',
      fill: frame.searchQuery ? PHANTOM_WHITE : PHANTOM_ASH,
      maxWidth: 210,
    });
    addHitArea(layer, 12, 368, 292, 28, 'text', frame.actions.activateSearch);
    addHitArea(layer, 24, 298, 176, 36, 'pointer', frame.actions.play);
    addHitArea(layer, 206, 302, 86, 30, 'pointer', frame.actions.autoPlay);

    chrome.poly(parallelogramPoints(12, 412, 286, 42, -6)).fill(PHANTOM_INK);
    chrome.poly(parallelogramPoints(18, 420, 6, 26, -3)).fill(PHANTOM_RED);
    addText('LIBRARY', 32, 422, tagStyle(PHANTOM_ASH));
    addText(`${entries.length} shown / ${frame.totalCharts} charts`, 32, 435, {
      size: 11,
      weight: '700',
      fill: PHANTOM_WHITE,
    });

    layer.addChildAt(chrome, 0);
    return slide > 0;
  }

  /** One list row; returns true while it is still flying in or sliding out. */
  private renderRow(
    frame: BeMusicSelectFrame,
    entry: BrowserBrowseEntry,
    entryIndex: number,
    visibleIndex: number,
    listWidth: number,
  ): boolean {
    const { listX, listTop, rowHeight } = LAYOUT;
    const y = listTop + visibleIndex * rowHeight;
    const row = new Graphics();
    const active = entryIndex === frame.selectedIndex;
    const song = entry.kind === 'song' ? entry.song : undefined;
    const folder = entry.kind === 'folder' ? entry.folder : undefined;
    const titleText = song?.title ?? folder?.label ?? '';
    const keyText = song ? formatPlayVariantLabel(song).replace(' KEYS', '') : 'DIR';
    // One line per row: the title centred vertically, with the BPM (or folder size) right-aligned beside it.
    const metaText = song
      ? song.bpm
        ? `${Math.round(song.bpm)} BPM`
        : ''
      : `${folder?.songs.length ?? 0} chart${folder?.songs.length === 1 ? '' : 's'}`;
    const playLevelText =
      song?.playLevel !== undefined ? String(song.playLevel) : folder ? String(folder.songs.length) : '-';
    // The focused row slides out to the left like a pulled card; the rest stay racked against the well. On entry the
    // rows fly in from the right one after another.
    const slide = active ? 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS)) : 0;
    const intro =
      1 - easeOutCubic(stageProgress(frame.nowMs - frame.sceneStartedAt, visibleIndex * INTRO_STAGGER_MS, SLIDE_MS));
    const rowX = (active ? listX - 6 : listX + 4) + slide * 30 + intro * 260;
    const rowW = active ? listWidth + 2 : listWidth - 8;
    const keyPillX = rowX + 8;
    const keyPillW = 26;
    const levelPillX = keyPillX + keyPillW + 4;
    const levelPillW = 26;
    const titleX = levelPillX + levelPillW + 10;
    const textMaxWidth = Math.max(24, rowX + rowW - titleX - 10);
    row.label = `fallback-row[idx=${entryIndex},kind=${entry.kind}${active ? ',active' : ''}]`;
    if (active) {
      row.poly(parallelogramPoints(rowX + 5, y + 3, rowW, rowHeight - 3, 6)).fill(PHANTOM_RED);
      row
        .poly(parallelogramPoints(rowX, y - 1, rowW, rowHeight - 3, 6))
        .fill(PHANTOM_PAPER)
        .stroke({ color: PHANTOM_INK, width: 2, join: 'miter' });
      this.activeRowY = y + rowHeight / 2 - 2;
      this.activeCard = { x: rowX, y: y - 1, w: rowW, h: rowHeight - 3 };
    } else {
      row
        .poly(parallelogramPoints(rowX, y, rowW, rowHeight - 4, 6))
        .fill(visibleIndex % 2 === 0 ? PHANTOM_CHARCOAL : PHANTOM_BLACK)
        .stroke({ color: PHANTOM_SLATE, width: 1 });
    }
    row
      .poly(parallelogramPoints(keyPillX, y + 5, keyPillW, rowHeight - 13, 3))
      .fill(active ? PHANTOM_INK : PHANTOM_SLATE);
    row.poly(parallelogramPoints(levelPillX, y + 5, levelPillW, rowHeight - 13, 3)).fill(PHANTOM_RED);
    frame.layer.addChild(row);

    const pillY = y + rowHeight / 2 - 1.5;
    const pillText = (text: string, x: number, size: number, w: number) =>
      addSkinText(frame.layer, text, x, pillY, {
        size,
        fill: PHANTOM_WHITE,
        fontFamily: DEFAULT_DISPLAY_FONT,
        anchorX: 0.5,
        anchorY: 0.5,
        maxWidth: w - 4,
      });
    pillText(keyText, keyPillX + keyPillW / 2 + 1, 11, keyPillW);
    pillText(playLevelText, levelPillX + levelPillW / 2 + 1, 12, levelPillW);
    const rowMidY = y + (active ? -1 : 0) + (rowHeight - 3) / 2;
    const meta = addSkinText(frame.layer, metaText, rowX + rowW - 12, rowMidY, {
      size: 12,
      fill: active ? PHANTOM_RED : PHANTOM_ASH,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 0.5,
      skewX: -0.18,
      anchorX: 1,
      anchorY: 0.5,
      maxWidth: 64,
    });
    meta.label = `fallback-meta[idx=${entryIndex}]`;
    const metaWidth = metaText ? Math.min(64, meta.width) + 10 : 0;
    const title = addSkinText(frame.layer, titleText, titleX, rowMidY, {
      size: 11,
      weight: '800',
      fill: active ? PHANTOM_INK : PHANTOM_WHITE,
      anchorY: 0.5,
      maxWidth: Math.max(24, textMaxWidth - metaWidth),
    });
    title.label = `fallback-title[idx=${entryIndex}]`;
    return slide > 0 || intro > 0;
  }
}
