/**
 * The measure lines of the shared playfield: the chart's bar lines from the playhead, drawn by the theme, by the
 * be-music skin, or as a thin bar across each run of adjacent lanes.
 */

import { resolveChart } from '@be-music/chart';
import { findFirstIndexNumberAtOrAfter } from '@be-music/utils/core';
import {
  isDrawnAtTime,
  resolveDrawBottom,
  resolveDrawY,
  type NoteDrawWindow,
} from '../../../scene/core/note-draw-window.ts';
import type { PlayfieldContext } from './context.ts';
import { resolveSideLaneRuns, type SideLaneRun } from './measure-line-runs.ts';

function resolveMeasureBeats(this: PlayfieldContext): number[] {
  const song = this.song;
  if (!song) {
    return [];
  }
  if (this.measureBeatCache.songId === song.id) {
    return this.measureBeatCache.beats;
  }
  // The resolved chart's bar lines: one per measure start up to the last measure, using the chosen `#RANDOM` branch's
  // `#xxx02` lengths, and none when a bmson chart opts out with `lines: []`.
  const beats = [...(this.resolvedPlayChart ?? resolveChart(song.chart)).barLines];
  this.measureBeatCache = { songId: song.id, beats };
  return beats;
}

/**
 * Draws horizontal measure lines on the playfield at every `#MEASURE` boundary. A theme may draw its own
 * ({@link renderThemeMeasureLines}; the LR2 family uses `#SRC_LINE` / `#DST_LINE`); otherwise we fall back to a thin
 * bar across each run of adjacent lanes, so double play's banks get one each and the gap between them stays clear.
 */
export function renderMeasureLines(this: PlayfieldContext, drawWindow: NoteDrawWindow, pixelsPerBeat: number): void {
  const { currentBeat } = drawWindow;
  const beats = resolveMeasureBeats.call(this);
  if (beats.length === 0 || this.laneChannels.length === 0) {
    return;
  }
  const firstChannel = this.laneChannels[0]!;
  const lastChannel = this.laneChannels[this.laneChannels.length - 1]!;
  const left = this.laneX.get(firstChannel);
  const right = this.laneX.get(lastChannel);
  if (!left || !right) {
    return;
  }
  const top = left.top;
  const bottom = left.bottom;
  let firstBeatIndex: number;
  if (drawWindow.rules === 'beatoraja') {
    // A bar line is a timeline like any other: gone once its time has come (a STOP on it included).
    firstBeatIndex = findFirstIndexNumberAtOrAfter(beats, currentBeat);
    const timing = this.timingResolver;
    while (
      timing &&
      firstBeatIndex < beats.length &&
      !isDrawnAtTime(drawWindow, timing.beatToSeconds(beats[firstBeatIndex]!))
    ) {
      firstBeatIndex += 1;
    }
  } else {
    // LR2 drops a bar line once the playhead has passed it (`DrawNotes` 0x40703d-0x40705b), so one under a STOP that
    // began on it stays on the judgement line for the STOP. A pixel of slack keeps the line just crossed for a frame,
    // as LR2 draws it once more on the line before dropping it.
    // Past an LR2 negative-BPM reversal a bar line the playhead passed before it stays gone as the scroll runs back.
    firstBeatIndex = findFirstIndexNumberAtOrAfter(beats, drawWindow.reachedBeat - 1 / Math.max(1, pixelsPerBeat));
  }
  // beatoraja's rules end the walk where the notes' walk ends (bar lines are timelines like any other).
  const maxBeat =
    drawWindow.rules === 'beatoraja'
      ? drawWindow.lastBeat
      : currentBeat + (bottom - top + 1) / Math.max(1, pixelsPerBeat);
  const beatDistance = this.scrollMapper
    ? (toBeat: number): number => this.scrollMapper!.distanceBetween(currentBeat, toBeat)
    : (toBeat: number): number => toBeat - currentBeat;
  const drawBottom = resolveDrawBottom(drawWindow, bottom);
  const lineY = (beat: number): number => resolveDrawY(drawWindow, bottom - beatDistance(beat) * pixelsPerBeat, bottom);
  if (
    this.theme.renderThemeMeasureLines({
      beats,
      firstBeatIndex,
      maxBeat,
      pixelsPerBeat,
      beatDistance,
      lineY,
      top,
      bottom,
      drawBottom,
    })
  ) {
    return;
  }
  const binding = this.skinBinding;
  if (binding?.drawsMeasureLines) {
    // The skin draws them: hand it one line per lane run, so double play's gap stays clear.
    const runs = resolveMeasureLineRuns.call(this);
    for (let beatIndex = firstBeatIndex; beatIndex < beats.length; beatIndex += 1) {
      const beat = beats[beatIndex]!;
      if (beat > maxBeat) {
        break;
      }
      const y = lineY(beat);
      if (y < top - 1 || y > drawBottom + 1) {
        continue;
      }
      for (const run of runs) {
        binding.addMeasureLine({ side: run.side, x: run.x, w: run.w, y });
      }
    }
    return;
  }
  // Fallback: simple white strip when the theme draws none, one per run of adjacent lanes so double play's gap stays
  // clear. One pooled `Graphics` carries every line — the accumulated rect-fill commands form one batched draw, no
  // per-line allocation.
  const runs = resolveMeasureLineRuns.call(this);
  const graphic = this.noteLayerPool.acquireGraphics();
  for (let beatIndex = firstBeatIndex; beatIndex < beats.length; beatIndex += 1) {
    const beat = beats[beatIndex]!;
    if (beat > maxBeat) {
      break;
    }
    const y = lineY(beat);
    if (y < top - 1 || y > drawBottom + 1) {
      continue;
    }
    for (const run of runs) {
      graphic.rect(run.x, Math.round(y), run.w, 1).fill({ color: 0x9a8fd0, alpha: 0.28 });
    }
  }
}

/** The lane runs of this frame's lanes, recomputed only when their geometry changes. */
function resolveMeasureLineRuns(this: PlayfieldContext): readonly SideLaneRun[] {
  let signature = this.laneX.size;
  for (const lane of this.laneX.values()) {
    signature = (signature * 31 + lane.x * 7 + lane.w) % 1_000_000_007;
  }
  const cached = this.measureLineRuns;
  if (cached && cached.signature === signature) return cached.runs;
  const runs = resolveSideLaneRuns(this.laneX);
  this.measureLineRuns = { signature, runs };
  return runs;
}
