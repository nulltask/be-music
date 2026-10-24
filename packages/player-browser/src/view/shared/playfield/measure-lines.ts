import { drawLabel } from '../../../stage/draw-label.ts';
/**
 * The measure lines of the shared playfield: the chart's bar lines from the playhead, drawn with the skin's lines, by the
 * be-music skin, or as a thin bar across each run of adjacent lanes.
 */

import { resolveChart } from '@be-music/chart-model';
import { findFirstIndexNumberAtOrAfter } from '@be-music/shared-utils/core';
import {
  isDrawnAtTime,
  resolveDrawBottom,
  resolveDrawY,
  type NoteDrawWindow,
} from '../../../chart/note-draw-window.ts';
import type { PlayfieldContext } from './context.ts';
import { resolveSideLaneRuns, type SideLaneRun } from './measure-line-runs.ts';

function resolveMeasureBeats(ctx: PlayfieldContext): number[] {
  const chartEntry = ctx.play.chart;
  if (!chartEntry) {
    return [];
  }
  if (ctx.measureBeatCache.chartId === chartEntry.id) {
    return ctx.measureBeatCache.beats;
  }
  // The resolved chart's bar lines: one per measure start up to the last measure, using the chosen `#RANDOM` branch's
  // `#xxx02` lengths, and none when a bmson chart opts out with `lines: []`.
  const beats = [...(ctx.play.resolvedPlayChart ?? resolveChart(chartEntry.chart)).barLines];
  ctx.measureBeatCache = { chartId: chartEntry.id, beats };
  return beats;
}

/**
 * Draws horizontal measure lines on the playfield at every `#MEASURE` boundary. A skin may give its own lines
 * (`PlayfieldSkin.measureLines`; the LR2 family's `#SRC_LINE` / `#DST_LINE`), each repeated at every boundary; otherwise
 * we fall back to a thin bar across each run of adjacent lanes, so double play's banks get one each and the gap between
 * them stays clear.
 */
export function renderMeasureLines(ctx: PlayfieldContext, drawWindow: NoteDrawWindow, pixelsPerBeat: number): void {
  const { currentBeat } = drawWindow;
  const beats = resolveMeasureBeats(ctx);
  if (beats.length === 0 || ctx.play.laneChannels.length === 0) {
    return;
  }
  const firstChannel = ctx.play.laneChannels[0]!;
  const lastChannel = ctx.play.laneChannels[ctx.play.laneChannels.length - 1]!;
  const left = ctx.play.laneX.get(firstChannel);
  const right = ctx.play.laneX.get(lastChannel);
  if (!left || !right) {
    return;
  }
  const top = left.top;
  const bottom = left.bottom;
  let firstBeatIndex: number;
  if (drawWindow.rules === 'beatoraja') {
    // A bar line is a timeline like any other: gone once its time has come (a STOP on it included).
    firstBeatIndex = findFirstIndexNumberAtOrAfter(beats, currentBeat);
    const timing = ctx.play.timingResolver;
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
    firstBeatIndex = findFirstIndexNumberAtOrAfter(
      beats,
      drawWindow.reachedBeat - 1 / Math.max(Number.EPSILON, pixelsPerBeat),
    );
  }
  // beatoraja's rules end the walk where the notes' walk ends (bar lines are timelines like any other).
  const maxBeat =
    drawWindow.rules === 'beatoraja'
      ? drawWindow.lastBeat
      : currentBeat + (bottom - top + 1) / Math.max(Number.EPSILON, pixelsPerBeat);
  const beatDistance = ctx.play.scrollMapper
    ? (toBeat: number): number => ctx.play.scrollMapper!.distanceBetween(currentBeat, toBeat)
    : (toBeat: number): number => toBeat - currentBeat;
  const drawBottom = resolveDrawBottom(drawWindow, bottom);
  const lineY = (beat: number): number => resolveDrawY(drawWindow, bottom - beatDistance(beat) * pixelsPerBeat, bottom);
  const skinLines = ctx.playfieldSkin.measureLines();
  if (skinLines !== undefined) {
    // Each of the skin's lines (one per side under double play) at every boundary, in the skin's order.
    for (let lineIndex = 0; lineIndex < skinLines.length; lineIndex += 1) {
      const line = skinLines[lineIndex]!;
      const texture = line.cell.texture;
      if (texture === undefined) continue;
      for (let beatIndex = firstBeatIndex; beatIndex < beats.length; beatIndex += 1) {
        const beat = beats[beatIndex]!;
        if (beat > maxBeat) {
          break;
        }
        const y = lineY(beat);
        if (y < top - 1 || y > drawBottom + 1) {
          continue;
        }
        const sprite = ctx.noteLayerPool.acquireSprite();
        sprite.texture = texture;
        sprite.label = drawLabel(ctx, 'measure-line', lineIndex, beat);
        sprite.position.set(line.x, Math.round(y + (line.yOffset ?? 0)));
        sprite.width = line.width;
        sprite.height = line.height;
        line.applyToSprite?.(sprite);
      }
    }
    return;
  }
  const binding = ctx.skinBinding;
  if (binding?.drawsMeasureLines) {
    // The skin draws them: hand it one line per lane run, so double play's gap stays clear.
    const runs = resolveMeasureLineRuns(ctx);
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
  const runs = resolveMeasureLineRuns(ctx);
  const graphic = ctx.noteLayerPool.acquireGraphics();
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
function resolveMeasureLineRuns(ctx: PlayfieldContext): readonly SideLaneRun[] {
  let signature = ctx.play.laneX.size;
  for (const lane of ctx.play.laneX.values()) {
    signature = (signature * 31 + lane.x * 7 + lane.w) % 1_000_000_007;
  }
  const cached = ctx.measureLineRuns;
  if (cached && cached.signature === signature) return cached.runs;
  const runs = resolveSideLaneRuns(ctx.play.laneX);
  ctx.measureLineRuns = { signature, runs };
  return runs;
}
