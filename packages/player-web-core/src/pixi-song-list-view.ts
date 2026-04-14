import { Application, Color, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { BrowserSongCollection, BrowserSongEntry } from './types.ts';

const BACKGROUND_COLOR = new Color('#07111f');
const PANEL_COLOR = new Color('#0d1b2a');
const PANEL_EDGE_COLOR = new Color('#16314b');
const HIGHLIGHT_COLOR = new Color('#1f4e79');
const TEXT_PRIMARY_COLOR = new Color('#f3f7ff');
const TEXT_SECONDARY_COLOR = new Color('#8ba3bb');
const TEXT_ACCENT_COLOR = new Color('#7dd3fc');
const HEADER_HEIGHT = 92;
const FOOTER_HEIGHT = 34;
const ROW_HEIGHT = 64;
const ROW_GAP = 8;
const PADDING = 24;

export interface PixiSongListViewOptions {
  onSongSelect?: (song: BrowserSongEntry) => void;
  onSongActivate?: (song: BrowserSongEntry) => void;
}

export class PixiSongListView {
  private readonly app = new Application();
  private readonly root = new Container();
  private readonly background = new Graphics();
  private readonly panel = new Graphics();
  private readonly headerText = new Text({
    text: 'be-music web player',
    style: new TextStyle({
      fill: TEXT_PRIMARY_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 26,
      fontWeight: '600',
    }),
  });
  private readonly statusText = new Text({
    text: 'Drop a local folder or ZIP archive to browse charts.',
    style: new TextStyle({
      fill: TEXT_SECONDARY_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 14,
    }),
  });
  private readonly footerText = new Text({
    text: '',
    style: new TextStyle({
      fill: TEXT_SECONDARY_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 13,
    }),
  });
  private readonly rows = new Container();
  private readonly emptyText = new Text({
    text: 'No charts loaded yet.\nDrop a folder or ZIP archive here.',
    style: new TextStyle({
      align: 'center',
      fill: TEXT_SECONDARY_COLOR,
      fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
      fontSize: 20,
      lineHeight: 32,
    }),
  });
  private readonly options: PixiSongListViewOptions;
  private mountedContainer: HTMLElement | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  private selectedSongId: string | undefined;
  private scrollOffset = 0;

  public constructor(options: PixiSongListViewOptions = {}) {
    this.options = options;
  }

  public async mount(container: HTMLElement): Promise<void> {
    if (this.mountedContainer === container) {
      return;
    }
    await this.app.init({
      antialias: true,
      backgroundAlpha: 0,
      eventMode: 'static',
      resizeTo: container,
    });
    this.mountedContainer = container;
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'be-music song browser');
    container.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);
    this.root.addChild(this.background, this.panel, this.headerText, this.statusText, this.rows, this.emptyText, this.footerText);
    this.app.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.app.canvas.addEventListener('keydown', this.handleKeyDown);
    this.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(container);
    this.render();
  }

  public setCollection(collection: BrowserSongCollection): void {
    this.collection = collection;
    if (!this.selectedSongId || !collection.songs.some((song) => song.id === this.selectedSongId)) {
      this.selectedSongId = collection.songs[0]?.id;
    }
    this.scrollOffset = 0;
    this.render();
  }

  public setStatus(text: string): void {
    this.statusText.text = text;
    this.render();
  }

  public setSelectedSong(songId: string | undefined): void {
    this.selectedSongId = songId;
    this.render();
  }

  public focus(): void {
    this.app.canvas.focus();
  }

  public dispose(): void {
    this.app.canvas.removeEventListener('wheel', this.handleWheel);
    this.app.canvas.removeEventListener('keydown', this.handleKeyDown);
    this.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.app.destroy(true, { children: true });
    this.mountedContainer = undefined;
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.collection.songs.length === 0) {
      return;
    }
    event.preventDefault();
    const visibleHeight = this.getViewportHeight();
    const totalHeight = this.collection.songs.length * (ROW_HEIGHT + ROW_GAP);
    const maxOffset = Math.max(0, totalHeight - visibleHeight);
    this.scrollOffset = clamp(this.scrollOffset + event.deltaY, 0, maxOffset);
    this.render();
  };

  private readonly handlePointerDown = (): void => {
    this.app.canvas.focus();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.collection.songs.length === 0) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
      case 'j':
      case 'J':
        event.preventDefault();
        this.moveSelectionBy(1);
        return;
      case 'ArrowUp':
      case 'k':
      case 'K':
        event.preventDefault();
        this.moveSelectionBy(-1);
        return;
      case 'PageDown':
        event.preventDefault();
        this.moveSelectionBy(this.getPageStep());
        return;
      case 'PageUp':
        event.preventDefault();
        this.moveSelectionBy(-this.getPageStep());
        return;
      case 'Home':
        event.preventDefault();
        this.selectSongAtIndex(0);
        return;
      case 'End':
        event.preventDefault();
        this.selectSongAtIndex(this.collection.songs.length - 1);
        return;
      case 'Enter':
        event.preventDefault();
        this.activateSelectedSong();
        return;
      default:
        return;
    }
  };

  private render(): void {
    const width = this.app.screen.width;
    const height = this.app.screen.height;

    this.background.clear().rect(0, 0, width, height).fill(BACKGROUND_COLOR);
    this.panel
      .clear()
      .roundRect(PADDING, PADDING, Math.max(0, width - PADDING * 2), Math.max(0, height - PADDING * 2), 20)
      .fill(PANEL_COLOR)
      .stroke({ color: PANEL_EDGE_COLOR, width: 1.5 });

    this.headerText.position.set(PADDING * 2, PADDING * 2);
    this.statusText.position.set(PADDING * 2, PADDING * 2 + 38);

    this.footerText.text = this.buildFooterText();
    this.footerText.position.set(PADDING * 2, height - FOOTER_HEIGHT - 4);

    const viewportTop = PADDING * 2 + HEADER_HEIGHT;
    const viewportHeight = this.getViewportHeight();
    const panelWidth = Math.max(0, width - PADDING * 4);

    this.rows.removeChildren();

    if (this.collection.songs.length === 0) {
      this.emptyText.visible = true;
      this.emptyText.anchor.set(0.5);
      this.emptyText.position.set(width / 2, height / 2);
      return;
    }
    this.emptyText.visible = false;

    for (let index = 0; index < this.collection.songs.length; index += 1) {
      const song = this.collection.songs[index]!;
      const y = viewportTop + index * (ROW_HEIGHT + ROW_GAP) - this.scrollOffset;
      if (y + ROW_HEIGHT < viewportTop - ROW_HEIGHT || y > viewportTop + viewportHeight) {
        continue;
      }
      const row = this.createRow(song, panelWidth);
      row.position.set(PADDING * 2, y);
      this.rows.addChild(row);
    }
  }

  private createRow(song: BrowserSongEntry, width: number): Container {
    const isSelected = song.id === this.selectedSongId;
    const row = new Container();
    row.eventMode = 'static';
    row.cursor = 'pointer';

    const background = new Graphics()
      .roundRect(0, 0, width, ROW_HEIGHT, 14)
      .fill(isSelected ? HIGHLIGHT_COLOR : 0x10253a)
      .stroke({ color: isSelected ? TEXT_ACCENT_COLOR : PANEL_EDGE_COLOR, width: isSelected ? 2 : 1 });

    const title = new Text({
      text: song.subtitle ? `${song.title}  ${song.subtitle}` : song.title,
      style: new TextStyle({
        fill: TEXT_PRIMARY_COLOR,
        fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
        fontSize: 20,
        fontWeight: isSelected ? '600' : '500',
      }),
    });
    title.position.set(16, 10);

    const metaText = compactMeta([
      song.artist,
      song.genre,
      typeof song.playLevel === 'number' || typeof song.playLevel === 'string' ? `LEVEL ${song.playLevel}` : undefined,
      typeof song.bpm === 'number' ? `BPM ${formatBpm(song.bpm)}` : undefined,
    ]);
    const meta = new Text({
      text: metaText,
      style: new TextStyle({
        fill: TEXT_SECONDARY_COLOR,
        fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
        fontSize: 13,
      }),
    });
    meta.position.set(16, 38);

    const path = new Text({
      text: `${song.sourceLabel} / ${song.directoryLabel === '.' ? song.fileLabel : `${song.directoryLabel}/${song.fileLabel}`}`,
      style: new TextStyle({
        fill: TEXT_ACCENT_COLOR,
        fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
        fontSize: 12,
      }),
    });
    path.anchor.set(1, 0);
    path.position.set(width - 16, 14);

    row.addChild(background, title, meta, path);
    row.on('pointertap', () => {
      this.app.canvas.focus();
      this.selectSong(song);
    });
    return row;
  }

  private buildFooterText(): string {
    const errorCount = this.collection.errors.length;
    const sourceCount = this.collection.sources.length;
    const songCount = this.collection.songs.length;
    return `${songCount} charts from ${sourceCount} source${sourceCount === 1 ? '' : 's'}${errorCount === 0 ? '' : ` • ${errorCount} parse issue${errorCount === 1 ? '' : 's'}`} • ↑/↓ move • Enter start`;
  }

  private getViewportHeight(): number {
    return Math.max(0, this.app.screen.height - HEADER_HEIGHT - FOOTER_HEIGHT - PADDING * 4);
  }

  private moveSelectionBy(delta: number): void {
    if (this.collection.songs.length === 0) {
      return;
    }
    const selectedIndex = this.findSelectedSongIndex();
    const nextIndex = clamp(selectedIndex + delta, 0, this.collection.songs.length - 1);
    this.selectSongAtIndex(nextIndex);
  }

  private selectSongAtIndex(index: number): void {
    const song = this.collection.songs[index];
    if (!song) {
      return;
    }
    this.selectSong(song);
    this.ensureSongVisible(index);
    this.render();
  }

  private selectSong(song: BrowserSongEntry): void {
    this.selectedSongId = song.id;
    this.options.onSongSelect?.(song);
  }

  private activateSelectedSong(): void {
    const song = this.collection.songs[this.findSelectedSongIndex()];
    if (!song) {
      return;
    }
    this.options.onSongActivate?.(song);
  }

  private findSelectedSongIndex(): number {
    if (!this.selectedSongId) {
      return 0;
    }
    const index = this.collection.songs.findIndex((song) => song.id === this.selectedSongId);
    return index >= 0 ? index : 0;
  }

  private ensureSongVisible(index: number): void {
    const viewportTop = this.scrollOffset;
    const viewportBottom = viewportTop + this.getViewportHeight();
    const rowTop = index * (ROW_HEIGHT + ROW_GAP);
    const rowBottom = rowTop + ROW_HEIGHT;

    if (rowTop < viewportTop) {
      this.scrollOffset = rowTop;
      return;
    }
    if (rowBottom > viewportBottom) {
      this.scrollOffset = rowBottom - this.getViewportHeight();
    }
  }

  private getPageStep(): number {
    return Math.max(1, Math.floor(this.getViewportHeight() / (ROW_HEIGHT + ROW_GAP)));
  }
}

function compactMeta(parts: Array<string | undefined>): string {
  return parts.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' • ');
}

function formatBpm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

function clamp(value: number, min: number, max: number): number {
  return value <= min ? min : value >= max ? max : value;
}
