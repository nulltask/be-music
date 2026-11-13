import { Container } from 'pixi.js';
import type { TimingResolver } from '@be-music/chart-model';
import type { PlaySide } from '@be-music/player-scene-model';
import { addHUDNumber, measureHUDNumber, type HUDTextOptions } from '../../skins/pixi-kit/hud-text.ts';
import { ChildPool } from '../../skins/pixi-kit/pools.ts';
import { textResolution } from '../../skins/pixi-kit/resolution.ts';
import { measureLayer, type DisplayAreaLane } from './display-area-info.ts';
import { setHidden, setStyle } from './dom-style.ts';

/**
 * AC 34's BPM-change warning (#746). The official introduction draws `<current> » <next>` in a framed box centred on the
 * lanes just above the judgment and combo, blue when the tempo rises and red when it falls. Play footage shows it from
 * 2 s before each BPM change until the change. The TYPE A–D variants of the source are not known yet; this is the style
 * the introduction shows. How the warning leaves is not known from the source either: Be-Music fades it out after the
 * change rather than cutting it.
 */
export const BPM_CHANGE_WARNING_LEAD_SECONDS = 2;
/** How long the warning takes to fade in. */
const FADE_SECONDS = 0.1;
/** How long the warning takes to fade out after its change. */
export const BPM_CHANGE_WARNING_FADE_OUT_SECONDS = 0.3;

/**
 * The warning's look. The source's blue for a rising tempo and red for a falling one stay; a skin gives its own blue
 * and red, type and frame so the box reads as part of it. Lengths are in units of the text size.
 */
export interface BPMChangeWarningStyle {
  /** A CSS font family list, used by Canvas and DOM skins alike. */
  readonly fontFamily: string;
  readonly fontWeight: '500' | '600' | '700' | '800' | '900';
  readonly letterSpacing: number;
  readonly rising: number;
  readonly falling: number;
  readonly background: number;
  readonly backgroundAlpha: number;
  readonly borderWidth: number;
  readonly radius: number;
}

/** The look on a skin that names none: the framed monospace box of the introduction. */
export const DEFAULT_BPM_CHANGE_WARNING_STYLE: BPMChangeWarningStyle = {
  fontFamily: 'monospace',
  fontWeight: '700',
  letterSpacing: 0,
  rising: 0x4aa8ff,
  falling: 0xff5a5a,
  background: 0x000000,
  backgroundAlpha: 0.65,
  borderWidth: 0.125,
  radius: 0.15,
};

/** The box's padding around the text, in units of the text size. */
const PADDING_X = 0.6;
const BOX_HEIGHT = 1.5;

/** One BPM change of a chart, in chart seconds. */
export interface BPMChange {
  readonly seconds: number;
  readonly from: number;
  readonly to: number;
}

/** The warning showing at a moment of the play. */
export interface BPMChangeWarning {
  readonly from: number;
  readonly to: number;
  readonly rising: boolean;
  /** Chart seconds since the warning appeared. */
  readonly elapsedSeconds: number;
  /** 0 to 1: fading in as the warning appears, and out after its change. */
  readonly opacity: number;
}

