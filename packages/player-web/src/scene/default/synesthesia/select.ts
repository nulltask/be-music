import { Container, Graphics, Sprite } from 'pixi.js';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../../collection/types.ts';
import type {
  BeMusicSelectFrame,
  BeMusicSelectLayout,
  BeMusicSelectRenderer,
  BeMusicSelectSkin,
} from '../../../skin/be-music/types.ts';
import { easeOutCubic, stageProgress } from '../phantom-style.ts';
import { addHitArea, addSkinText, formatPlayVariantLabel, type SkinTextOptions } from '../skin-text.ts';
import { hsvToHex, icosahedron, projectPoint, rotateX, rotateY, starfieldPoint } from './space.ts';
import {
  SYN_AMBER,
  SYN_CYAN,
  SYN_DEEP,
  SYN_DIM,
  SYN_DISPLAY_FONT,
  SYN_GLASS,
  SYN_MAGENTA,
  SYN_MIST,
  SYN_TEXT_FONT,
  SYN_VOID,
  SYN_WHITE,
  sceneHue,
  synGlowTexture,
} from './style.ts';

const LAYOUT: BeMusicSelectLayout = { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 };
const SLIDE_MS = 320;
const INTRO_STAGGER_MS = 45;
const STAR_COUNT = 150;
const ORBIT_COUNT = 14;
const ICOSAHEDRON = icosahedron();

export const synesthesiaSelectSkin: BeMusicSelectSkin = {
  layout: LAYOUT,
  createRenderer: () => new SynesthesiaSelectRenderer(),
};

function labelStyle(fill: number = SYN_DIM): SkinTextOptions {
  return { size: 7, fill, fontFamily: SYN_DISPLAY_FONT, letterSpacing: 2.5 };
}

function glassPanel(graphics: Graphics, x: number, y: number, w: number, h: number, rim: number, radius = 8): void {
  graphics.roundRect(x, y, w, h, radius).fill({ color: SYN_GLASS, alpha: 0.58 });
  graphics.roundRect(x - 2, y - 2, w + 4, h + 4, radius + 2).stroke({ color: rim, width: 4, alpha: 0.07 });
  graphics.roundRect(x, y, w, h, radius).stroke({ color: rim, width: 1, alpha: 0.5 });
  graphics.rect(x + radius + 4, y, w - radius * 2 - 8, 1).fill({ color: SYN_WHITE, alpha: 0.4 });
}

/**
 * Synesthesia song select. The persistent back layer is a 3D space — a star tunnel whose speed follows the focused
 * chart's BPM, a large wireframe icosahedron tumbling behind the info panel, and a floor grid scrolling into the
 * horizon — all animated by transform / cheap redraws in `tick`. The front layer orbits a ring of light around the
 * focused card.
 */
class SynesthesiaSelectRenderer implements BeMusicSelectRenderer {
  public readonly backLayer = new Container();
  public readonly frontLayer = new Container();
  private readonly ground = new Graphics();
  private readonly wireframe = new Graphics();
  private readonly floor = new Graphics();
  private readonly stars: Sprite[] = [];
  private readonly orbit: Sprite[] = [];
  private readonly cursorGlow = new Sprite();
  private built = false;
  private designWidth = 640;
  private designHeight = 480;
  private activeCard: { x: number; y: number; w: number; h: number } | undefined;

  public constructor() {
    this.backLayer.label = 'synesthesia-select/space';
    this.frontLayer.label = 'synesthesia-select/front';
  }

  public render(frame: BeMusicSelectFrame): boolean {
    this.ensureBuilt(frame.designWidth, frame.designHeight);
    this.activeCard = undefined;
    let needsFrame = this.renderChrome(frame);
    const listWidth = frame.designWidth - LAYOUT.listX - 14;
    for (let visibleIndex = 0; visibleIndex < frame.visibleRows; visibleIndex += 1) {
      const entryIndex = frame.firstVisibleIndex + visibleIndex;
      const entry = frame.entries[entryIndex];
      if (!entry) break;
      needsFrame = this.renderRow(frame, entry, entryIndex, visibleIndex, listWidth) || needsFrame;
    }
    const visible = this.activeCard !== undefined;
    this.cursorGlow.visible = visible;
    for (const sprite of this.orbit) sprite.visible = visible;
    return needsFrame;
  }

