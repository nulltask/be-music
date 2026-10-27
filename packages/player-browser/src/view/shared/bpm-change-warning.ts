import { Container, Graphics, Text } from 'pixi.js';
import type { TimingResolver } from '@be-music/chart-model';
import type { PlaySide } from '@be-music/player-scene-model';
import { measureLayer, type DisplayAreaLane } from './display-area-info.ts';

/**
 * AC 34's BPM-change warning (#746). The official introduction draws `<current> » <next>` in a framed box centred on the
 * lanes just above the judgment and combo, blue when the tempo rises and red when it falls. Play footage shows it from
 * 2 s before each BPM change until the change. The TYPE A–D variants of the source are not known yet; this is the style
 * the introduction shows.
 */
export const BPM_CHANGE_WARNING_LEAD_SECONDS = 2;
/** How long the warning takes to fade in. */
const FADE_SECONDS = 0.1;
const RISING_COLOR = 0x4aa8ff;
const FALLING_COLOR = 0xff5a5a;

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

/** The warning at chart time `nowSeconds`: the next change, while it is at most `leadSeconds` away. */
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
  if (next === undefined || next.seconds - nowSeconds > leadSeconds) return undefined;
  return {
    from: next.from,
    to: next.to,
    rising: next.to > next.from,
    elapsedSeconds: nowSeconds - (next.seconds - leadSeconds),
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
 */
export function resolveBPMChangeWarningPlacements(lanes: readonly DisplayAreaLane[]): BPMChangeWarningPlacement[] {
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
      y: top + (bottom - top) * 0.5,
      size: Math.max(10, Math.min(28, (right - left) / 20)),
    });
  }
  return result;
}

/** How far into its fade the warning is, 0 to 1. */
function fadeProgress(warning: BPMChangeWarning): number {
  return Math.min(1, Math.max(0, warning.elapsedSeconds / FADE_SECONDS));
}

/** A pointer-transparent warning layer, shared by Canvas and DOM skins and removed with its play view. */
export class BPMChangeWarningOverlay {
  private root: HTMLElement | undefined;
  private canvas: Container | undefined;
  private canvasBoxes: { box: Graphics; text: Text }[] = [];
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
  }): void {
    let warning: BPMChangeWarning | undefined;
    if (input.enabled && input.timing) {
      if (this.changes?.timing !== input.timing)
        this.changes = { timing: input.timing, changes: collectBPMChanges(input.timing) };
      warning = resolveBPMChangeWarning(this.changes.changes, input.seconds);
    }
    this.update(warning, input.lanes, input.stage, input.screen, input.opacity);
  }

  attachCanvas(parent: Container): void {
    this.root?.remove();
    if (this.canvas?.destroyed) {
      this.canvas = undefined;
      this.canvasBoxes = [];
    }
    this.canvas ??= new Container({ label: 'bpm-change-warning', eventMode: 'none' });
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
  ): void {
    const placements = warning === undefined ? [] : resolveBPMChangeWarningPlacements(lanes);
    const text = warning === undefined ? '' : formatBPMChangeWarning(warning);
    if (this.canvas?.parent) {
      this.updateCanvas(warning, text, placements);
      return;
    }
    const root = this.root;
    if (!root) return;
    root.hidden = placements.length === 0;
    root.style.opacity = String(opacity * (warning === undefined ? 1 : fadeProgress(warning)));
    const { width, height } = measureLayer(root, screen);
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
          fontWeight: 'bold',
          fontFamily: 'monospace',
          lineHeight: '1.2',
          background: '#000a',
          borderStyle: 'solid',
          borderRadius: '3px',
          transform: 'translate(-50%, -50%)',
        });
        root.append(node);
        this.nodes[index] = node;
      }
      const color = warning!.rising ? '#4aa8ff' : '#ff5a5a';
      const size = placement.size * scale;
      node.hidden = false;
      node.dataset.side = placement.side;
      node.dataset.direction = warning!.rising ? 'rising' : 'falling';
      if (node.textContent !== text) node.textContent = text;
      node.style.fontSize = `${size}px`;
      node.style.color = color;
      node.style.borderColor = color;
      node.style.borderWidth = `${Math.max(1, size / 8)}px`;
      node.style.padding = `${size * 0.1}px ${size * 0.6}px`;
      node.style.left = `${offsetX + placement.x * scale}px`;
      node.style.top = `${offsetY + placement.y * scale}px`;
    });
    for (let index = placements.length; index < this.nodes.length; index++) this.nodes[index]!.hidden = true;
  }

  private updateCanvas(
    warning: BPMChangeWarning | undefined,
    text: string,
    placements: readonly BPMChangeWarningPlacement[],
  ): void {
    const canvas = this.canvas!;
    canvas.visible = placements.length > 0;
    canvas.alpha = warning === undefined ? 1 : fadeProgress(warning);
    placements.forEach((placement, index) => {
      let nodes = this.canvasBoxes[index];
      if (!nodes) {
        const box = new Graphics();
        const label = new Text({ text: '', style: { fontFamily: 'monospace', fontWeight: 'bold' } });
        label.anchor.set(0.5);
        canvas.addChild(box, label);
        nodes = { box, text: label };
        this.canvasBoxes[index] = nodes;
      }
      const color = warning!.rising ? RISING_COLOR : FALLING_COLOR;
      nodes.text.visible = nodes.box.visible = true;
      nodes.text.label = `bpm-change-warning:${placement.side}`;
      nodes.text.text = text;
      nodes.text.style.fontSize = placement.size;
      nodes.text.style.fill = color;
      nodes.text.position.set(placement.x, placement.y);
      const width = nodes.text.width + placement.size * 1.2;
      const height = nodes.text.height + placement.size * 0.2;
      nodes.box
        .clear()
        .roundRect(placement.x - width / 2, placement.y - height / 2, width, height, placement.size * 0.15)
        .fill({ color: 0x000000, alpha: 0.65 })
        .stroke({ color, width: Math.max(1, placement.size / 8) });
    });
    for (let index = placements.length; index < this.canvasBoxes.length; index++) {
      this.canvasBoxes[index]!.text.visible = this.canvasBoxes[index]!.box.visible = false;
    }
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
    if (this.canvas && !this.canvas.destroyed) this.canvas.destroy({ children: true });
    this.canvas = undefined;
    this.canvasBoxes = [];
    this.changes = undefined;
  }
}
