import { Container, Text } from 'pixi.js';
import { resolveGreenNumber, type PlaySide } from '@be-music/player-scene-model';
import type { BeMusicLaneCover } from '@be-music/player-skin-sdk';

export interface DisplayAreaLane {
  readonly side: PlaySide;
  readonly x: number;
  readonly w: number;
  readonly top: number;
  readonly bottom: number;
  readonly baseBottom?: number;
}
export interface DisplayAreaLabel {
  readonly side: PlaySide;
  readonly edge: 'sudden' | 'hidden' | 'lift';
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly green: number | undefined;
}

/** AC 34's always-visible readouts: the cover length (0..1000) and green number on each selected cover edge. */
export function resolveDisplayAreaLabels(input: {
  mode: 'OFF' | 'ON' | 'SUDDEN_ONLY' | 'HIDDEN_LIFT_ONLY';
  lanes: readonly DisplayAreaLane[];
  covers: readonly BeMusicLaneCover[];
  visibleMs: (cover: BeMusicLaneCover) => number | undefined;
}): DisplayAreaLabel[] {
  if (input.mode === 'OFF') return [];
  const result: DisplayAreaLabel[] = [];
  for (const cover of input.covers) {
    const lanes = input.lanes.filter((lane) => lane.side === cover.side && lane.w > 0 && lane.bottom > lane.top);
    if (lanes.length === 0) continue;
    const left = Math.min(...lanes.map((lane) => lane.x));
    const right = Math.max(...lanes.map((lane) => lane.x + lane.w));
    const top = Math.min(...lanes.map((lane) => lane.top));
    const bottom = Math.max(...lanes.map((lane) => lane.baseBottom ?? lane.bottom));
    const visible = input.visibleMs(cover);
    const green = visible === undefined ? undefined : resolveGreenNumber(visible);
    const add = (edge: DisplayAreaLabel['edge'], fraction: number, y: number) => {
      if (!(fraction > 0)) return;
      result.push({ side: cover.side, edge, x: (left + right) / 2, y, length: Math.round(fraction * 1000), green });
    };
    if (input.mode !== 'HIDDEN_LIFT_ONLY') add('sudden', cover.sudden, top + (bottom - top) * cover.sudden);
    if (input.mode !== 'SUDDEN_ONLY') {
      if (cover.lift > 0) add('lift', cover.lift, Math.max(...lanes.map((lane) => lane.bottom)));
      else add('hidden', cover.hidden, bottom - (bottom - top) * (cover.lift + cover.hidden));
    }
  }
  return result;
}

/**
 * The size of a DOM overlay layer in CSS pixels, which its labels are placed in: the layer's own box, or `fallback`
 * before it is laid out. The renderer's screen is not it: it is in the renderer's own units and keeps whatever size it
 * last resized to while a DOM skin shows.
 */
export function measureLayer(
  layer: HTMLElement,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  return layer.clientWidth > 0 && layer.clientHeight > 0
    ? { width: layer.clientWidth, height: layer.clientHeight }
    : { width: fallback.width, height: fallback.height };
}

/** A pointer-transparent readout layer, shared by Canvas and DOM skins and removed with its play view. */
export class DisplayAreaInfoOverlay {
  private root: HTMLElement | undefined;
  private canvas: Container | undefined;
  private canvasLabels: { length: Text; green: Text }[] = [];
  private nodes: HTMLElement[] = [];

  attachCanvas(parent: Container): void {
    this.root?.remove();
    if (this.canvas?.destroyed) {
      this.canvas = undefined;
      this.canvasLabels = [];
    }
    this.canvas ??= new Container({ label: 'display-area-info', eventMode: 'none' });
    if (this.canvas.parent !== parent) parent.addChild(this.canvas);
  }

