import type { BeMusicLaneKind, BeMusicRect } from '@be-music/player-skin-sdk';
import type {
  BeMusicBombsData,
  BeMusicJudgeLineData,
  BeMusicJudgmentDisplayData,
  BeMusicLaneCoversData,
  BeMusicLanesData,
  BeMusicNotesData,
  BeMusicPlayfieldParts,
} from '../models.ts';

/** The Canvas 2D calls the playfield painters make; a `CanvasRenderingContext2D` satisfies it. */
export type BeMusicPlayfieldPaintContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'globalAlpha'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'fillRect'
  | 'fillText'
  | 'beginPath'
  | 'arc'
  | 'rect'
  | 'stroke'
  | 'clip'
  | 'save'
  | 'restore'
>;

const NOTE_COLORS: Record<BeMusicLaneKind, string> = {
  white: '#e5efff',
  black: '#88b9ff',
  scratch: '#ffa8b3',
  'wheel-up': '#ffa8b3',
  'wheel-down': '#ffa8b3',
};
const NOTE_HEIGHT = 6;
const BOMB_LIFETIME_MS = 300;

export function paintLanes(ctx: BeMusicPlayfieldPaintContext, { lanes }: BeMusicLanesData): void {
  for (const lane of lanes) {
    const height = lane.bottom - lane.top;
    ctx.fillStyle = lane.kind === 'white' ? '#202d40' : '#152031';
    ctx.fillRect(lane.x, lane.top, lane.w, height);
    if (lane.beam > 0) {
      ctx.fillStyle = NOTE_COLORS[lane.kind];
      ctx.globalAlpha = lane.beam * 0.3;
      ctx.fillRect(lane.x, lane.top, lane.w, height);
      ctx.globalAlpha = 1;
    }
    if (lane.holding) {
      ctx.fillStyle = '#abcaff';
      ctx.fillRect(lane.x, lane.bottom - 4, lane.w, 4);
    }
  }
}

export function paintNotes(ctx: BeMusicPlayfieldPaintContext, data: BeMusicNotesData): void {
  ctx.fillStyle = '#e5efff';
  ctx.globalAlpha = 0.25;
  for (const line of data.measureLines) ctx.fillRect(line.x, line.y - 1, line.w, 1);
  ctx.globalAlpha = 1;
  for (const note of data.longNotes) {
    ctx.fillStyle = NOTE_COLORS[note.kind];
    ctx.globalAlpha = note.state === 'dropped' ? 0.15 : 0.35;
    ctx.fillRect(note.x, note.top - NOTE_HEIGHT, note.w, Math.max(1, note.bottom - note.top));
    ctx.globalAlpha = note.state === 'dropped' ? 0.5 : 1;
    ctx.fillRect(note.x, note.bottom - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
    if (note.mode === 'ln') ctx.globalAlpha *= 0.4;
    ctx.fillRect(note.x, note.top - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
    ctx.globalAlpha = 1;
  }
  for (const note of data.notes) {
    ctx.fillStyle = NOTE_COLORS[note.kind];
    ctx.fillRect(note.x, note.y - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
  }
  // A mine reads as something to avoid: a red bar with a dark core, unlike any playable note.
  for (const mine of data.mines) {
    ctx.fillStyle = '#ff5c6c';
    ctx.fillRect(mine.x, mine.y - NOTE_HEIGHT, mine.w, NOTE_HEIGHT);
    ctx.fillStyle = '#10151f';
    ctx.fillRect(mine.x + 2, mine.y - NOTE_HEIGHT + 2, Math.max(0, mine.w - 4), NOTE_HEIGHT - 4);
  }
}

export function paintLaneCovers(ctx: BeMusicPlayfieldPaintContext, { areas }: BeMusicLaneCoversData): void {
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 0.92;
  for (const area of areas) {
    const width = area.right - area.left;
    const height = area.bottom - area.top;
    if (area.sudden > 0) ctx.fillRect(area.left, area.top, width, height * area.sudden);
    if (area.hidden > 0) ctx.fillRect(area.left, area.bottom - height * area.hidden, width, height * area.hidden);
  }
  ctx.globalAlpha = 1;
}

export function paintJudgeLine(ctx: BeMusicPlayfieldPaintContext, { runs, y }: BeMusicJudgeLineData): void {
  ctx.fillStyle = '#ffa8b3';
  for (const run of runs) ctx.fillRect(run.left, y, run.right - run.left, 2);
}

export function paintBombs(ctx: BeMusicPlayfieldPaintContext, { bombs }: BeMusicBombsData): void {
  ctx.strokeStyle = '#e5efff';
  ctx.lineWidth = 2;
  for (const bomb of bombs) {
    const age = Math.min(1, bomb.elapsedMs / BOMB_LIFETIME_MS);
    ctx.globalAlpha = 1 - age;
    ctx.beginPath();
    ctx.arc(bomb.x + bomb.w / 2, bomb.y, 5 + age * 20, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function paintJudgmentDisplay(
  ctx: BeMusicPlayfieldPaintContext,
  { words, y }: BeMusicJudgmentDisplayData,
): void {
  ctx.font = 'bold 20px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e5efff';
  for (const word of words) ctx.fillText(word.text, word.x, y);
}

/** Paints every part on one stage-sized surface, each clipped to its rect as its own canvas would clip it. */
export function paintPlayfieldParts(ctx: BeMusicPlayfieldPaintContext, parts: BeMusicPlayfieldParts): void {
  clipped(ctx, parts.lanes.rect, () => paintLanes(ctx, parts.lanes.data));
  clipped(ctx, parts.notes.rect, () => paintNotes(ctx, parts.notes.data));
  clipped(ctx, parts.laneCovers.rect, () => paintLaneCovers(ctx, parts.laneCovers.data));
  clipped(ctx, parts.judgeLine.rect, () => paintJudgeLine(ctx, parts.judgeLine.data));
  clipped(ctx, parts.bombs.rect, () => paintBombs(ctx, parts.bombs.data));
  clipped(ctx, parts.judgmentDisplay.rect, () => paintJudgmentDisplay(ctx, parts.judgmentDisplay.data));
}

function clipped(ctx: BeMusicPlayfieldPaintContext, rect: BeMusicRect, paint: () => void): void {
  if (rect.w <= 0 || rect.h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  paint();
  ctx.restore();
}
