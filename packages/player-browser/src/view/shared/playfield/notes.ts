import { resolveConstantVisibility, resolveConstantAlpha } from '@be-music/player-scene-model';
import { resolveNoteDisplaySeconds } from '@be-music/player-scene-model';
import { collectBPMGuideEvents } from '../../../chart/bpm-guide.ts';
import { renderBPMGuide } from '../bpm-guide.ts';
import { resolveSideLaneRuns } from './measure-line-runs.ts';
import { drawLabel } from '../../../stage/draw-label.ts';
/**
 * The notes of the shared playfield: walks the chart's notes, mines and invisible notes from the playhead under LR2's
 * or beatoraja's drawing rules (`note-draw-window.ts`) and draws each tap note, long note, mine and invisible-note
 * overlay with the theme's cell, the Be-Music Skin, or the default playfield's shape.
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
import { isScratch, resolveLR2LaneIndex } from '@be-music/player-engine/lanes';
import { renderJudgeArea } from '../judge-area.ts';
import { resolveBeMusicLaneKind } from '../../../skin/be-music/registry.ts';
import { renderDefaultNote } from './default-playfield.ts';
import type { PlayfieldLaneRect } from '../../types.ts';
import type { PlayfieldContext, RuntimeNote } from './context.ts';
import { resolveHiddenNoteChannels } from './hidden-note-channels.ts';
import { resolveLaneDim } from './lane-brightness.ts';
import { resolveProcessedNoteAlpha } from './processed-note.ts';
import {
  LR2_SCREEN_HEIGHT,
  placeLR2ManiaNote,
  resolveLR2ManiaNoteIndexes,
  resolveLR2ManiaVisual,
  resolveLR2Nabeatsu,
  type LR2ManiaNotePlacement,
} from './lr2-mania-visual.ts';
import { renderLongNote } from './long-notes.ts';
import { renderMeasureLines } from './measure-lines.ts';
import { renderMineNote } from './mines.ts';
import { hasChartNoteVisual, placeChartNoteVisual, type ChartNoteScreenVisual } from './chart-note-visual.ts';

export function renderNotes(ctx: PlayfieldContext, seconds: number, height: number): void {
  const overscan = ctx.noteOverscan;
  ctx.noteLayerPool.begin();
  // AC 34's lane brightness: a black layer over each lane, under everything that scrolls on it.
  const laneDim = resolveLaneDim(ctx.playOptions?.laneBrightness);
  if (laneDim > 0) {
    for (const lane of ctx.play.laneX.values()) {
      ctx.noteLayerPool
        .acquireGraphics()
        .rect(lane.x, lane.top, lane.w, lane.bottom - lane.top)
        .fill({ color: 0x000000, alpha: laneDim });
    }
  }
  if (ctx.play.isIntroPlaying()) {
    // Intro period — the theme is sliding its frame chrome in. Notes and measure lines stay off-screen until the
    // playhead is live. The `noteLayerPool.end()` below hides every pooled child that the (skipped) draw passes
    // would have re-acquired.
    ctx.noteLayerPool.end();
    return;
  }
  const displaySeconds = resolveNoteDisplaySeconds(seconds, ctx.options.judgeTimingMs ?? 0);
  const currentBeat = ctx.play.currentBeat(displaySeconds);
  const constant = resolveConstantVisibility({
    enabled: ctx.options.visualConstant,
    durationMs: ctx.options.noteDurationMs,
    fadeMs: ctx.options.constantFadeMs,
    noSpeed: ctx.play.playState.view.hiSpeed.locked,
  });
  const opacity = (eventSeconds: number) => resolveConstantAlpha(eventSeconds, displaySeconds, constant);
  // Chart-authored HIDDEN / CHANGE-HS / CRAZY (#843): each note's place, opacity, size and sway, from the engine frame.
  const chartOptions = ctx.play.engineFrame?.chartOptions;
  const chartVisual = hasChartNoteVisual(chartOptions)
    ? (y: number, lane: PlayfieldLaneRect, channel: string, beat: number): ChartNoteScreenVisual =>
        placeChartNoteVisual(chartOptions, {
          y,
          judgementY: lane.bottom,
          laneTopY: lane.top,
          laneWidth: lane.w,
          channel,
          beat,
          seconds: displaySeconds,
          combo: ctx.play.engineFrame?.summary?.combo,
        })
    : undefined;
  // The eased scroll factor, so a hi-speed change glides instead of making the notes jump.
  const pixelsPerBeat =
    (ctx.playfieldSkin.pixelsPerBeat ?? PIXELS_PER_BEAT) * ctx.play.scrollHiSpeed.valueAt(performance.now());
  let laneHeight = 1;
  for (const lane of ctx.play.laneX.values()) {
    laneHeight = Math.max(laneHeight, (lane.baseBottom ?? lane.bottom) - lane.top);
  }
  // Past an LR2 negative-BPM reversal the scroll runs back: object times are compared with the mirrored judge clock,
  // and what the playhead passed before the reversal stays passed.
  const reversal = ctx.play.timingResolver?.reversal;
  const drawClock = resolveReversedDrawClock(reversal, displaySeconds, currentBeat);
  const drawWindow = resolveNoteDrawWindow({
    rules: resolveNoteDrawRules(ctx.play.scrollMapper !== undefined && ctx.play.playState.view.hsFix !== 'CONSTANT'),
    currentBeat,
    nowSeconds: drawClock.nowSeconds,
    reachedBeat: drawClock.reachedBeat,
    mapper: ctx.play.scrollMapper,
    laneBeats: laneHeight / Math.max(Number.EPSILON, pixelsPerBeat),
    timelineBeats: ctx.play.laneTimelineBeats,
    overscanBeats: overscan / Math.max(Number.EPSILON, pixelsPerBeat),
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
  // beatoraja's judge area: under the notes, so they stay readable.
  if (ctx.playOptions?.showJudgeArea === true && ctx.play.judgeWindows !== undefined) {
    const scrollScales = new Map<object, number>();
    renderJudgeArea({
      lanes: Array.from(ctx.play.laneX, ([channel, lane]) => {
        const area = { x: lane.x, w: lane.w, top: lane.top, bottom: lane.bottom, scratch: isScratch(channel) };
        scrollScales.set(area, lane.scrollScale ?? 1);
        return area;
      }),
      note: ctx.play.judgeWindows.note,
      scratch: ctx.play.judgeWindows.scratch,
      distanceAt: (ms, lane) =>
        beatDistance(ctx.play.currentBeat(displaySeconds + ms / 1000)) * pixelsPerBeat * (scrollScales.get(lane) ?? 1),
      pool: ctx.noteLayerPool,
    });
  }
  if (ctx.options.bpmGuide && ctx.play.timingResolver) {
    const timing = ctx.play.timingResolver;
    if (ctx.bpmGuideCache?.timing !== timing) ctx.bpmGuideCache = { timing, events: collectBPMGuideEvents(timing) };
    const first = ctx.play.laneX.values().next().value;
    if (first)
      renderBPMGuide({
        enabled: true,
        events: ctx.bpmGuideCache.events,
        window: drawWindow,
        distance: beatDistance,
        pixelsPerBeat,
        pool: ctx.noteLayerPool,
        alphaAt: opacity,
        lanes: resolveSideLaneRuns(ctx.play.laneX).map((run) => {
          const lane = [...ctx.play.laneX.values()].find((lane) => lane.x === run.x) ?? first;
          return { ...run, top: lane.top, bottom: lane.bottom, scrollScale: lane.scrollScale };
        }),
      });
  }
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
      const alpha = opacity(invisible.seconds);
      if (alpha <= 0) continue;
      const lane = ctx.play.laneX.get(invisible.channel);
      if (!lane) continue;
      const y = lane.bottom - beatDistance(invisible.beat) * pixelsPerBeat * (lane.scrollScale ?? 1);
      if (y < lane.top - overscan || y > resolveDrawBottom(drawWindow, lane.bottom)) continue;
      const cell = ctx.playfieldSkin.noteCell('invisible', invisible.channel);
      if (cell?.texture) {
        const sprite = ctx.noteLayerPool.acquireSprite();
        sprite.texture = cell.texture;
        sprite.label = drawLabel(ctx, 'invisible-note', invisible.channel);
        sprite.alpha = alpha;
        sprite.x = lane.x + (lane.w - cell.width) / 2;
        sprite.y = y - cell.height;
        sprite.width = cell.width;
        sprite.height = cell.height;
        continue;
      }
      const graphic = ctx.noteLayerPool.acquireGraphics();
      graphic.label = drawLabel(ctx, 'invisible-note-fallback', invisible.channel);
      graphic.rect(lane.x + 2, y - 4, Math.max(4, lane.w - 4), 4).fill({ color: 0x33dd66, alpha: 0.7 * alpha });
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
  // AC 34's オートスクラッチ表示: the scratch notes AUTO SCRATCH plays are not drawn; they still play and count (#1137).
  const hiddenChannels = resolveHiddenNoteChannels(ctx.playOptions?.autoScratchNotes, ctx.play.autoScratchChannels);
  // LR2's mania drawing options: each note's and mine's place, shift and size, after the chart's own options.
  const mania = resolveLR2ManiaVisual(ctx.playOptions);
  const maniaIndexes = mania !== undefined ? resolveLR2ManiaNoteIndexes(ctx.play.notes, ctx.play.mineNotes) : undefined;
  const maniaUnit = ctx.playfieldSkin.stage.height / LR2_SCREEN_HEIGHT;
  const maniaNowMs = ctx.play.playClock();
  // NABEATSU sways the notes and the bar lines together: the layer moves, and each note is told so.
  const sway = resolveLR2Nabeatsu(mania, maniaNowMs, maniaUnit);
  ctx.noteLayer.position.set(sway.x, sway.y);
  const placeMania =
    mania === undefined
      ? undefined
      : (object: object, lane: PlayfieldLaneRect, laneIndex: number, y: number, yEnd?: number): LR2ManiaNotePlacement =>
          placeLR2ManiaNote(mania, {
            distance: lane.bottom - y,
            ...(yEnd !== undefined ? { tailDistance: lane.bottom - yEnd } : {}),
            lineY: lane.bottom,
            lane: Math.max(0, laneIndex),
            index: maniaIndexes?.get(object) ?? 0,
            nowMs: maniaNowMs,
            unit: maniaUnit,
            sway,
          });
  for (let noteIndex = firstNoteIndex; noteIndex < ctx.play.notes.length; noteIndex += 1) {
    const note = ctx.play.notes[noteIndex]!;
    if (isPastDrawWindow(drawWindow, note.beat)) {
      break;
    }
    const alpha = opacity(note.seconds);
    if (alpha <= 0) continue;
    // LR2's rules: a note stays until it is judged and its beat (a long note's end) has passed — on the judgement line
    // once its beat has. beatoraja's rules go by time below.
    if (drawWindow.rules === 'lr2' && isGone(note)) {
      continue;
    }
    const lane = ctx.play.laneX.get(note.channel);
    if (!lane || hiddenChannels?.has(note.channel)) {
      continue;
    }
    const headVisual = chartVisual?.(
      lane.bottom - beatDistance(note.beat) * pixelsPerBeat * (lane.scrollScale ?? 1),
      lane,
      note.channel,
      note.beat,
    );
    // The LR2-spec lane index (LR2 `#SRC_NOTE,...,index`), for the lane kind a Be-Music Skin draws and the labels.
    const laneIndex = resolveLR2LaneIndex(note.channel, ctx.play.chartPlayVariant);
    const scrolledY = headVisual?.y ?? lane.bottom - beatDistance(note.beat) * pixelsPerBeat * (lane.scrollScale ?? 1);
    // A long note's end before the mania options, which move it with the head.
    const scrolledEndY =
      note.endBeat !== undefined
        ? scrolledLongNoteEndY(note.endBeat, lane, note.channel, note.beat, beatDistance, pixelsPerBeat, chartVisual)
        : undefined;
    const maniaPlacement = placeMania?.(note, lane, laneIndex, scrolledY, scrolledEndY);
    const y = resolveDrawY(
      drawWindow,
      maniaPlacement !== undefined ? lane.bottom - maniaPlacement.distance : scrolledY,
      lane.bottom,
    );
    const noteAlpha = alpha * (headVisual?.alpha ?? 1);
    if (noteAlpha <= 0) continue;
    // Long-note render: draw LN_BODY between start and end beats, capped with LN_START / LN_END sprites. Falls
    // through to single-note render if the chart has no long-note end-beat for this entry.
    if (note.endBeat !== undefined) {
      if (!isLongNoteDrawnAtTime(drawWindow, note.endSeconds ?? note.seconds)) {
        continue;
      }
      // A long note keeps its lane geometry: only CHANGE-HS moves its tail, and its head's HIDDEN opacity applies.
      const yEnd = resolveDrawY(
        drawWindow,
        maniaPlacement?.tailDistance !== undefined ? lane.bottom - maniaPlacement.tailDistance : scrolledEndY!,
        lane.bottom,
      );
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
      const longLane = applyManiaLane(lane, maniaPlacement);
      if (noteAlpha === 1) renderLongNote(ctx, laneIndex, note, longLane, headY, yEnd, drawBottom);
      else
        ctx.noteLayerPool.withAlpha(noteAlpha, () =>
          renderLongNote(ctx, laneIndex, note, longLane, headY, yEnd, drawBottom, noteAlpha),
        );
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
    const noteLane = applyManiaLane(applyChartLaneVisual(lane, headVisual), maniaPlacement);
    const size = maniaSize(maniaPlacement);
    // beatoraja's mark processed note: a note judged before its time is drawn dimmed until it goes (#1130).
    const tapAlpha = noteAlpha * resolveProcessedNoteAlpha(ctx.playOptions?.markProcessedNotes, note.judged);
    const style = chartNoteStyle(headVisual);
    // CLONE afterimages go first, so the note draws over them.
    if (headVisual !== undefined && headVisual.clones.length > 0) {
      for (const clone of headVisual.clones) {
        if (clone.y < lane.top - overscan || clone.y > lane.bottom) continue;
        const cloneAlpha = noteAlpha * clone.alpha;
        const cloneLane = applyChartLaneVisual(lane, { scale: headVisual.scale, xOffset: clone.xOffset });
        ctx.noteLayerPool.withAlpha(cloneAlpha, () =>
          renderSingleNote(ctx, laneIndex, note.channel, cloneLane, clone.y, cloneAlpha, headVisual.scale, style),
        );
      }
    }
    if (tapAlpha === 1) renderSingleNote(ctx, laneIndex, note.channel, noteLane, y, 1, headVisual?.scale, style, size);
    else
      ctx.noteLayerPool.withAlpha(tapAlpha, () =>
        renderSingleNote(ctx, laneIndex, note.channel, noteLane, y, tapAlpha, headVisual?.scale, style, size),
      );
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
    const alpha = opacity(mine.seconds);
    if (alpha <= 0) continue;
    if (drawWindow.rules === 'lr2') {
      if (isGone(mine)) continue;
    } else if (mine.judged || !isDrawnAtTime(drawWindow, mine.seconds)) continue;
    const lane = ctx.play.laneX.get(mine.channel);
    if (!lane) continue;
    const rawMineY = lane.bottom - beatDistance(mine.beat) * pixelsPerBeat * (lane.scrollScale ?? 1);
    const mineVisual = chartVisual?.(rawMineY, lane, mine.channel, mine.beat);
    const laneIndex = resolveLR2LaneIndex(mine.channel, ctx.play.chartPlayVariant);
    const minePlacement = placeMania?.(mine, lane, laneIndex, mineVisual?.y ?? rawMineY);
    const y = resolveDrawY(
      drawWindow,
      minePlacement !== undefined ? lane.bottom - minePlacement.distance : (mineVisual?.y ?? rawMineY),
      lane.bottom,
    );
    if (y < lane.top - overscan || y > resolveDrawBottom(drawWindow, lane.bottom)) continue;
    const mineAlpha = alpha * (mineVisual?.alpha ?? 1);
    if (mineAlpha <= 0) continue;
    const mineLane = applyManiaLane(applyChartLaneVisual(lane, mineVisual), minePlacement);
    if (mineAlpha === 1) renderMineNote(ctx, laneIndex, mine.channel, mineLane, y);
    else
      ctx.noteLayerPool.withAlpha(mineAlpha, () =>
        renderMineNote(ctx, laneIndex, mine.channel, mineLane, y, mineAlpha),
      );
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

/**
 * The lane rect a note draws in under CRAZY size and wave: scaled about the lane centre and shifted by the sway. The
 * lane itself when neither applies.
 */
