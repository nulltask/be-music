/**
 * What the beatoraja decide and result screens share: fitting the skin's canvas into the window, and the song and skin
 * texts and timing fields they read off the skin.
 */

import { BEATORAJA_TEXT, type BeatorajaSkin } from '@be-music/beatoraja-skin';
import {
  resolveBeatorajaSkinText,
  resolveBeatorajaSongText as resolveBeatorajaSongTextOf,
  type BeatorajaSongTextInput,
} from '@be-music/beatoraja-skin/scene';
import type { Container, Graphics } from 'pixi.js';
import { extractChartSubartist } from '../../chart/beatoraja/meta.ts';
import type { BrowserSongEntry } from '../../collection/types.ts';
import type { PixiSceneHost } from '../../scene/host.ts';

export interface BeatorajaStageFitState {
  width: number;
  height: number;
}

interface BeatorajaStageView {
  readonly width: number;
  readonly height: number;
  readonly container: Container;
}

const SONG_TEXTS = new WeakMap<BrowserSongEntry, BeatorajaSongTextInput>();

/** What a beatoraja skin's song texts read of a library chart (its sub-artist read off the chart once). */
export function beatorajaSongTextOf(song: BrowserSongEntry | undefined): BeatorajaSongTextInput | undefined {
  if (song === undefined) return undefined;
  let text = SONG_TEXTS.get(song);
  if (text === undefined) {
    text = {
      title: song.title,
      subtitle: song.subtitle,
      genre: song.genre,
      artist: song.artist,
      subartist: extractChartSubartist(song.chart),
      directory: song.directoryLabel,
    };
    SONG_TEXTS.set(song, text);
  }
  return text;
}

/**
 * The song and skin texts of the decide and result screens (`@be-music/beatoraja-skin/scene`); the difficulty-table
 * texts read `tableTextFallback`.
 */
export function resolveBeatorajaSongText(
  refOp: number,
  options: {
    song?: BrowserSongEntry;
    skin: BeatorajaSkin;
    tableTextFallback?: string;
  },
): string | undefined {
  switch (refOp) {
    case BEATORAJA_TEXT.TABLE_NAME:
    case BEATORAJA_TEXT.TABLE_LEVEL:
    case BEATORAJA_TEXT.TABLE_FULL:
      return options.tableTextFallback;
  }
  return (
    resolveBeatorajaSongTextOf(refOp, beatorajaSongTextOf(options.song)) ??
    resolveBeatorajaSkinText(refOp, options.skin)
  );
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

export function resolveBeatorajaSkinTimingMs(
  value: number | undefined,
  fallbackMs: number,
  options: { min?: number } = {},
): number {
  const min = options.min ?? Number.NEGATIVE_INFINITY;
  if (typeof value === 'number' && Number.isFinite(value) && value >= min) {
    return value;
  }
  return fallbackMs;
}
