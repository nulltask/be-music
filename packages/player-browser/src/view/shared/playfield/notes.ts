import { drawLabel } from '../../../stage/draw-label.ts';
/**
 * The notes of the shared playfield: walks the chart's notes, mines and invisible notes from the playhead under LR2's
 * or beatoraja's drawing rules (`note-draw-window.ts`) and draws each tap note, long note, mine and invisible-note
 * overlay with the theme's cell, the be-music skin, or the default playfield's shape.
 */

import { findFirstIndexAtOrAfter } from '@be-music/shared-utils/core';
import type { TimedLandmineNote } from '@be-music/player-engine/display';
import {
  advanceDrawCursor,
  isDrawnAtTime,
  isDrawnUntilJudged,
  isLongNoteDrawnAtTime,
  isPastDrawWindow,
  resolveDrawBottom,
  resolveDrawY,
  resolveNoteDrawRules,
  resolveNoteDrawWindow,
  resolveReversedDrawClock,
} from '../../../chart/note-draw-window.ts';
import { PIXELS_PER_BEAT } from '../../../stage/design.ts';
import { resolveLR2LaneIndex } from '@be-music/player-engine/lanes';
import { resolveBeMusicLaneKind } from '../../../skin/be-music/registry.ts';
import { renderDefaultNote } from './default-playfield.ts';
import type { PlayfieldLaneRect } from '../../types.ts';
import type { PlayfieldContext, RuntimeNote } from './context.ts';
import { renderLongNote } from './long-notes.ts';
import { renderMeasureLines } from './measure-lines.ts';
import { renderMineNote } from './mines.ts';

