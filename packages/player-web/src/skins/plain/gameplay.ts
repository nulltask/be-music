import {
  flashingGreatColor,
  isFlashingGreat,
  judgeDisplayWord,
  loadingDots,
  resolveLaneRuns,
  type BeMusicGameplayFrame,
  type BeMusicGameplayRuntime,
  type BeMusicSurface,
} from '@be-music/skin-sdk';
import {
  ACCENT,
  DANGER,
  FLASHING_GREAT,
  INK,
  LANE_FILL,
  LINE,
  MUTED,
  NOTE_FILL,
  PANEL,
  TEXT,
  css,
  stat,
  text,
} from './theme.ts';
import { resolvePortraitGameplayHud } from './layout.ts';

const NOTE_HEIGHT = 6;
/** LR2's opacity for a long note missed at the head or let go early (`0x80` of `0xff`). */
const DROPPED_LONG_NOTE_ALPHA = 0x80 / 0xff;
/** Top of the right-hand judgement column: level with the BGA band's top, whatever size the BGA takes. */
const COLUMN_TOP = 66;
const MARGIN = 16;

/**
 * The play screen. Landscape: lanes and notes on the left, the BGA beside them, the HUD around them. Portrait: the host
 * puts the lanes across the lower part of the stage and the BGA at the top left; the HUD fills the band above the lanes
 * (see {@link resolvePortraitGameplayHud}). The lanes, notes, bombs and BGA are drawn the same way in both — they come
 * placed in `frame.layout` — so only the HUD and the judgement's height depend on `layout.orientation`.
 */
export function drawGameplay({ context: ctx, width, height }: BeMusicSurface<'2d'>, frame: BeMusicGameplayFrame): void {
  const { layout, runtime } = frame;
  const portrait = layout.orientation === 'portrait';

  // Background. The BGA plays *behind* this canvas, so its rect is cut out rather than painted over.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);
  const bga = layout.bga;
  if (bga) {
    if (runtime.hasBga) {
      ctx.clearRect(bga.x, bga.y, bga.w, bga.h);
    } else {
      ctx.fillStyle = PANEL;
      ctx.fillRect(bga.x, bga.y, bga.w, bga.h);
      text(ctx, 'SOUND ONLY', bga.x + bga.w / 2, bga.y + bga.h / 2, { size: 12, color: MUTED, align: 'center' });
    }
    ctx.strokeStyle = LINE;
    ctx.strokeRect(bga.x - 0.5, bga.y - 0.5, bga.w + 1, bga.h + 1);
  }

  drawLanes(ctx, frame);
  drawNotes(ctx, frame);
  drawBombs(ctx, frame);
  if (portrait) {
    const hud = resolvePortraitGameplayHud(layout);
    drawJudgement(ctx, frame, hud.judgeY);
    drawPortraitHud(ctx, frame, hud);
  } else {
    drawJudgement(ctx, frame, 220);
    drawHud(ctx, frame, width, height);
  }
}

/** Lane backgrounds, a light column for each held key, and the judgement line. */
function drawLanes(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame): void {
  for (const lane of frame.lanes) {
    ctx.fillStyle = LANE_FILL[lane.kind];
    ctx.fillRect(lane.x, lane.top, lane.w, lane.bottom - lane.top);
    if (lane.beam > 0) {
      // One gradient serves every lane; how bright the beam is comes from the alpha.
      ctx.fillStyle = beamGradient(ctx, lane.top, lane.bottom);
      ctx.globalAlpha = lane.beam;
      ctx.fillRect(lane.x, lane.top, lane.w, lane.bottom - lane.top);
      ctx.globalAlpha = 1;
    }
    if (lane.kind === 'wheel-up' || lane.kind === 'wheel-down') {
      drawWheelArrow(ctx, lane.x + lane.w / 2, lane.bottom - 12, Math.min(4, lane.w / 3), lane.kind === 'wheel-up');
    }
  }
  // One judgement line per play side, so it never crosses the gap between the double-play banks.
  ctx.fillStyle = DANGER;
  for (const run of resolveLaneRuns(frame.lanes)) {
    ctx.fillRect(run.left, frame.layout.playfield.judgementY, run.right - run.left, 2);
  }
}

/** A small triangle under a wheel lane's notes, pointing the way that lane turns the wheel. */
function drawWheelArrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, up: boolean): void {
  const tip = up ? -size : size;
  ctx.fillStyle = MUTED;
  ctx.beginPath();
  ctx.moveTo(x, y + tip);
  ctx.lineTo(x - size, y - tip);
  ctx.lineTo(x + size, y - tip);
  ctx.closePath();
  ctx.fill();
}

const BEAM_GRADIENTS = new WeakMap<
  CanvasRenderingContext2D,
  { top: number; bottom: number; gradient: CanvasGradient }
>();