function applyChartLaneVisual(
  lane: PlayfieldLaneRect,
  visual: Pick<ChartNoteScreenVisual, 'scale' | 'xOffset'> | undefined,
): PlayfieldLaneRect {
  if (visual === undefined || (visual.scale === 1 && visual.xOffset === 0)) return lane;
  const w = lane.w * visual.scale;
  return { ...lane, x: lane.x + (lane.w - w) / 2 + visual.xOffset, w };
}

/** A long note's end as scrolled and placed by the chart's own options, before the mania options. */
function scrolledLongNoteEndY(
  endBeat: number,
  lane: PlayfieldLaneRect,
  channel: string,
  beat: number,
  beatDistance: (toBeat: number) => number,
  pixelsPerBeat: number,
  chartVisual:
    | ((y: number, lane: PlayfieldLaneRect, channel: string, beat: number) => ChartNoteScreenVisual)
    | undefined,
): number {
  const rawEndY = lane.bottom - beatDistance(endBeat) * pixelsPerBeat * (lane.scrollScale ?? 1);
  return chartVisual?.(rawEndY, lane, channel, beat).y ?? rawEndY;
}

/** The lane rect a note draws in under the mania options' sideways shift; the lane itself when there is none. */
function applyManiaLane(lane: PlayfieldLaneRect, placement: LR2ManiaNotePlacement | undefined): PlayfieldLaneRect {
  if (placement === undefined || placement.xOffset === 0) return lane;
  return { ...lane, x: lane.x + placement.xOffset };
}