export function renderNotes(ctx: PlayfieldContext, seconds: number, height: number): void {
  const overscan = ctx.noteOverscan;
  ctx.noteLayerPool.begin();
  if (ctx.play.isIntroPlaying()) {
    // Intro period — the theme is sliding its frame chrome in. Notes and measure lines stay off-screen until the
    // playhead is live. The `noteLayerPool.end()` below hides every pooled child that the (skipped) draw passes
    // would have re-acquired.
    ctx.noteLayerPool.end();
    return;
  }
  const currentBeat = ctx.play.currentBeat(seconds);
  // The eased scroll factor, so a hi-speed change glides instead of making the notes jump.
  const pixelsPerBeat =
    (ctx.playfieldSkin.pixelsPerBeat ?? PIXELS_PER_BEAT) * ctx.play.scrollHiSpeed.valueAt(performance.now());
  let laneHeight = 1;
  for (const lane of ctx.play.laneX.values()) {
    laneHeight = Math.max(laneHeight, lane.bottom - lane.top);
  }
  // Past an LR2 negative-BPM reversal the scroll runs back: object times are compared with the mirrored judge clock,
  // and what the playhead passed before the reversal stays passed.
  const reversal = ctx.play.timingResolver?.reversal;
  const drawClock = resolveReversedDrawClock(reversal, seconds, currentBeat);
  const drawWindow = resolveNoteDrawWindow({
    rules: resolveNoteDrawRules(ctx.play.scrollMapper !== undefined),
    currentBeat,
    nowSeconds: drawClock.nowSeconds,
    reachedBeat: drawClock.reachedBeat,
    mapper: ctx.play.scrollMapper,
    laneBeats: laneHeight / Math.max(1, pixelsPerBeat),
    timelineBeats: ctx.play.laneTimelineBeats,
    overscanBeats: overscan / Math.max(1, pixelsPerBeat),
    stageBottomY: height,
  });
  renderMeasureLines(ctx, drawWindow, pixelsPerBeat);
  // Note: the lane-bottom beat-pulse glow is drawn by the LR2 skin itself — the "rhythm timer" `#DST_IMAGE` at SRC y=2007
  // in the default 7-keys skin, anchored to timer 140. `elapsedSinceTimer(140)` remaps the chart's current fractional
  // beat to the 0..1000 ms keyframe window the LR2 skin's keyframe chain authored, so the glow flashes on every beat
  // regardless of BPM. The custom `renderBeatAura` we used to call here was duplicate visual noise and has been
  // removed. Distance integrator. With `#SCROLL` / `#SPEED` events present we let the mapper compute the integrated
  // distance; otherwise we fall back to a flat `(beat - currentBeat)` to skip the segment-walking overhead.
  const beatDistance = ctx.play.scrollMapper
    ? (toBeat: number): number => ctx.play.scrollMapper!.distanceBetween(currentBeat, toBeat)
    : (toBeat: number): number => toBeat - currentBeat;
  // Debug visualization — paint invisible / keysound notes FIRST so playable notes + mines paint over them. Skipped
  // entirely when the option is off; keeping the array lets the option toggle during play.
  if (ctx.options.showInvisibleNotes && ctx.play.invisibleNotes.length > 0) {
    // Themes can supply a sprite for the overlay (the LR2 family uses the Pop'n green wide note of its 9-keys play
    // skin). When unavailable we fall through to a flat green rectangle so the overlay still reads.
    const firstInvisibleIndex = findFirstIndexAtOrAfter(ctx.play.invisibleNotes, currentBeat, (note) => note.beat);
    for (let invIndex = firstInvisibleIndex; invIndex < ctx.play.invisibleNotes.length; invIndex += 1) {
      const invisible = ctx.play.invisibleNotes[invIndex]!;
      if (isPastDrawWindow(drawWindow, invisible.beat)) {
        break;
      }
      if (!isDrawnAtTime(drawWindow, invisible.seconds)) continue;
      const lane = ctx.play.laneX.get(invisible.channel);
      if (!lane) continue;
      const y = lane.bottom - beatDistance(invisible.beat) * pixelsPerBeat;
      if (y < lane.top - overscan || y > resolveDrawBottom(drawWindow, lane.bottom)) continue;
      const cell = ctx.playfieldSkin.noteCell('invisible', invisible.channel);
      if (cell?.texture) {
        const sprite = ctx.noteLayerPool.acquireSprite();
        sprite.texture = cell.texture;
        sprite.label = drawLabel(ctx, 'invisible-note', invisible.channel);
        sprite.x = lane.x + (lane.w - cell.width) / 2;
        sprite.y = y - cell.height;
        sprite.width = cell.width;
        sprite.height = cell.height;
        continue;
      }
      const graphic = ctx.noteLayerPool.acquireGraphics();
      graphic.label = drawLabel(ctx, 'invisible-note-fallback', invisible.channel);
      graphic.rect(lane.x + 2, y - 4, Math.max(4, lane.w - 4), 4).fill({ color: 0x33dd66, alpha: 0.7 });
    }
  }
  // Under LR2's rules a note stays until it is judged and its beat has passed, so the walk starts from LR2's
  // `draw_count` (the first note not gone yet); beatoraja's rules start from the notes whose time can still be ahead.
  const isGone = (object: RuntimeNote | TimedLandmineNote): boolean => {
    const autoplayed = ctx.play.isAutoplayedChannel(object.channel);
    return reversal === undefined
      ? !isDrawnUntilJudged(drawWindow, object, autoplayed)
      : ctx.goneDrawObjects.isGone(drawWindow, object, autoplayed);
  };
  if (reversal !== undefined) ctx.goneDrawObjects.sync(seconds);
  const cursor = drawWindow.rules === 'lr2' ? advanceNoteDrawCursor(ctx, seconds, isGone) : undefined;
  const firstNoteIndex =
    cursor?.note ??
    findFirstIndexAtOrAfter(ctx.play.notes, currentBeat - ctx.play.maxLongNoteBeatSpan, (note) => note.beat);
  const hideJudgedNotes = ctx.options.judgedNoteDisplay === 'HIDE';
  for (let noteIndex = firstNoteIndex; noteIndex < ctx.play.notes.length; noteIndex += 1) {
    const note = ctx.play.notes[noteIndex]!;
    if (isPastDrawWindow(drawWindow, note.beat)) {
      break;
    }
    // LR2's rules: a note stays until it is judged and its beat (a long note's end) has passed — on the judgement line
    // once its beat has. beatoraja's rules go by time below.
    if (drawWindow.rules === 'lr2' && isGone(note)) {
      continue;
    }
    const lane = ctx.play.laneX.get(note.channel);
    if (!lane) {
      continue;
    }
    const y = resolveDrawY(drawWindow, lane.bottom - beatDistance(note.beat) * pixelsPerBeat, lane.bottom);
    // The LR2-spec lane index (LR2 `#SRC_NOTE,...,index`), for the lane kind a be-music skin draws and the labels.
    const laneIndex = resolveLR2LaneIndex(note.channel, ctx.play.chartPlayVariant);
    // Long-note render: draw LN_BODY between start and end beats, capped with LN_START / LN_END sprites. Falls
    // through to single-note render if the chart has no long-note end-beat for this entry.
    if (note.endBeat !== undefined) {
      if (!isLongNoteDrawnAtTime(drawWindow, note.endSeconds ?? note.seconds)) {
        continue;
      }
      const yEnd = resolveDrawY(drawWindow, lane.bottom - beatDistance(note.endBeat) * pixelsPerBeat, lane.bottom);
      // yEnd is *above* y (smaller value, since beats grow upward visually). Under beatoraja's rules a tail below the
      // stage bottom has nothing left to draw (LR2's rules hold it on the line until the note goes). Also clip when the
      // head is still off-screen above the playfield.
      const drawBottom = resolveDrawBottom(drawWindow, lane.bottom);
      if (yEnd > drawBottom || y < lane.top - overscan) {
        continue;
      }
      // beatoraja draws a long note whose head has passed with the head on the judgement line (the walk does not
      // advance past the playhead), and skips one whose tail does not sit above its head.
      const headY = drawWindow.rules === 'beatoraja' && note.seconds < drawWindow.nowSeconds ? lane.bottom : y;
      if (drawWindow.rules === 'beatoraja' && yEnd >= headY) {
        continue;
      }
      renderLongNote(ctx, laneIndex, note, lane, headY, yEnd, drawBottom);
      continue;
    }
    // A tap note draws while it is above the stage's bottom edge and (beatoraja's rules) its time is still ahead; LR2's
    // rules hold it on the line until it goes.
    if (
      y < lane.top - overscan ||
      y > resolveDrawBottom(drawWindow, lane.bottom) ||
      !isDrawnAtTime(drawWindow, note.seconds)
    ) {
      continue;
    }
    // Read the engine's `judged` flag directly off the shared `TimedPlayableNote` instance — the engine
    // mutates it the moment it resolves the note's verdict, and because the renderer and the engine
    // hold the same array (handed in via `engineOptions.preparedChart`), there is no parallel `hit` flag
    // to keep in sync. `judgedNoteDisplay: 'HIDE'` drops a judged note at once; by default (as in LR2 and
    // beatoraja) it stays until its time.
    if (note.judged && hideJudgedNotes) {
      continue;
    }
    renderSingleNote(ctx, laneIndex, note.channel, lane, y);
  }
  // Landmine notes — same scroll math, separate sprite. Drawn after regular notes so a mine sitting at the same beat
  // as a playable note paints on top (LR2 default skin's mine sprites carry their own outline so the visual hierarchy
  // reads correctly).
  // A mine is judged once it has passed or exploded: LR2's rules hold it on the line until then (one set off early
  // keeps scrolling to the line); beatoraja's rules drop it at its time, or once judged.
  const firstMineIndex = cursor?.mine ?? findFirstIndexAtOrAfter(ctx.play.mineNotes, currentBeat, (note) => note.beat);
  for (let mineIndex = firstMineIndex; mineIndex < ctx.play.mineNotes.length; mineIndex += 1) {
    const mine = ctx.play.mineNotes[mineIndex]!;
    if (isPastDrawWindow(drawWindow, mine.beat)) {
      break;
    }
    if (drawWindow.rules === 'lr2') {
      if (isGone(mine)) continue;
    } else if (mine.judged || !isDrawnAtTime(drawWindow, mine.seconds)) continue;
    const lane = ctx.play.laneX.get(mine.channel);
    if (!lane) continue;
    const y = resolveDrawY(drawWindow, lane.bottom - beatDistance(mine.beat) * pixelsPerBeat, lane.bottom);
    if (y < lane.top - overscan || y > resolveDrawBottom(drawWindow, lane.bottom)) continue;
    const laneIndex = resolveLR2LaneIndex(mine.channel, ctx.play.chartPlayVariant);
    renderMineNote(ctx, laneIndex, mine.channel, lane, y);
  }
  ctx.noteLayerPool.end();
}