/** The key-beam gradient (clear at the top, blue at the judgement line), made once per context and lane height. */
function beamGradient(ctx: CanvasRenderingContext2D, top: number, bottom: number): CanvasGradient {
  const cached = BEAM_GRADIENTS.get(ctx);
  if (cached && cached.top === top && cached.bottom === bottom) return cached.gradient;
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, 'rgba(61, 123, 255, 0)');
  gradient.addColorStop(1, 'rgba(61, 123, 255, 0.45)');
  BEAM_GRADIENTS.set(ctx, { top, bottom, gradient });
  return gradient;
}

/**
 * Tap notes as flat bars. Long notes: a translucent body with a white centre line between the head and tail bars, the
 * shape every built-in skin uses. A long note missed at the head or let go early draws at LR2's half alpha.
 */
function drawNotes(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame): void {
  for (const note of frame.longNotes) {
    const alpha = note.state === 'dropped' ? DROPPED_LONG_NOTE_ALPHA : 1;
    const bodyTop = note.top - NOTE_HEIGHT;
    const bodyHeight = Math.max(1, note.bottom - note.top);
    ctx.fillStyle = NOTE_FILL[note.kind];
    ctx.globalAlpha = 0.25 * alpha;
    ctx.fillRect(note.x + 1, bodyTop, note.w - 2, bodyHeight);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.6 * alpha;
    ctx.fillRect(note.x + note.w / 2 - 1, bodyTop, 2, bodyHeight);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = NOTE_FILL[note.kind];
    ctx.fillRect(note.x, note.top - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
    ctx.fillRect(note.x, note.bottom - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
    ctx.globalAlpha = 1;
  }
  for (const note of frame.notes) {
    ctx.fillStyle = NOTE_FILL[note.kind];
    ctx.fillRect(note.x, note.y - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
  }
}

/** Each hit draws a ring that widens and fades over the effect's lifetime. */
function drawBombs(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame): void {
  for (const bomb of frame.bombs) {
    const t = Math.min(1, bomb.elapsedMs / 300);
    ctx.strokeStyle = `rgba(255, 255, 255, ${1 - t})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bomb.x + bomb.w / 2, bomb.y, 6 + 18 * t, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** The latest judgement and combo over each play side, centred on `y` — or NOW LOADING while the chart loads. */
function drawJudgement(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame, y: number): void {
  const { runtime, layout, nowMs } = frame;
  if (runtime.loading) {
    text(ctx, `NOW LOADING${loadingDots(nowMs)}`, layout.playfield.left + 12, y, { size: 13, color: MUTED });
    return;
  }
  for (const side of runtime.judgeSides ?? []) {
    if (!side.judge) continue;
    const bounds = layout.playfield.sides[side.side];
    const x = bounds ? (bounds.left + bounds.right) / 2 : layout.playfield.centerX;
    const color = isFlashingGreat(side.judge) ? css(flashingGreatColor(nowMs, FLASHING_GREAT)) : judgeColor(side.judge);
    text(ctx, judgeDisplayWord(side.judge), x, y, { size: 20, weight: 800, color, align: 'center' });
    const combo = side.combo ?? 0;
    const keepsCombo = side.judge === 'PERFECT' || side.judge === 'GREAT' || side.judge === 'GOOD';
    if (keepsCombo && combo > 0) text(ctx, String(combo), x, y + 24, { size: 16, align: 'center' });
  }
}

function judgeColor(judge: string): string {
  if (judge === 'GOOD') return ACCENT;
  if (judge === 'BAD' || judge === 'POOR') return DANGER;
  return TEXT;
}

/** Header (mode, tempo, speed), the gauge under the lanes, the track and the score figures along the bottom. */
function drawHud(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame, width: number, height: number): void {
  const { runtime, nowMs } = frame;

  text(ctx, runtime.autoplay ? 'AUTO PLAY' : 'PLAY', MARGIN, 18, { size: 12, weight: 800, color: ACCENT });
  text(ctx, `BPM ${Math.round(runtime.bpm ?? 0)}   SPEED x${(runtime.hiSpeed ?? 0).toFixed(1)}`, 110, 18, {
    size: 12,
    color: MUTED,
  });

  // Gauge: a bar under the lanes with a tick at the clear line.
  drawGauge(ctx, runtime, MARGIN, 372, 240, 9);

  // Track, bottom left.
  // Genre, title, artist — the order every built-in skin uses.
  if (runtime.songGenre) {
    text(ctx, runtime.songGenre, MARGIN, height - 70, { size: 10, color: MUTED, maxWidth: 380, nowMs });
  }
  text(ctx, runtime.songTitle ?? '', MARGIN, height - 50, { size: 16, weight: 700, maxWidth: 380, nowMs });
  text(ctx, runtime.songArtist ?? '', MARGIN, height - 28, { size: 11, color: MUTED, maxWidth: 380, nowMs });

  // Score figures, bottom right, in one row.
  scoreFigures(runtime).forEach(([label, value], index) => {
    stat(ctx, label, value, width - MARGIN - 400 + index * 106, height - 56, { maxWidth: 98, nowMs });
  });

  // Judgement counts down the right edge, beside the BGA.
  const columnX = width - MARGIN - 80;
  judgeCounts(runtime).forEach(([label, count], index) => {
    const y = COLUMN_TOP + index * 22;
    text(ctx, label, columnX, y, { size: 11, color: MUTED, weight: 700 });
    text(ctx, String(count ?? 0), columnX + 80, y, { size: 13, align: 'right' });
  });
}

/** The gauge bar (`y` its top, 8 px tall) with a tick at the clear line, its label and percentage on the line above. */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  runtime: BeMusicGameplayRuntime,
  x: number,
  y: number,
  w: number,
  labelSize: number,
): void {
  const gauge = Math.max(0, Math.min(100, runtime.gauge ?? 0));
  const clear = runtime.clearThreshold ?? 80;
  text(ctx, `${runtime.gaugeLabel ?? 'GROOVE'} GAUGE`, x, y - 10, { size: labelSize, color: MUTED, weight: 700 });
  text(ctx, `${Math.round(gauge)}%`, x + w, y - 10, { size: 12, align: 'right' });
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, 8);
  ctx.fillStyle = gauge >= clear ? DANGER : ACCENT;
  ctx.fillRect(x, y, (w * gauge) / 100, 8);
  ctx.fillStyle = TEXT;
  ctx.fillRect(x + (w * clear) / 100, y - 3, 1, 14);
}

/** SCORE, EX SCORE, COMBO, RANK — the figures both HUDs show. */
function scoreFigures(runtime: BeMusicGameplayRuntime): Array<[string, string]> {
  return [
    ['SCORE', String(runtime.score ?? 0)],
    ['EX SCORE', `${runtime.exScore ?? 0}/${runtime.exScoreMax ?? 0}`],
    ['COMBO', String(runtime.combo ?? 0)],
    ['RANK', runtime.rank ?? '-'],
  ];
}

/** The judgement counts, abbreviated. */
function judgeCounts(runtime: BeMusicGameplayRuntime): Array<[string, number | undefined]> {
  return [
    ['PG', runtime.perfect],
    ['GR', runtime.great],
    ['GD', runtime.good],
    ['BD', runtime.bad],
    ['PR', runtime.poor],
  ];
}

/**
 * The portrait HUD, everything above the lanes: the header band (mode, tempo, speed — clear of the top corners, where a
 * host may put its pause button and menu), the column beside the BGA (track, score figures, judgement counts), and the
 * gauge across the stage just above the lanes. Nothing is smaller than 10 px.
 */
function drawPortraitHud(
  ctx: CanvasRenderingContext2D,
  frame: BeMusicGameplayFrame,
  hud: ReturnType<typeof resolvePortraitGameplayHud>,
): void {
  const { runtime, nowMs } = frame;
  const { header, track, scores, counts, gauge } = hud;

  const headerY = header.height / 2;
  text(ctx, runtime.autoplay ? 'AUTO PLAY' : 'PLAY', header.left, headerY, { size: 12, weight: 800, color: ACCENT });
  text(
    ctx,
    `BPM ${Math.round(runtime.bpm ?? 0)}   SPEED x${(runtime.hiSpeed ?? 0).toFixed(1)}`,
    header.right,
    headerY,
    {
      size: 12,
      color: MUTED,
      align: 'right',
      maxWidth: header.right - header.left - 100,
    },
  );

  // Genre, title, artist — the order every built-in skin uses — at the top of the column.
  const lift = runtime.songGenre ? 12 : 0;
  const textW = track.w;
  if (runtime.songGenre) {
    text(ctx, runtime.songGenre, track.x, track.y + 8, { size: 10, color: MUTED, maxWidth: textW, nowMs });
  }
  text(ctx, runtime.songTitle ?? '', track.x, track.y + 14 + lift, { size: 16, weight: 700, maxWidth: textW, nowMs });
  text(ctx, runtime.songArtist ?? '', track.x, track.y + 34 + lift, { size: 11, color: MUTED, maxWidth: textW, nowMs });

  // Score figures, two by two.
  scoreFigures(runtime).forEach(([label, value], index) => {
    const box = scores[index]!;
    stat(ctx, label, value, box.x, box.y, { maxWidth: box.w - 8, nowMs, labelSize: 10 });
  });

  // Judgement counts in one row: label over count.
  judgeCounts(runtime).forEach(([label, count], index) => {
    const box = counts[index]!;
    text(ctx, label, box.x, box.y, { size: 10, color: MUTED, weight: 700 });
    text(ctx, String(count ?? 0), box.x, box.y + 16, { size: 13, maxWidth: box.w - 6 });
  });

  drawGauge(ctx, runtime, gauge.x, gauge.y, gauge.w, 10);
}
