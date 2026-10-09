import {
  flashingGreatColor,
  isFlashingGreat,
  judgeDisplayWord,
  loadingDots,
  resolveLaneRuns,
  type BeMusicGameplayFrame,
  type BeMusicSurface,
} from '../../skin-sdk/index.ts';
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

const NOTE_HEIGHT = 6;
/** Top of the right-hand judgement column: level with the BGA band's top, whatever size the BGA takes. */
const COLUMN_TOP = 66;
const MARGIN = 16;

/** The play screen: lanes and notes on the left, the BGA beside them, the HUD around them. */
export function drawGameplay({ context: ctx, width, height }: BeMusicSurface<'2d'>, frame: BeMusicGameplayFrame): void {
  const { layout, runtime } = frame;

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
      text(ctx, 'NO BGA', bga.x + bga.w / 2, bga.y + bga.h / 2, { size: 12, color: MUTED, align: 'center' });
    }
    ctx.strokeStyle = LINE;
    ctx.strokeRect(bga.x - 0.5, bga.y - 0.5, bga.w + 1, bga.h + 1);
  }

  drawLanes(ctx, frame);
  drawNotes(ctx, frame);
  drawBombs(ctx, frame);
  drawJudgement(ctx, frame);
  drawHud(ctx, frame, width, height);
}

/** Lane backgrounds, a light column for each held key, and the judgement line. */
function drawLanes(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame): void {
  for (const lane of frame.lanes) {
    ctx.fillStyle = LANE_FILL[lane.kind];
    ctx.fillRect(lane.x, lane.top, lane.w, lane.bottom - lane.top);
    if (lane.beam > 0) {
      const beam = ctx.createLinearGradient(0, lane.top, 0, lane.bottom);
      beam.addColorStop(0, 'rgba(61, 123, 255, 0)');
      beam.addColorStop(1, `rgba(61, 123, 255, ${0.45 * lane.beam})`);
      ctx.fillStyle = beam;
      ctx.fillRect(lane.x, lane.top, lane.w, lane.bottom - lane.top);
    }
  }
  // One judgement line per play side, so it never crosses the gap between the double-play banks.
  ctx.fillStyle = DANGER;
  for (const run of resolveLaneRuns(frame.lanes)) {
    ctx.fillRect(run.left, frame.layout.playfield.judgementY, run.right - run.left, 2);
  }
}

/**
 * Tap notes as flat bars. Long notes: a translucent body with a white centre line between the head and tail bars, the
 * shape every built-in skin uses.
 */
function drawNotes(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame): void {
  for (const note of frame.longNotes) {
    const bodyTop = note.top - NOTE_HEIGHT;
    const bodyHeight = Math.max(1, note.bottom - note.top);
    ctx.fillStyle = NOTE_FILL[note.kind];
    ctx.globalAlpha = 0.25;
    ctx.fillRect(note.x + 1, bodyTop, note.w - 2, bodyHeight);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.6;
    ctx.fillRect(note.x + note.w / 2 - 1, bodyTop, 2, bodyHeight);
    ctx.globalAlpha = 1;
    ctx.fillStyle = NOTE_FILL[note.kind];
    ctx.fillRect(note.x, note.top - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
    ctx.fillRect(note.x, note.bottom - NOTE_HEIGHT, note.w, NOTE_HEIGHT);
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

/** The latest judgement and combo over each play side — or NOW LOADING while the chart loads. */
function drawJudgement(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame): void {
  const { runtime, layout, nowMs } = frame;
  const y = 220;
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
  const { runtime } = frame;

  text(ctx, runtime.autoplay ? 'AUTO PLAY' : 'PLAY', MARGIN, 18, { size: 12, weight: 800, color: ACCENT });
  text(ctx, `BPM ${Math.round(runtime.bpm ?? 0)}   SPEED x${(runtime.hiSpeed ?? 0).toFixed(1)}`, 110, 18, {
    size: 12,
    color: MUTED,
  });

  // Gauge: a bar under the lanes with a tick at the clear line.
  const gaugeX = MARGIN;
  const gaugeY = 372;
  const gaugeW = 240;
  const gauge = Math.max(0, Math.min(100, runtime.gauge ?? 0));
  const clear = runtime.clearThreshold ?? 80;
  text(ctx, `${runtime.gaugeLabel ?? 'GROOVE'} GAUGE`, gaugeX, gaugeY - 10, { size: 9, color: MUTED, weight: 700 });
  text(ctx, `${Math.round(gauge)}%`, gaugeX + gaugeW, gaugeY - 10, { size: 12, align: 'right' });
  ctx.fillStyle = PANEL;
  ctx.fillRect(gaugeX, gaugeY, gaugeW, 8);
  ctx.fillStyle = gauge >= clear ? DANGER : ACCENT;
  ctx.fillRect(gaugeX, gaugeY, (gaugeW * gauge) / 100, 8);
  ctx.fillStyle = TEXT;
  ctx.fillRect(gaugeX + (gaugeW * clear) / 100, gaugeY - 3, 1, 14);

  // Track, bottom left.
  text(ctx, runtime.songTitle ?? '', MARGIN, height - 50, { size: 16, weight: 700, maxWidth: 380 });
  text(ctx, runtime.songArtist ?? '', MARGIN, height - 28, { size: 11, color: MUTED, maxWidth: 380 });

  // Score figures, bottom right, in one row.
  const figures: Array<[string, string]> = [
    ['SCORE', String(runtime.score ?? 0)],
    ['EX SCORE', `${runtime.exScore ?? 0}/${runtime.exScoreMax ?? 0}`],
    ['COMBO', String(runtime.combo ?? 0)],
    ['RANK', runtime.rank ?? '-'],
  ];
  figures.forEach(([label, value], index) => {
    stat(ctx, label, value, width - MARGIN - 400 + index * 106, height - 56);
  });

  // Judgement counts down the right edge, beside the BGA.
  const counts: Array<[string, number | undefined]> = [
    ['PG', runtime.perfect],
    ['GR', runtime.great],
    ['GD', runtime.good],
    ['BD', runtime.bad],
    ['PR', runtime.poor],
  ];
  const columnX = width - MARGIN - 80;
  counts.forEach(([label, count], index) => {
    const y = COLUMN_TOP + index * 22;
    text(ctx, label, columnX, y, { size: 11, color: MUTED, weight: 700 });
    text(ctx, String(count ?? 0), columnX + 80, y, { size: 13, align: 'right' });
  });
}