/** The mania options' change of a tap note's size, or `undefined` when there is none. */
function maniaSize(
  placement: LR2ManiaNotePlacement | undefined,
): { readonly w: number; readonly h: number } | undefined {
  if (placement === undefined || (placement.widthDelta === 0 && placement.heightDelta === 0)) return undefined;
  return { w: placement.widthDelta, h: placement.heightDelta };
}

/** STAR's colour and SPIN's rotation for a tap note, or `undefined` when neither applies. */
interface ChartNoteStyle {
  readonly tint?: number;
  readonly rotation: number;
}

function chartNoteStyle(visual: ChartNoteScreenVisual | undefined): ChartNoteStyle | undefined {
  if (visual === undefined || (visual.tint === undefined && visual.rotation === 0)) return undefined;
  return visual.tint !== undefined ? { tint: visual.tint, rotation: visual.rotation } : { rotation: visual.rotation };
}

function renderSingleNote(
  ctx: PlayfieldContext,
  laneIndex: number,
  channel: string,
  lane: PlayfieldLaneRect,
  y: number,
  alpha = 1,
  /** CRAZY size: the cell's height follows the lane rect's width scale. */
  scale = 1,
  /**
   * STAR / SPIN. A theme cell takes both, rotating about its centre; the default playfield's shape takes the colour; a
   * Be-Music Skin's note takes neither (its binding draws the note itself).
   */
  style?: ChartNoteStyle,
  /** Added to the note's width and height about its centre (LR2's HEARTBEAT). A Be-Music Skin's note takes the width. */
  size?: { readonly w: number; readonly h: number },
): void {
  // `y` is where the chart timing intersects the judgement line for this note. We anchor the sprite by its **bottom
  // edge** so the just-timing moment lines up with the bottom edge of the visual note (LR2 / BMS convention) instead
  // of the center.
  const cell = ctx.playfieldSkin.noteCell('note', channel);
  if (cell?.texture) {
    const sprite = ctx.noteLayerPool.acquireSprite();
    sprite.texture = cell.texture;
    sprite.label = drawLabel(ctx, 'note', laneIndex, channel);
    const width = Math.max(0, cell.width * scale + (size?.w ?? 0));
    const height = Math.max(0, cell.height * scale + (size?.h ?? 0));
    sprite.x = lane.x + (lane.w - width) / 2;
    sprite.y = y - cell.height * scale - (size?.h ?? 0) / 2;
    sprite.width = width;
    sprite.height = height;
    if (style !== undefined) {
      if (style.tint !== undefined) sprite.tint = style.tint;
      if (style.rotation !== 0) {
        sprite.anchor.set(0.5);
        sprite.x += width / 2;
        sprite.y += height / 2;
        sprite.rotation = style.rotation;
      }
    }
    return;
  }
  const kind = resolveBeMusicLaneKind(channel, laneIndex, ctx.play.chartPlayVariant);
  const binding = ctx.skinBinding;
  if (binding) {
    binding.addNote({
      kind,
      x: lane.x - (size?.w ?? 0) / 2,
      w: Math.max(0, lane.w + (size?.w ?? 0)),
      y,
      ...(alpha !== 1 ? { alpha } : {}),
      autoplay: ctx.play.isAutoplayedChannel(channel),
    });
    return;
  }
  const graphic = ctx.noteLayerPool.acquireGraphics();
  graphic.label = drawLabel(ctx, 'note-fallback', laneIndex, channel);
  renderDefaultNote({
    graphics: graphic,
    kind,
    x: lane.x - (size?.w ?? 0) / 2,
    w: Math.max(0, lane.w + (size?.w ?? 0)),
    y,
    nowMs: ctx.play.playClock(),
  });
  if (style?.tint !== undefined) graphic.tint = style.tint;
}
