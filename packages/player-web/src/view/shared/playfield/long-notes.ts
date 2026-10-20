/** The long notes of the shared playfield: one long note's body and caps. */

import { resolveLongNoteAlpha } from '../../../chart/note-draw-window.ts';
import { resolveBeMusicLaneKind } from '../../../skin/be-music/registry.ts';
import { renderPhantomLongNote } from '../../../skins/phantom/playfield.ts';
import type { PlayfieldLaneRect } from '../../types.ts';
import type { PlayfieldContext, RuntimeNote } from './context.ts';

/**
 * Renders a long note as a vertical band: LN_BODY tiled (or stretched) between LN_START (lower) and LN_END (upper).
 * The body / caps come from the skin by channel when it draws them (`PlayfieldSkin.noteCell`); otherwise the
 * body falls back to the be-music skin's long-note drawing. A long note missed at the head or let go early draws at
 * half alpha until it goes, as in LR2 ({@link resolveLongNoteAlpha}); a be-music skin gets its `state` and dims it
 * itself.
 */
export function renderLongNote(
  ctx: PlayfieldContext,
  laneIndex: number,
  note: RuntimeNote,
  lane: PlayfieldLaneRect,
  yStart: number,
  yEnd: number,
  drawBottom: number,
): void {
  const channel = note.channel;
  const state = ctx.play.longNotes.stateOf(channel, note.beat, note.judged);
  const alpha = resolveLongNoteAlpha(state);
  // `yStart` / `yEnd` are the chart-time intersections with the judgement line. With the bottom-edge anchor
  // convention (matching LR2 / BMS): - LN_START's *bottom edge* sits at `yStart` (just-timing of the head) - LN_END's
  // *bottom edge* sits at `yEnd` (just-timing of the tail) The body fills the band between them; we clamp the bottom
  // to `drawBottom` — the judgement-line bottom (= `lane.bottom`) unless beatoraja's rules let a long note a negative
  // `#SCROLL` puts below the line draw there — so the body never paints over the keys area below the line, even mid-LN
  // where the head has already passed but the tail is still above.
  const top = Math.max(lane.top - ctx.noteOverscan, Math.min(yStart, yEnd));
  const bottom = Math.min(drawBottom, Math.max(yStart, yEnd));
  const bodyCell = ctx.playfieldSkin.noteCell('lnbody', channel);
  if (bodyCell) {
    if (bodyCell.texture) {
      const sprite = ctx.noteLayerPool.acquireSprite();
      sprite.texture = bodyCell.texture;
      sprite.label = `ln-body[lane=${laneIndex},ch=${channel}]`;
      sprite.x = lane.x + (lane.w - bodyCell.width) / 2;
      // Shift the body up by one cell-height so the body's bottom edge aligns with the LN_START's bottom edge (=
      // judgement line at the head's just-timing). Without this, the body sticks out ~half a note below the line at
      // perfect timing.
      sprite.y = top - bodyCell.height;
      sprite.width = bodyCell.width;
      sprite.height = Math.max(1, bottom - top);
      sprite.alpha = alpha;
    }
  } else {
    const kind = resolveBeMusicLaneKind(channel, laneIndex, ctx.play.chartPlayVariant);
    const binding = ctx.skinBinding;
    if (binding) {
      binding.addLongNote({
        kind,
        x: lane.x,
        w: lane.w,
        top,
        bottom,
        mode: ctx.play.resolveLongNoteMode(note),
        state,
        autoplay: ctx.play.isAutoplayedChannel(channel),
      });
    } else {
      const graphic = ctx.noteLayerPool.acquireGraphics();
      graphic.label = `ln-body-fallback[lane=${laneIndex},ch=${channel}]`;
      renderPhantomLongNote({
        graphics: graphic,
        kind,
        x: lane.x,
        w: lane.w,
        top,
        bottom,
        nowMs: ctx.play.playClock(),
      });
      graphic.alpha = alpha;
    }
  }
  // LN_END at the top (yEnd), LN_START at the bottom (yStart).
  const endCell = ctx.playfieldSkin.noteCell('lnend', channel);
  if (endCell?.texture) {
    const sprite = ctx.noteLayerPool.acquireSprite();
    sprite.texture = endCell.texture;
    sprite.label = `ln-end[lane=${laneIndex},ch=${channel}]`;
    sprite.x = lane.x + (lane.w - endCell.width) / 2;
    sprite.y = yEnd - endCell.height;
    sprite.width = endCell.width;
    sprite.height = endCell.height;
    sprite.alpha = alpha;
  }
  // The head draws wherever it is above the draw bottom: on the judgement line once passed (both rule sets hold it
  // there), and under beatoraja's rules skipped while a negative `#SCROLL` has it below the stage.
  if (yStart <= drawBottom) {
    const startCell = ctx.playfieldSkin.noteCell('lnstart', channel);
    if (startCell?.texture) {
      const sprite = ctx.noteLayerPool.acquireSprite();
      sprite.texture = startCell.texture;
      sprite.label = `ln-start[lane=${laneIndex},ch=${channel}]`;
      sprite.x = lane.x + (lane.w - startCell.width) / 2;
      sprite.y = yStart - startCell.height;
      sprite.width = startCell.width;
      sprite.height = startCell.height;
      sprite.alpha = alpha;
    }
  }
}
