import { Container, Text } from 'pixi.js';
import { measureLayer } from './display-area-info.ts';

/** Plain chart-authored text, shared by all play families. No HTML interpretation or pointer handling. */
export class ChartTextOverlay {
  private root: HTMLElement | undefined;
  private canvas: Container | undefined;
  private label: Text | undefined;

  attach(parent: HTMLElement): void {
    this.canvas?.removeFromParent();
    this.root ??= parent.ownerDocument.createElement('div');
    this.root.dataset.chartText = '';
    Object.assign(this.root.style, {
      position: 'absolute',
      pointerEvents: 'none',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      textAlign: 'center',
      color: 'white',
      background: '#000b',
      padding: '0.25em 0.5em',
      boxSizing: 'border-box',
      fontFamily: 'sans-serif',
      lineHeight: '1.3',
      overflow: 'hidden',
    });
    parent.append(this.root);
  }

  attachCanvas(parent: Container): void {
    this.root?.remove();
    if (this.canvas?.destroyed) {
      this.canvas = undefined;
      this.label = undefined;
    }
    this.canvas ??= new Container({ label: 'chart-text', eventMode: 'none' });
    this.label ??= new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fill: 'white',
        align: 'center',
        wordWrap: true,
        breakWords: true,
        stroke: { color: 'black', width: 3 },
      },
    });
    this.label.anchor.set(0.5, 0);
    if (this.label.parent !== this.canvas) this.canvas.addChild(this.label);
    if (this.canvas.parent !== parent) parent.addChild(this.canvas);
  }

  show(
    text: string,
    stage: { width: number; height: number },
    screen: { width: number; height: number },
    opacity = 1,
  ): void {
    const size = Math.max(12, Math.min(28, stage.height / 32));
    if (this.canvas?.parent && this.label) {
      this.canvas.visible = text.length > 0;
      this.label.text = text;
      if (text.length === 0) return;
      this.label.style.fontSize = size;
      this.label.style.wordWrapWidth = stage.width * 0.9;
      this.label.position.set(stage.width / 2, stage.height * 0.08);
      this.label.scale.set(1);
      if (this.label.height > stage.height * 0.3) this.label.scale.set((stage.height * 0.3) / this.label.height);
      return;
    }
    const root = this.root;
    if (!root) return;
    root.hidden = text.length === 0;
    if (root.textContent !== text) root.textContent = text;
    const { width, height } = measureLayer(root.parentElement ?? root, screen);
    const scale = Math.min(width / stage.width, height / stage.height);
    Object.assign(root.style, {
      left: `${(width - stage.width * scale) / 2 + stage.width * scale * 0.05}px`,
      top: `${(height - stage.height * scale) / 2 + stage.height * scale * 0.08}px`,
      width: `${stage.width * scale * 0.9}px`,
      maxHeight: `${stage.height * scale * 0.3}px`,
      fontSize: `${size * scale}px`,
      opacity: String(opacity),
    });
  }

  hide(): void {
    if (this.root) this.root.hidden = true;
    if (this.canvas) this.canvas.visible = false;
  }
  detach(): void {
    this.root?.remove();
    this.canvas?.removeFromParent();
  }
  dispose(): void {
    this.detach();
    if (this.canvas && !this.canvas.destroyed) this.canvas.destroy({ children: true });
    this.root = undefined;
    this.canvas = undefined;
    this.label = undefined;
  }
}