  attach(parent: HTMLElement): void {
    this.canvas?.removeFromParent();
    this.root ??= parent.ownerDocument.createElement('div');
    this.root.dataset.displayAreaInfo = '';
    this.root.setAttribute('aria-hidden', 'true');
    Object.assign(this.root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    parent.append(this.root);
  }

  update(
    labels: readonly DisplayAreaLabel[],
    stage: { width: number; height: number },
    screen: { width: number; height: number },
    opacity = 1,
  ): void {
    if (this.canvas?.parent) {
      this.updateCanvas(labels, stage.height);
      return;
    }
    const root = this.root;
    if (!root) return;
    root.hidden = labels.length === 0;
    root.style.opacity = String(opacity);
    const { width, height } = measureLayer(root, screen);
    const scale = Math.min(width / stage.width, height / stage.height);
    const offsetX = (width - stage.width * scale) / 2;
    const offsetY = (height - stage.height * scale) / 2;
    labels.forEach((label, index) => {
      let node = this.nodes[index];
      if (!node) {
        node = root.ownerDocument.createElement('div');
        Object.assign(node.style, {
          position: 'absolute',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          font: 'bold 12px monospace',
          lineHeight: '1.2',
          color: '#eee',
          textShadow: '0 1px 2px #000, 0 0 3px #000',
          padding: '2px 5px',
          background: '#0009',
          borderRadius: '2px',
        });
        const length = root.ownerDocument.createElement('div');
        const green = root.ownerDocument.createElement('div');
        green.style.color = '#80ff55';
        node.append(length, green);
        root.append(node);
        this.nodes[index] = node;
      }
      node.hidden = false;
      node.dataset.side = label.side;
      node.dataset.edge = label.edge;
      const name = label.edge === 'sudden' ? 'SUD-LENGTH' : label.edge === 'hidden' ? 'HID-LENGTH' : 'LIFT-LENGTH';
      const text = `${name} ${label.length}`;
      if (node.children[0]!.textContent !== text) node.children[0]!.textContent = text;
      const green = String(label.green ?? '—');
      if (node.children[1]!.textContent !== green) node.children[1]!.textContent = green;
      node.style.whiteSpace = 'pre';
      node.style.left = `${offsetX + label.x * scale}px`;
      node.style.top = `${offsetY + label.y * scale}px`;
      node.style.transform = label.edge === 'sudden' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
    });
    for (let index = labels.length; index < this.nodes.length; index++) this.nodes[index]!.hidden = true;
  }

  private updateCanvas(labels: readonly DisplayAreaLabel[], stageHeight: number): void {
    const canvas = this.canvas!;
    const size = Math.max(12, Math.min(28, stageHeight / 40));
    canvas.visible = labels.length > 0;
    labels.forEach((label, index) => {
      let nodes = this.canvasLabels[index];
      if (!nodes) {
        const style = {
          fontFamily: 'monospace',
          fontSize: size,
          fontWeight: 'bold' as const,
          fill: 0xeeeeee,
          stroke: { color: 0x000000, width: 3 },
        };
        const length = new Text({ text: '', style });
        const green = new Text({ text: '', style: { ...style, fill: 0x80ff55 } });
        length.anchor.set(0.5, 0);
        green.anchor.set(0.5, 0);
        nodes = { length, green };
        canvas.addChild(length, green);
        this.canvasLabels[index] = nodes;
      }
      const name = label.edge === 'sudden' ? 'SUD-LENGTH' : label.edge === 'hidden' ? 'HID-LENGTH' : 'LIFT-LENGTH';
      nodes.length.visible = nodes.green.visible = true;
      nodes.length.style.fontSize = nodes.green.style.fontSize = size;
      nodes.length.text = `${name} ${label.length}`;
      nodes.green.text = String(label.green ?? '—');
      const y = label.y + (label.edge === 'sudden' ? -size * 2.5 : 2);
      nodes.length.position.set(label.x, y);
      nodes.green.position.set(label.x, y + size * 1.2);
    });
    for (let index = labels.length; index < this.canvasLabels.length; index++) {
      this.canvasLabels[index]!.length.visible = this.canvasLabels[index]!.green.visible = false;
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
    this.canvasLabels = [];
  }
}