/** Where a side's warning is drawn: the centre of its box, and the text size that fits its lanes. */
export interface BPMChangeWarningPlacement {
  readonly side: PlaySide;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/**
 * The chart's actual BPM changes, in time order. Changes at the same instant merge into one, from the BPM before the
 * first to the BPM after the last; a change back to the same BPM is none.
 */
export function collectBPMChanges(timing: Pick<TimingResolver, 'tempoPoints' | 'beatToSeconds'>): BPMChange[] {
  const result: BPMChange[] = [];
  let current: number | undefined;
  for (const point of timing.tempoPoints) {
    if (current === undefined) {
      current = point.bpm;
      continue;
    }
    if (point.bpm === current) continue;
    const seconds = timing.beatToSeconds(point.beat);
    const last = result.at(-1);
    if (last !== undefined && last.seconds === seconds) {
      result.pop();
      if (last.from !== point.bpm) result.push({ seconds, from: last.from, to: point.bpm });
    } else {
      result.push({ seconds, from: current, to: point.bpm });
    }
    current = point.bpm;
  }
  return result;
}

/**
 * The warning at chart time `nowSeconds`: the next change, while it is at most `leadSeconds` away; otherwise the change
 * that just happened, fading out for {@link BPM_CHANGE_WARNING_FADE_OUT_SECONDS}.
 */
export function resolveBPMChangeWarning(
  changes: readonly BPMChange[],
  nowSeconds: number,
  leadSeconds = BPM_CHANGE_WARNING_LEAD_SECONDS,
): BPMChangeWarning | undefined {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (changes[mid]!.seconds <= nowSeconds) low = mid + 1;
    else high = mid;
  }
  const next = changes[low];
  if (next !== undefined && next.seconds - nowSeconds <= leadSeconds) {
    const elapsedSeconds = nowSeconds - (next.seconds - leadSeconds);
    return {
      from: next.from,
      to: next.to,
      rising: next.to > next.from,
      elapsedSeconds,
      opacity: Math.min(1, Math.max(0, elapsedSeconds / FADE_SECONDS)),
    };
  }
  const previous = changes[low - 1];
  if (previous === undefined) return undefined;
  const sinceChange = nowSeconds - previous.seconds;
  if (sinceChange >= BPM_CHANGE_WARNING_FADE_OUT_SECONDS) return undefined;
  return {
    from: previous.from,
    to: previous.to,
    rising: previous.to > previous.from,
    elapsedSeconds: nowSeconds - (previous.seconds - leadSeconds),
    opacity: 1 - sinceChange / BPM_CHANGE_WARNING_FADE_OUT_SECONDS,
  };
}

/** The warning's text: whole BPMs, as the source shows them. */
export function formatBPMChangeWarning(warning: Pick<BPMChangeWarning, 'from' | 'to'>): string {
  return `${Math.trunc(warning.from)} » ${Math.trunc(warning.to)}`;
}

/**
 * One placement per side: centred on the side's lanes, with text sized to a twentieth of the lanes' width. The
 * introduction shows the box just above the judgment and combo (about 62 % down AC's lanes); skins put their judgment
 * anywhere from 40 % to 65 % down, so the box sits half-way down the lanes, which clears it on the built-in skins.
 * `judgePosition` is the judgment position option, in percent of the lanes' height: the box moves with the judgment it
 * moves, which keeps the two as far apart as the skin placed them.
 */
export function resolveBPMChangeWarningPlacements(
  lanes: readonly DisplayAreaLane[],
  judgePosition = 0,
): BPMChangeWarningPlacement[] {
  const result: BPMChangeWarningPlacement[] = [];
  for (const side of ['1P', '2P'] as const) {
    const own = lanes.filter((lane) => lane.side === side && lane.w > 0 && lane.bottom > lane.top);
    if (own.length === 0) continue;
    const left = Math.min(...own.map((lane) => lane.x));
    const right = Math.max(...own.map((lane) => lane.x + lane.w));
    const top = Math.min(...own.map((lane) => lane.top));
    const bottom = Math.max(...own.map((lane) => lane.baseBottom ?? lane.bottom));
    result.push({
      side,
      x: (left + right) / 2,
      y: top + (bottom - top) * (0.5 + judgePosition / 100),
      size: Math.max(10, Math.min(28, (right - left) / 20)),
    });
  }
  return result;
}

/** The text options a Canvas skin draws the warning's figures with. */
export function resolveBPMChangeWarningTextOptions(
  style: BPMChangeWarningStyle,
  size: number,
  rising: boolean,
): HUDTextOptions {
  return {
    size,
    weight: style.fontWeight,
    fontFamily: style.fontFamily,
    letterSpacing: style.letterSpacing * size,
    fill: rising ? style.rising : style.falling,
    anchorX: 0.5,
    anchorY: 0.5,
  };
}

/**
 * How many times its size a Canvas skin rasterizes the warning's text at, drawn back down to size: `density` is the
 * canvas pixels one design pixel covers, `resolution` what Pixi-kit text already rasterizes at. In half steps so a
 * resize does not rasterize the glyphs again at every width, and at most 4 times.
 */
