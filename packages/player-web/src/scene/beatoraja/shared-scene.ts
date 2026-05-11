import { BEATORAJA_TEXT, type BeatorajaSkin } from '@be-music/beatoraja-skin';
import { Container, Graphics, type Texture } from 'pixi.js';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { extractChartSubartist } from '../../chart/beatoraja/meta.ts';
import type { PixiSceneHost } from '../host.ts';

export interface BeatorajaChartImages {
  stageFile?: Texture;
  backBmp?: Texture;
  banner?: Texture;
}

export interface BeatorajaStageFitState {
  width: number;
  height: number;
}

interface BeatorajaStageView {
  readonly width: number;
  readonly height: number;
  readonly container: Container;
}

export function resolveBeatorajaChartImage(
  images: BeatorajaChartImages | undefined,
  syntheticId: number,
): Texture | undefined {
  if (images === undefined) return undefined;
  switch (syntheticId) {
    case -100:
      return images.stageFile;
    case -101:
      return images.backBmp;
    case -102:
      return images.banner;
    default:
      return undefined;
  }
}

export function resolveBeatorajaSongText(
  refOp: number,
  options: {
    song?: BrowserSongEntry;
    skin: BeatorajaSkin;
    tableTextFallback?: string;
  },
): string | undefined {
  const { song, skin } = options;
  switch (refOp) {
    case BEATORAJA_TEXT.TITLE:
      return song?.title ?? '';
    case BEATORAJA_TEXT.SUBTITLE:
      return song?.subtitle ?? '';
    case BEATORAJA_TEXT.FULLTITLE:
      return joinNonEmpty(song?.title, song?.subtitle);
    case BEATORAJA_TEXT.GENRE:
      return song?.genre ?? '';
    case BEATORAJA_TEXT.ARTIST:
      return song?.artist ?? '';
    case BEATORAJA_TEXT.SUBARTIST:
      return extractChartSubartist(song?.chart);
    case BEATORAJA_TEXT.FULLARTIST:
      return joinNonEmpty(song?.artist, extractChartSubartist(song?.chart));
    case BEATORAJA_TEXT.SKIN_NAME:
      return skin.name ?? '';
    case BEATORAJA_TEXT.SKIN_AUTHOR:
      return skin.author ?? '';
    case BEATORAJA_TEXT.DIRECTORY:
      return song?.directoryLabel ?? '';
    case BEATORAJA_TEXT.TABLE_NAME:
    case BEATORAJA_TEXT.TABLE_LEVEL:
    case BEATORAJA_TEXT.TABLE_FULL:
      return options.tableTextFallback;
    default:
      return undefined;
  }
}

export function fitBeatorajaViewToStage(
  host: PixiSceneHost | undefined,
  view: BeatorajaStageView,
  backdrop: Graphics,
  previous: BeatorajaStageFitState,
): BeatorajaStageFitState | undefined {
  if (!host) return undefined;
  const { width, height } = host.app.screen;
  if (width === previous.width && height === previous.height) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  const scale = Math.min(width / view.width, height / view.height);
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const c = view.container;
  c.scale.set(scale, scale);
  c.x = (width - view.width * scale) / 2;
  c.y = (height - view.height * scale) / 2;
  backdrop.clear().rect(0, 0, width, height).fill(0x000000);
  return { width, height };
}

export class BeatorajaSceneBgmPlayer {
  private audioContext: AudioContext | undefined;
  private bgmSource: AudioBufferSourceNode | undefined;

  constructor(
    private readonly logLabel: string,
    private readonly isDisposed: () => boolean,
  ) {}

  async start(bytes: Uint8Array | undefined): Promise<void> {
    if (bytes === undefined) return;
    if (typeof globalThis === 'undefined' || typeof globalThis.AudioContext === 'undefined') return;
    try {
      if (this.audioContext === undefined) {
        this.audioContext = new globalThis.AudioContext();
      }
      const ctx = this.audioContext;
      void ctx.resume().catch(() => undefined);
      const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
      if (this.isDisposed()) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      this.bgmSource = source;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[${this.logLabel}] bgm playback failed`, error);
    }
  }

  stop(): void {
    if (this.bgmSource !== undefined) {
      try {
        this.bgmSource.stop();
      } catch {
        /* already stopped */
      }
      this.bgmSource.disconnect();
      this.bgmSource = undefined;
    }
    if (this.audioContext !== undefined) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = undefined;
    }
  }
}

function joinNonEmpty(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
