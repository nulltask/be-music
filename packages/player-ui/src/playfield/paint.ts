import { layoutTabularRun, type BeMusicLaneKind, type BeMusicRect } from '@be-music/player-skin-sdk';
import type {
  BeMusicBGAData,
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
  | 'measureText'
  | 'beginPath'
  | 'arc'
  | 'rect'
  | 'stroke'
  | 'clip'
  | 'save'
  | 'restore'
  | 'drawImage'
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

/** The BMS BGA canvas the BGA rect stands for. */
const BGA_CANVAS_SIZE = 256;

/**
 * The BGA as BMS players composite it: the POOR image in place of the base and layer while a POOR shows, the base
 * opaque over black, the layer over it. A still image whose long edge fits the 256x256 BGA canvas keeps its size there,
 * centered horizontally against the top edge; a larger image or a video fills the rect.
 */
export function paintBGA(ctx: BeMusicPlayfieldPaintContext, data: BeMusicBGAData, rect: BeMusicRect): void {
  if (!data.shown) return;
  ctx.fillStyle = '#000000';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const frame = data.frame;
  if (!frame) return;
  const inheritedAlpha = ctx.globalAlpha;
  for (const stack of frame.stacks ?? [frame]) {
    const alpha = inheritedAlpha * ('alpha' in stack ? stack.alpha : 1);
    const draw = (track: 'base' | 'layer' | 'layer2' | 'poor'): void => {
      const image = stack[track];
      if (!image) return;
      ctx.globalAlpha = alpha * (stack.opacity?.[track] ?? 1);
      drawBGAImage(
        ctx,
        image,
        rect,
        frame.stacks !== undefined && (track === 'base' || (track === 'poor' && !stack.poorOverlays)),
        stack.origins?.[track],
      );
    };
    if (stack.poorActive && !stack.poorOverlays) draw('poor');
    else {
      draw('base');
      draw('layer');
      draw('layer2');
      if (stack.poorActive && stack.poorOverlays) draw('poor');
    }
  }
  ctx.globalAlpha = inheritedAlpha;
}

/** Where `image` of `width` x `height` goes in the BGA `rect` (see {@link paintBGA}). */
export function placeBGAImage(
  width: number,
  height: number,
  isVideo: boolean,
  rect: BeMusicRect,
  origin?: { x: number; y: number },
): BeMusicRect {
  if (isVideo || !(width > 0) || !(height > 0) || Math.max(width, height) > BGA_CANVAS_SIZE) return { ...rect };
  const scaleX = rect.w / BGA_CANVAS_SIZE;
  const scaleY = rect.h / BGA_CANVAS_SIZE;
  return {
    x: rect.x + (origin?.x ?? Math.floor((BGA_CANVAS_SIZE - width) / 2)) * scaleX,
    y: rect.y + (origin?.y ?? 0) * scaleY,
    w: width * scaleX,
    h: height * scaleY,
  };
}

function drawBGAImage(
  ctx: BeMusicPlayfieldPaintContext,
  image: CanvasImageSource,
  rect: BeMusicRect,
  fillCanvas = false,
  origin?: { x: number; y: number },
): void {
  const { width, height, isVideo } = imageSize(image);
  const placed = placeBGAImage(width, height, isVideo, rect, origin);
  if (fillCanvas && (placed.w < rect.w || placed.h < rect.h)) ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.drawImage(image, placed.x, placed.y, placed.w, placed.h);
}

function imageSize(image: CanvasImageSource): { width: number; height: number; isVideo: boolean } {
  if ('videoWidth' in image) return { width: image.videoWidth, height: image.videoHeight, isVideo: true };
  if ('displayWidth' in image) return { width: image.displayWidth, height: image.displayHeight, isVideo: true };
  if ('naturalWidth' in image) return { width: image.naturalWidth, height: image.naturalHeight, isVideo: false };
  const { width, height } = image as { width: unknown; height: unknown };
  return {
    width: typeof width === 'number' ? width : 0,
    height: typeof height === 'number' ? height : 0,
    isVideo: false,
  };
}

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
  for (const line of data.measureLines) {
    ctx.globalAlpha = 0.25 * (line.alpha ?? 1);
    ctx.fillRect(line.x, line.y - 1, line.w, 1);
  }
  ctx.globalAlpha = 1;
  for (const note of data.longNotes) {
    ctx.fillStyle = NOTE_COLORS[note.kind];
    ctx.globalAlpha = (note.state === 'dropped' ? 0.15 : 0.35) * (note.alpha ?? 1);
    ctx.fillRect(note.x, note.top - NOTE_HEIGHT, note.w, Math.max(1, note.bottom - note.top));
    ctx.globalAlpha = (note.state === 'dropped' ? 0.5 : 1) * (note.alpha ?? 1);
    ctx.fillRect(note.x, note.bottom - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
    if (note.mode === 'ln') ctx.globalAlpha *= 0.4;
    ctx.fillRect(note.x, note.top - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
    ctx.globalAlpha = 1;
  }
  for (const note of data.notes) {
    ctx.globalAlpha = note.alpha ?? 1;
    ctx.fillStyle = NOTE_COLORS[note.kind];
    ctx.fillRect(note.x, note.y - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
  }
  // A mine reads as something to avoid: a red bar with a dark core, unlike any playable note.
  for (const mine of data.mines) {
    ctx.globalAlpha = mine.alpha ?? 1;
    ctx.fillStyle = '#ff5c6c';
    ctx.fillRect(mine.x, mine.y - NOTE_HEIGHT, mine.w, NOTE_HEIGHT);
    ctx.fillStyle = '#10151f';
    ctx.fillRect(mine.x + 2, mine.y - NOTE_HEIGHT + 2, Math.max(0, mine.w - 4), NOTE_HEIGHT - 4);
  }
  ctx.globalAlpha = 1;
}

export function paintLaneCovers(ctx: BeMusicPlayfieldPaintContext, { areas }: BeMusicLaneCoversData): void {
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 0.92;
  for (const area of areas) {
    const width = area.right - area.left;
    const height = area.bottom - area.top;
    if (area.sudden > 0) ctx.fillRect(area.left, area.top, width, height * area.sudden);
    if (area.hidden > 0)
      ctx.fillRect(area.left, area.bottom - height * ((area.lift ?? 0) + area.hidden), width, height * area.hidden);
    if ((area.lift ?? 0) > 0) {
      ctx.globalAlpha = 1;
      ctx.fillRect(area.left, area.bottom - height * area.lift!, width, height * area.lift!);
      ctx.globalAlpha = 0.92;
    }
  }
  ctx.globalAlpha = 1;
}

export function paintJudgeLine(ctx: BeMusicPlayfieldPaintContext, { runs, y }: BeMusicJudgeLineData): void {
  ctx.fillStyle = '#ffa8b3';
  for (const run of runs) ctx.fillRect(run.left, run.y ?? y, run.right - run.left, 2);
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

const JUDGMENT_FONT = 'bold 20px system-ui';
const COMBO_FONT = '600 16px system-ui';
const COMBO_OFFSET = 24;
const COMBO_COLOR = '#e5efff';

export function paintJudgmentDisplay(
  ctx: BeMusicPlayfieldPaintContext,
  { words, y }: BeMusicJudgmentDisplayData,
): void {
  ctx.textAlign = 'center';
  for (const word of words) {
    ctx.font = JUDGMENT_FONT;
    ctx.fillStyle = word.color;
    ctx.fillText(word.text, word.x, word.y ?? y);
    if (word.combo !== undefined && word.combo > 0) {
      ctx.font = COMBO_FONT;
      ctx.fillStyle = COMBO_COLOR;
      paintTabular(ctx, String(word.combo), word.x, (word.y ?? y) + COMBO_OFFSET);
    }
  }
}

/**
 * Digits in fixed-width cells, the run centred on `x`. Canvas 2D exposes no `font-feature-settings`, so OpenType
 * `tnum` cannot be turned on; each digit takes the widest digit's advance instead.
 */
function paintTabular(ctx: BeMusicPlayfieldPaintContext, text: string, x: number, y: number): void {
  const run = layoutTabularRun(text, (char) => ctx.measureText(char).width);
  const left = x - run.width / 2;
  const align = ctx.textAlign;
  ctx.textAlign = 'center';
  for (const glyph of run.glyphs) ctx.fillText(glyph.char, left + glyph.x + glyph.w / 2, y);
  ctx.textAlign = align;
}

/** Paints every part on one stage-sized surface, each clipped to its rect as its own canvas would clip it. */
export function paintPlayfieldParts(ctx: BeMusicPlayfieldPaintContext, parts: BeMusicPlayfieldParts): void {
  clipped(ctx, parts.bga.rect, () => paintBGA(ctx, parts.bga.data, parts.bga.rect));
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