export function resolveBPMChangeWarningTextScale(density: number, resolution: number): number {
  if (!Number.isFinite(density) || !Number.isFinite(resolution) || resolution <= 0) return 1;
  return Math.min(4, Math.max(1, Math.ceil((density / resolution) * 2) / 2));
}

function cssColor(color: number, alpha = 1): string {
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  return alpha >= 1
    ? hex
    : `${hex}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0')}`;
}

/** A pointer-transparent warning layer, shared by Canvas and DOM skins and removed with its play view. */
export class BPMChangeWarningOverlay {
  private root: HTMLElement | undefined;
  private canvas: Container | undefined;
  private pool: ChildPool | undefined;
  private nodes: HTMLElement[] = [];
  private changes: { timing: TimingResolver; changes: BPMChange[] } | undefined;

  /** Draws the warning of the play at chart time `seconds`, or none when the option is off. */
  show(input: {
    enabled: boolean;
    timing: TimingResolver | undefined;
    seconds: number;
    lanes: readonly DisplayAreaLane[];
    stage: { width: number; height: number };
    screen: { width: number; height: number };
    opacity?: number;
    /** The judgment position option, when the skin's judgment follows it. */
    judgePosition?: number;
    /** The skin's look for the box; the introduction's when it names none. */
    style?: BPMChangeWarningStyle;
    /** The renderer's resolution (canvas pixels per screen pixel), for a Canvas skin's text to rasterize sharp. */
    resolution?: number;
  }): void {
    let warning: BPMChangeWarning | undefined;
    if (input.enabled && input.timing) {
      if (this.changes?.timing !== input.timing)
        this.changes = { timing: input.timing, changes: collectBPMChanges(input.timing) };
      warning = resolveBPMChangeWarning(this.changes.changes, input.seconds);
    }
    this.update(
      warning,
      input.lanes,
      input.stage,
      input.screen,
      input.opacity,
      input.judgePosition,
      input.style,
      input.resolution,
    );
  }

  attachCanvas(parent: Container): void {
    this.root?.remove();
    if (this.canvas?.destroyed) {
      this.canvas = undefined;
      this.pool = undefined;
    }
    if (!this.canvas) {
      this.canvas = new Container({ label: 'bpm-change-warning', eventMode: 'none' });
      this.pool = new ChildPool(this.canvas);
    }
    if (this.canvas.parent !== parent) parent.addChild(this.canvas);
  }