  public tick(nowMs: number, focusedSong: BrowserSongEntry | undefined): void {
    const seconds = nowMs / 1000;
    const bpm = focusedSong?.bpm;
    const beatsPerSecond = (bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? Math.min(bpm, 300) : 120) / 60;
    const beatPhase = (seconds * beatsPerSecond) % 1;
    const pulse = (1 - beatPhase) ** 3;
    const hue = sceneHue(seconds, beatPhase);
    const accent = hsvToHex(hue, 0.6, 1);

    // Star tunnel — speed follows the focused chart's tempo.
    const cx = this.designWidth * 0.58;
    const cy = this.designHeight * 0.44;
    const speed = 80 + beatsPerSecond * 55;
    for (let index = 0; index < this.stars.length; index += 1) {
      const star = this.stars[index]!;
      const point = starfieldPoint(index, seconds, { spread: 560, near: 10, far: 1000, speed });
      const projected = projectPoint(point, cx, cy, 200);
      star.visible = projected.visible;
      if (!projected.visible) continue;
      const nearness = Math.min(1, projected.scale);
      const size = 2 + 16 * nearness * nearness;
      star.position.set(projected.x, projected.y);
      star.width = size;
      star.height = size;
      star.alpha = 0.15 + 0.85 * nearness;
      star.tint = hsvToHex(hue + (index % 6) * 0.05, 0.25 + 0.35 * (index % 3 === 0 ? 1 : 0), 1);
    }

    // Wireframe icosahedron tumbling behind the info panel, breathing on the beat.
    const radius = 150 * (1 + 0.04 * pulse);
    const projected = ICOSAHEDRON.vertices.map((vertex) =>
      projectPoint(
        rotateX(
          rotateY({ x: vertex.x * radius, y: vertex.y * radius, z: vertex.z * radius }, seconds * 0.22),
          0.5 + seconds * 0.13,
        ),
        150,
        250,
        420,
      ),
    );
    this.wireframe.clear();
    for (const [a, b] of ICOSAHEDRON.edges) {
      const pa = projected[a]!;
      const pb = projected[b]!;
      const depth = (pa.scale + pb.scale) / 2;
      this.wireframe
        .moveTo(pa.x, pa.y)
        .lineTo(pb.x, pb.y)
        .stroke({ color: accent, width: 4, alpha: 0.05 * depth });
      this.wireframe
        .moveTo(pa.x, pa.y)
        .lineTo(pb.x, pb.y)
        .stroke({ color: accent, width: 1, alpha: 0.2 + 0.25 * (depth - 0.8) });
    }
    for (const point of projected) {
      this.wireframe.circle(point.x, point.y, 2 * point.scale).fill({ color: SYN_WHITE, alpha: 0.6 });
    }

    // Floor grid scrolling toward the viewer.
    const horizon = this.designHeight * 0.7;
    const project = (x: number, z: number) => projectPoint({ x, y: 150, z }, cx, horizon, 200);
    this.floor.clear();
    for (let x = -1400; x <= 1400; x += 100) {
      const near = project(x, 0);
      const far = project(x, 2600);
      this.floor.moveTo(near.x, near.y).lineTo(far.x, far.y).stroke({ color: accent, width: 1, alpha: 0.12 });
    }
    const spacing = 100;
    const offset = (seconds * speed) % spacing;
    for (let z = spacing - offset; z < 2600; z += spacing) {
      const left = project(-1400, z);
      const right = project(1400, z);
      this.floor
        .moveTo(left.x, left.y)
        .lineTo(right.x, right.y)
        .stroke({ color: accent, width: 1, alpha: (0.06 + 0.2 * (1 - z / 2600)) * (0.7 + 0.3 * pulse) });
    }
    this.floor.rect(0, horizon - 1, this.designWidth, 2).fill({ color: accent, alpha: 0.2 + 0.2 * pulse });

    // Ring of light orbiting the focused card, plus a breathing glow under it.
    const card = this.activeCard;
    if (card) {
      const perimeter = 2 * (card.w + card.h);
      for (let index = 0; index < this.orbit.length; index += 1) {
        const sprite = this.orbit[index]!;
        const along = (((seconds * 140 + (index * perimeter) / this.orbit.length) % perimeter) + perimeter) % perimeter;
        const point = pointOnRect(card, along);
        sprite.position.set(point.x, point.y);
        const size = 10 + 8 * pulse;
        sprite.width = size;
        sprite.height = size;
        sprite.tint = hsvToHex(hue + index / this.orbit.length / 2, 0.55, 1);
        sprite.alpha = 0.65;
      }
      this.cursorGlow.position.set(card.x + card.w / 2, card.y + card.h / 2);
      this.cursorGlow.width = card.w * 1.15;
      this.cursorGlow.height = card.h * 3.2;
      this.cursorGlow.tint = accent;
      this.cursorGlow.alpha = 0.18 + 0.2 * pulse;
    }
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
    const bands: ReadonlyArray<readonly [number, number]> = [
      [SYN_DEEP, 0.25],
      [0x080620, 0.45],
      [0x05051a, 0.65],
      [0x030410, 0.8],
      [SYN_VOID, 1],
    ];
    let top = 0;
    for (const [color, until] of bands) {
      const bottom = designHeight * until;
      this.ground.rect(0, top, designWidth, bottom - top).fill(color);
      top = bottom;
    }
    for (const [x, y, radius, color] of [
      [120, 440, 220, SYN_MAGENTA],
      [560, 90, 200, SYN_CYAN],
    ] as const) {
      for (let ring = 4; ring >= 1; ring -= 1) {
        this.ground.circle(x, y, (radius * ring) / 4).fill({ color, alpha: 0.03 });
      }
    }
    const glow = synGlowTexture();
    const starLayer = new Container();
    starLayer.blendMode = 'add';
    for (let index = 0; index < STAR_COUNT; index += 1) {
      const star = new Sprite(glow);
      star.anchor.set(0.5);
      star.blendMode = 'add';
      starLayer.addChild(star);
      this.stars.push(star);
    }
    this.backLayer.addChild(this.ground, this.floor, starLayer, this.wireframe);

    this.cursorGlow.texture = glow;
    this.cursorGlow.anchor.set(0.5);
    this.cursorGlow.blendMode = 'add';
    this.frontLayer.addChild(this.cursorGlow);
    for (let index = 0; index < ORBIT_COUNT; index += 1) {
      const sprite = new Sprite(glow);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      this.frontLayer.addChild(sprite);
      this.orbit.push(sprite);
    }
  }