/**
 * Moves LR2's `draw_count` ({@link drawCursor}) past the notes and mines gone by this frame and returns it. Starts
 * over when the chart's arrays change or the playhead's chart time `seconds` moves back.
 */
function advanceNoteDrawCursor(
  ctx: PlayfieldContext,
  seconds: number,
  isGone: (object: RuntimeNote | TimedLandmineNote) => boolean,
): { note: number; mine: number } {
  let cursor = ctx.drawCursor;
  if (!cursor || cursor.notes !== ctx.play.notes || cursor.mines !== ctx.play.mineNotes || seconds < cursor.seconds) {
    cursor = { notes: ctx.play.notes, mines: ctx.play.mineNotes, seconds, note: 0, mine: 0 };
    ctx.drawCursor = cursor;
  }
  cursor.seconds = seconds;
  cursor.note = advanceDrawCursor(ctx.play.notes, cursor.note, isGone);
  cursor.mine = advanceDrawCursor(ctx.play.mineNotes, cursor.mine, isGone);
  return cursor;
}

function renderSingleNote(
  ctx: PlayfieldContext,
  laneIndex: number,
  channel: string,
  lane: PlayfieldLaneRect,
  y: number,
): void {
  // `y` is where the chart timing intersects the judgement line for this note. We anchor the sprite by its **bottom
  // edge** so the just-timing moment lines up with the bottom edge of the visual note (LR2 / BMS convention) instead
  // of the center.
  const cell = ctx.playfieldSkin.noteCell('note', channel);
  if (cell?.texture) {
    const sprite = ctx.noteLayerPool.acquireSprite();
    sprite.texture = cell.texture;
    sprite.label = drawLabel(ctx, 'note', laneIndex, channel);
    sprite.x = lane.x + (lane.w - cell.width) / 2;
    sprite.y = y - cell.height;
    sprite.width = cell.width;
    sprite.height = cell.height;
    return;
  }
  const kind = resolveBeMusicLaneKind(channel, laneIndex, ctx.play.chartPlayVariant);
  const binding = ctx.skinBinding;
  if (binding) {
    binding.addNote({ kind, x: lane.x, w: lane.w, y, autoplay: ctx.play.isAutoplayedChannel(channel) });
    return;
  }
  const graphic = ctx.noteLayerPool.acquireGraphics();
  graphic.label = drawLabel(ctx, 'note-fallback', laneIndex, channel);
  renderDefaultNote({ graphics: graphic, kind, x: lane.x, w: lane.w, y, nowMs: ctx.play.playClock() });
}