  attach(parent: HTMLElement): void {
    this.canvas?.removeFromParent();
    this.root ??= parent.ownerDocument.createElement('div');
    this.root.dataset.bpmChangeWarning = '';
    this.root.setAttribute('aria-hidden', 'true');
    Object.assign(this.root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    parent.append(this.root);
  }

  update(
    warning: BPMChangeWarning | undefined,
    lanes: readonly DisplayAreaLane[],
    stage: { width: number; height: number },
    screen: { width: number; height: number },
    opacity = 1,
    judgePosition = 0,
    style: BPMChangeWarningStyle = DEFAULT_BPM_CHANGE_WARNING_STYLE,
    resolution = 1,
  ): void {
    const placements = warning === undefined ? [] : resolveBPMChangeWarningPlacements(lanes, judgePosition);
    const text = warning === undefined ? '' : formatBPMChangeWarning(warning);
    if (this.canvas?.parent) {
      this.updateCanvas(warning, text, placements, style, resolution);
      return;
    }
    const root = this.root;
    if (!root) return;
    setHidden(root, placements.length === 0);
    // Nothing to place: skip the measure, which would force a layout every frame.
    if (placements.length === 0) return;
    const { width, height } = measureLayer(root, screen);
    setStyle(root, 'opacity', String(opacity * (warning?.opacity ?? 1)));
    const scale = Math.min(width / stage.width, height / stage.height);
    const offsetX = (width - stage.width * scale) / 2;
    const offsetY = (height - stage.height * scale) / 2;
    placements.forEach((placement, index) => {
      let node = this.nodes[index];
      if (!node) {
        node = root.ownerDocument.createElement('div');
        Object.assign(node.style, {
          position: 'absolute',
          whiteSpace: 'pre',
          // Every figure as wide as the widest, so the box keeps its width as the digits change.
          fontVariantNumeric: 'tabular-nums',
          borderStyle: 'solid',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          transform: 'translate(-50%, -50%)',
        });
        root.append(node);
        this.nodes[index] = node;
      }
      const color = cssColor(warning!.rising ? style.rising : style.falling);
      const size = placement.size * scale;
      setHidden(node, false);
      node.dataset.side = placement.side;
      node.dataset.direction = warning!.rising ? 'rising' : 'falling';
      if (node.textContent !== text) node.textContent = text;
      setStyle(node, 'fontSize', `${size}px`);
      setStyle(node, 'color', color);
      setStyle(node, 'borderColor', color);
      setStyle(node, 'fontFamily', style.fontFamily);
      setStyle(node, 'fontWeight', style.fontWeight);
      setStyle(node, 'letterSpacing', `${style.letterSpacing * size}px`);
      setStyle(node, 'lineHeight', '1');
      setStyle(node, 'background', cssColor(style.background, style.backgroundAlpha));
      setStyle(node, 'borderRadius', `${style.radius * size}px`);
      setStyle(node, 'borderWidth', `${Math.max(1, size * style.borderWidth)}px`);
      setStyle(node, 'height', `${size * BOX_HEIGHT}px`);
      setStyle(node, 'padding', `0 ${size * PADDING_X}px`);
      setStyle(node, 'left', `${offsetX + placement.x * scale}px`);
      setStyle(node, 'top', `${offsetY + placement.y * scale}px`);
    });
    for (let index = placements.length; index < this.nodes.length; index++) setHidden(this.nodes[index]!, true);
  }

  private updateCanvas(
    warning: BPMChangeWarning | undefined,
    text: string,
    placements: readonly BPMChangeWarningPlacement[],
    style: BPMChangeWarningStyle,
    resolution: number,
  ): void {
    const canvas = this.canvas!;
    const pool = this.pool!;
    canvas.visible = placements.length > 0;
    if (warning === undefined || placements.length === 0) return;
    canvas.alpha = warning.opacity;
    const color = warning.rising ? style.rising : style.falling;
    // The design canvas is magnified onto the screen: rasterize the glyphs at the size they show at.
    const raster = resolveBPMChangeWarningTextScale(Math.abs(canvas.worldTransform.a) * resolution, textResolution());
    pool.begin();
    for (const placement of placements) {
      const { size } = placement;
      // Figures in tabular cells, each glyph its own text: one text whose string and style change in place keeps the
      // raster of the string it held, which cut the right end of a longer one off.
      const options = resolveBPMChangeWarningTextOptions(style, size * raster, warning.rising);
      const width = measureHUDNumber(text, options) / raster + size * PADDING_X * 2;
      const height = size * BOX_HEIGHT;
      const box = pool.acquireGraphics();
      box.label = `bpm-change-warning:${placement.side}`;
      box
        .roundRect(placement.x - width / 2, placement.y - height / 2, width, height, size * style.radius)
        .fill({ color: style.background, alpha: style.backgroundAlpha })
        .stroke({ color, width: Math.max(1, size * style.borderWidth) });
      addHUDNumber(canvas, text, placement.x, placement.y, { ...options, scale: 1 / raster }, pool);
    }
    pool.end();
  }

  hide(): void {
    if (this.canvas) this.canvas.visible = false;
    if (this.root) this.root.hidden = true;
  }

  detach(): void {
    this.root?.remove();
    this.canvas?.removeFromParent();
  }

  dispose(): void {
    this.detach();
    this.nodes = [];
    this.root = undefined;
    if (this.canvas && !this.canvas.destroyed) {
      this.pool?.destroy();
      this.canvas.destroy({ children: true });
    }
    this.canvas = undefined;
    this.pool = undefined;
    this.changes = undefined;
  }
}