  private renderChrome(frame: BeMusicSelectFrame): boolean {
    const { layer, designWidth, designHeight, entries, focusedSong: song } = frame;
    const chrome = new Graphics();
    chrome.label = 'synesthesia-select/chrome';
    const hue = sceneHue(frame.nowMs / 1000);
    const accent = hsvToHex(hue, 0.6, 1);
    const addText = (text: string, x: number, y: number, options: SkinTextOptions = {}) =>
      addSkinText(layer, text, x, y, options);

    const songTitle = song?.title ?? 'No chart selected';
    const songArtist = song?.artist || song?.subtitle || '';
    const playLevel = song?.playLevel !== undefined ? String(song.playLevel) : '-';
    const playLevelNumber =
      song?.playLevel !== undefined ? Number.parseFloat(String(song.playLevel).replace(/^[^\d.]+/u, '')) : NaN;
    const songBpm = song?.bpm !== undefined ? String(Math.round(song.bpm)) : '-';
    const modeLabel = song ? formatPlayVariantLabel(song) : '- KEYS';
    const categoryName = frame.searchQuery ? `Search: ${frame.searchQuery}` : (frame.folderLabel ?? 'Library');
    const position =
      entries.length > 0 ? `${Math.min(frame.selectedIndex + 1, entries.length)} / ${entries.length}` : '0 / 0';

    // Header: title as light, a hairline, and the folder on the right.
    chrome.rect(0, 0, designWidth, 38).fill({ color: SYN_VOID, alpha: 0.5 });
    chrome.rect(0, 38, designWidth, 1).fill({ color: accent, alpha: 0.5 });
    const intro = easeOutCubic(stageProgress(frame.nowMs - frame.sceneStartedAt, 0, 900));
    addText('MUSIC SELECT', 18, 13, {
      size: 12,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 4 + 8 * (1 - intro) + 2,
      alpha: intro,
      dropShadow: { color: accent, distance: 0, blur: 8, alpha: 0.9 },
    });
    addText(categoryName, designWidth - 18, 14, {
      size: 10,
      weight: '500',
      fill: SYN_MIST,
      fontFamily: SYN_TEXT_FONT,
      anchorX: 1,
      maxWidth: 220,
    });

    // Info panel.
    glassPanel(chrome, 14, 56, 290, 302, accent);
    addText('NOW SELECTING', 30, 70, labelStyle(accent));
    const slide = 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS));
    addText(songTitle, 30 + slide * 24, 86, {
      size: 18,
      weight: '500',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      maxWidth: 258,
      alpha: 1 - slide,
      dropShadow: { color: accent, distance: 0, blur: 10, alpha: 0.8 },
    });
    if (songArtist) {
      addText(songArtist, 30 + slide * 40, 114, {
        size: 10,
        weight: '300',
        fill: SYN_MIST,
        fontFamily: SYN_TEXT_FONT,
        maxWidth: 258,
        alpha: 1 - slide,
      });
    }
    chrome.rect(30, 136, 258, 1).fill({ color: accent, alpha: 0.35 });

    const stats: ReadonlyArray<readonly [x: number, w: number, label: string, value: string, fill: number]> = [
      [30, 80, 'MODE', modeLabel, SYN_WHITE],
      [118, 76, 'BPM', songBpm, SYN_WHITE],
      [202, 86, 'LEVEL', playLevel, SYN_AMBER],
    ];
    for (const [x, w, label, value, fill] of stats) {
      chrome.roundRect(x, 150, w, 50, 6).fill({ color: SYN_VOID, alpha: 0.5 });
      chrome.roundRect(x, 150, w, 50, 6).stroke({ color: accent, width: 1, alpha: 0.25 });
      addText(label, x + 10, 158, labelStyle());
      addText(value, x + 10, 174, {
        size: 14,
        fill,
        fontFamily: SYN_DISPLAY_FONT,
        maxWidth: w - 18,
        dropShadow: { color: fill, distance: 0, blur: 6, alpha: 0.6 },
      });
    }

    // Level as a row of lights, cooling cyan → hot magenta.
    const levelRatio = Number.isFinite(playLevelNumber) ? Math.max(0.04, Math.min(1, playLevelNumber / 12)) : 0;
    const dots = 12;
    for (let dot = 0; dot < dots; dot += 1) {
      const lit = dot < Math.round(levelRatio * dots);
      const x = 38 + dot * 22;
      const color = hsvToHex(0.52 + (dot / dots) * 0.38, 0.6, 1);
      if (lit) {
        chrome.circle(x, 226, 7).fill({ color, alpha: 0.18 });
        chrome.circle(x, 226, 3).fill({ color: SYN_WHITE, alpha: 0.95 });
      } else {
        chrome.circle(x, 226, 2).fill({ color: SYN_DIM, alpha: 0.5 });
      }
    }
    if (song?.fileLabel) {
      addText(song.fileLabel, 30, 246, {
        size: 8,
        weight: '300',
        fill: SYN_DIM,
        fontFamily: SYN_TEXT_FONT,
        maxWidth: 258,
      });
    }
    addText(position, 288, 268, { size: 9, fill: SYN_MIST, fontFamily: SYN_DISPLAY_FONT, anchorX: 1 });

    // PLAY (primary glowing pill) / AUTO PLAY (secondary outline).
    chrome.roundRect(26, 296, 170, 40, 20).fill({ color: accent, alpha: 0.18 });
    chrome.roundRect(30, 300, 162, 32, 16).fill({ color: accent, alpha: 0.85 });
    chrome.roundRect(30, 300, 162, 32, 16).stroke({ color: SYN_WHITE, width: 1, alpha: 0.8 });
    addText('PLAY', 111, 316, {
      size: 14,
      fill: SYN_VOID,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 6,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    chrome.roundRect(204, 303, 86, 26, 13).stroke({ color: SYN_MIST, width: 1, alpha: 0.6 });
    addText('AUTO', 247, 316, {
      size: 9,
      fill: SYN_MIST,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 3,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    addHitArea(layer, 26, 296, 172, 40, 'pointer', frame.actions.play);
    addHitArea(layer, 202, 300, 92, 32, 'pointer', frame.actions.autoPlay);

    // Search and library.
    glassPanel(chrome, 14, 372, 290, 30, accent, 15);
    addText('SEARCH', 30, 384, labelStyle(accent));
    addText(frame.searchQuery || 'Title / artist / genre', 90, 380, {
      size: 10,
      weight: '300',
      fill: frame.searchQuery ? SYN_WHITE : SYN_DIM,
      fontFamily: SYN_TEXT_FONT,
      maxWidth: 200,
    });
    addHitArea(layer, 14, 372, 290, 30, 'text', frame.actions.activateSearch);
    addText('LIBRARY', 30, 422, labelStyle());
    addText(`${entries.length} shown / ${frame.totalCharts} charts`, 30, 436, {
      size: 11,
      weight: '500',
      fill: SYN_MIST,
      fontFamily: SYN_TEXT_FONT,
    });
    addText(
      frame.searchQuery ? 'SEARCH RESULTS' : frame.folderLabel ? 'CHARTS' : 'FOLDERS',
      designWidth - 18,
      designHeight - 20,
      { ...labelStyle(), anchorX: 1 },
    );

    layer.addChildAt(chrome, 0);
    return slide > 0 || intro < 1;
  }

  private renderRow(
    frame: BeMusicSelectFrame,
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
    const hue = sceneHue(frame.nowMs / 1000);
    const accent = hsvToHex(hue, 0.6, 1);
    const slide = active ? 1 - easeOutCubic(stageProgress(frame.nowMs - frame.cursorChangedAt, 0, SLIDE_MS)) : 0;
    const intro =
      1 - easeOutCubic(stageProgress(frame.nowMs - frame.sceneStartedAt, 120 + visibleIndex * INTRO_STAGGER_MS, 420));
    const rowX = (active ? listX - 8 : listX) + slide * 26 + intro * 120;
    const rowW = active ? listWidth + 8 : listWidth;
    const alpha = 1 - intro;
    const row = new Graphics();
    row.alpha = alpha;
    row.label = `fallback-row[idx=${entryIndex},kind=${entry.kind}${active ? ',active' : ''}]`;
    if (active) {
      row.roundRect(rowX, y, rowW, rowHeight - 4, 12).fill({ color: accent, alpha: 0.22 });
      row.roundRect(rowX, y, rowW, rowHeight - 4, 12).stroke({ color: SYN_WHITE, width: 1, alpha: 0.85 });
      this.activeCard = { x: rowX, y, w: rowW, h: rowHeight - 4 };
    } else {
      row.roundRect(rowX, y, rowW, rowHeight - 4, 12).fill({ color: SYN_GLASS, alpha: 0.5 });
      row.roundRect(rowX, y, rowW, rowHeight - 4, 12).stroke({ color: accent, width: 1, alpha: 0.18 });
    }
    // Level as a glowing orb on the leading edge.
    const level = song?.playLevel !== undefined ? String(song.playLevel) : folder ? 'DIR' : '-';
    const orbColor = song ? hsvToHex(0.52 + Math.min(1, Number.parseFloat(level) / 12 || 0) * 0.38, 0.6, 1) : SYN_MIST;
    row.circle(rowX + 16, y + (rowHeight - 4) / 2, 9).fill({ color: orbColor, alpha: active ? 0.35 : 0.18 });
    frame.layer.addChild(row);
    const midY = y + (rowHeight - 4) / 2;
    addSkinText(frame.layer, level, rowX + 16, midY, {
      size: level.length > 2 ? 6 : 8,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      alpha,
      maxWidth: 16,
    });
    const meta = song
      ? `${song.bpm ? `${Math.round(song.bpm)} BPM` : ''}`
      : `${folder?.songs.length ?? 0} chart${folder?.songs.length === 1 ? '' : 's'}`;
    const metaNode = addSkinText(frame.layer, meta, rowX + rowW - 14, midY, {
      size: 8,
      fill: active ? SYN_WHITE : SYN_DIM,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 1,
      anchorX: 1,
      anchorY: 0.5,
      alpha,
      maxWidth: 70,
    });
    metaNode.label = `fallback-meta[idx=${entryIndex}]`;
    const metaWidth = meta ? Math.min(70, metaNode.width) + 12 : 0;
    const title = addSkinText(frame.layer, song?.title ?? folder?.label ?? '', rowX + 34, midY, {
      size: 11,
      weight: active ? '500' : '300',
      fill: SYN_WHITE,
      fontFamily: SYN_TEXT_FONT,
      anchorY: 0.5,
      alpha,
      maxWidth: Math.max(24, rowW - 48 - metaWidth),
      ...(active ? { dropShadow: { color: accent, distance: 0, blur: 8, alpha: 0.9 } } : {}),
    });
    title.label = `fallback-title[idx=${entryIndex}]`;
    return slide > 0 || intro > 0;
  }
}

/** Point `distance` px along the perimeter of `rect`, clockwise from the top-left corner. */
function pointOnRect(rect: { x: number; y: number; w: number; h: number }, distance: number): { x: number; y: number } {
  if (distance < rect.w) return { x: rect.x + distance, y: rect.y };
  if (distance < rect.w + rect.h) return { x: rect.x + rect.w, y: rect.y + distance - rect.w };
  if (distance < rect.w * 2 + rect.h) return { x: rect.x + rect.w - (distance - rect.w - rect.h), y: rect.y + rect.h };
  return { x: rect.x, y: rect.y + rect.h - (distance - rect.w * 2 - rect.h) };
}
