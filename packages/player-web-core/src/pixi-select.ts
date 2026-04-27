import { Application, Color, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { BrowserSongCollection, BrowserSongEntry } from './types.ts';

const BG = new Color('#08090d');
const PANEL = new Color('#151923');
const ACTIVE = new Color('#ffd166');
const TEXT = new Color('#f8fafc');
const MUTED = new Color('#9aa6b2');
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

export interface PixiSongSelectViewOptions {
  onSongSelected?: (song: BrowserSongEntry) => void;
}

export class PixiSongSelectView {
  private readonly app = new Application();
  private readonly root = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  private readonly listLayer = new Container();
  private readonly title = new Text({
    text: 'Drop a BMS folder or ZIP',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 28,
      fontWeight: '700',
      fontFamily: 'Avenir Next, Helvetica, sans-serif',
    }),
  });
  private readonly hint = new Text({
    text: 'Select: Arrow keys / Enter',
    style: new TextStyle({ fill: MUTED, fontSize: 14, fontFamily: 'Avenir Next, Helvetica, sans-serif' }),
  });
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  private selectedIndex = 0;
  private mountedContainer: HTMLElement | undefined;

  public constructor(private readonly options: PixiSongSelectViewOptions = {}) {}

  public async mount(container: HTMLElement): Promise<void> {
    this.mountedContainer = container;
    await this.app.init({
      backgroundAlpha: 0,
      resizeTo: container,
      antialias: true,
      autoDensity: true,
      resolution: globalThis.devicePixelRatio || 1,
    });
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'be-music song select');
    this.app.stage.addChild(this.viewportBackground, this.root);
    this.root.addChild(this.background, this.title, this.hint, this.listLayer);
    container.appendChild(this.app.canvas);
    this.app.canvas.addEventListener('keydown', this.handleKeyDown);
    this.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.render();
  }

  public dispose(): void {
    this.app.canvas.removeEventListener('keydown', this.handleKeyDown);
    this.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.app.destroy(true, { children: true });
    this.mountedContainer = undefined;
  }

  public setCollection(collection: BrowserSongCollection): void {
    this.collection = collection;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, collection.songs.length - 1));
    this.render();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.app.canvas.focus();
    const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height);
    const virtualY = (event.offsetY - viewport.y) / viewport.scale;
    const row = Math.floor((virtualY - 104) / 52);
    if (row >= 0 && row < this.collection.songs.length) {
      this.selectedIndex = row;
      this.render();
      this.options.onSongSelected?.(this.collection.songs[row]!);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = Math.min(this.collection.songs.length - 1, this.selectedIndex + 1);
      this.render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const song = this.collection.songs[this.selectedIndex];
      if (song) {
        this.options.onSongSelected?.(song);
      }
    }
  };

  private render(): void {
    const screenWidth = this.app.screen.width || this.mountedContainer?.clientWidth || DESIGN_WIDTH;
    const screenHeight = this.app.screen.height || this.mountedContainer?.clientHeight || DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(screenWidth, screenHeight);
    this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    this.background.clear().rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill(BG);
    this.title.position.set(32, 28);
    this.title.text = this.collection.songs.length > 0 ? 'Song Select' : 'Drop a BMS folder or ZIP';
    this.hint.position.set(34, 66);
    this.hint.text =
      `${this.collection.songs.length} charts loaded` +
      (this.collection.errors.length > 0 ? ` / ${this.collection.errors.length} errors` : '') +
      '  |  Select: Arrow keys / Enter';

    this.listLayer.removeChildren().forEach((child) => child.destroy());
    const visibleRows = Math.max(1, Math.floor((DESIGN_HEIGHT - 120) / 52));
    const start = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(visibleRows / 2),
        Math.max(0, this.collection.songs.length - visibleRows),
      ),
    );
    for (let visibleIndex = 0; visibleIndex < visibleRows; visibleIndex += 1) {
      const songIndex = start + visibleIndex;
      const song = this.collection.songs[songIndex];
      if (!song) {
        break;
      }
      this.drawSongRow(song, songIndex, visibleIndex, DESIGN_WIDTH);
    }
  }

  private drawSongRow(song: BrowserSongEntry, songIndex: number, visibleIndex: number, width: number): void {
    const y = 104 + visibleIndex * 52;
    const row = new Graphics();
    const active = songIndex === this.selectedIndex;
    row
      .roundRect(28, y, Math.max(0, width - 56), 44, 8)
      .fill({ color: active ? ACTIVE : PANEL, alpha: active ? 0.95 : 0.72 });
    this.listLayer.addChild(row);

    const title = new Text({
      text: song.title,
      style: new TextStyle({
        fill: active ? 0x111318 : TEXT,
        fontSize: 18,
        fontWeight: '700',
        fontFamily: 'Avenir Next, Helvetica, sans-serif',
      }),
    });
    title.position.set(44, y + 6);
    this.listLayer.addChild(title);

    const meta = new Text({
      text: [
        song.artist,
        song.playLevel !== undefined ? `Lv ${song.playLevel}` : undefined,
        song.bpm ? `BPM ${song.bpm}` : undefined,
        song.fileLabel,
      ]
        .filter(Boolean)
        .join('  /  '),
      style: new TextStyle({
        fill: active ? 0x34302a : MUTED,
        fontSize: 12,
        fontFamily: 'Avenir Next, Helvetica, sans-serif',
      }),
    });
    meta.position.set(44, y + 28);
    this.listLayer.addChild(meta);
  }
}

function resolveScaledViewport(screenWidth: number, screenHeight: number): { x: number; y: number; scale: number } {
  const scale = Math.min(screenWidth / DESIGN_WIDTH, screenHeight / DESIGN_HEIGHT);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: (screenWidth - DESIGN_WIDTH * safeScale) / 2,
    y: (screenHeight - DESIGN_HEIGHT * safeScale) / 2,
    scale: safeScale,
  };
}
