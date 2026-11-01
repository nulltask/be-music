import {
  formatScoreDiff,
  resolveCabinetLayout,
  resolveDifficultyName,
  resolveScorePace,
  resolveStageLabel,
  type BeMusicGameplayFrame,
  type BeMusicGameplayRuntime,
  type BeMusicRect,
  type CabinetLayout,
  type ScorePace,
} from '@be-music/player-skin-sdk';
import { ACCENT, DANGER, INK, LINE, MUTED, NOTE_FILL, PANEL, TEXT, text } from './theme.ts';

/** The gauge as a row of cells, the way a cabinet's groove gauge reads. */
const GAUGE_CELLS = 50;
/** A key flashes this long after it is pressed. */
const KEY_FLASH_MS = 120;
/** Graph lines for the DJ levels, as fractions of the maximum EX score. */
const RANK_LINES = [
  ['AAA', 8 / 9],
  ['AA', 7 / 9],
  ['A', 6 / 9],
] as const;

/**
 * The landscape play screen's HUD in the cabinet layout ({@link resolveCabinetLayout}): the keys, the gauge, the score
 * and the hi-speed under the lanes; the score graph beside them; and the stage, the players, the judgement counts and
 * the BPM around the BGA. The lanes, notes and the BGA's cut-out are drawn by `gameplay.ts`.
 */
export function drawCabinetHUD(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame): void {
  const cabinet = resolveCabinetLayout(frame.layout);
  const { runtime, nowMs } = frame;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(cabinet.play.x - 0.5, cabinet.play.y - 0.5, cabinet.play.w + 1, cabinet.play.h + 1);
  if (cabinet.progress) drawProgress(ctx, cabinet.progress, runtime.progressRatio ?? 0);
  drawKeys(ctx, frame, cabinet.keys);
  drawGauges(ctx, runtime, cabinet);
  if (cabinet.center) drawCenter(ctx, cabinet.center, runtime);
  drawFigure(ctx, cabinet.score, 'SCORE', String(runtime.score ?? 0));
  drawFigure(
    ctx,
    cabinet.hiSpeed,
    runtime.floatingHiSpeed ? 'FHS' : 'HI-SPEED',
    (runtime.hiSpeed ?? 0).toFixed(runtime.floatingHiSpeed ? 2 : 1),
  );
  const pace = resolveScorePace(runtime);
  if (cabinet.graph) drawGraph(ctx, cabinet.graph, pace, runtime);
  drawStage(ctx, cabinet.stage, resolveStageLabel(runtime.course), nowMs);
  if (cabinet.doublePlay) drawChartStack(ctx, cabinet.players, runtime, nowMs);
  else drawPlayers(ctx, cabinet.players, runtime, nowMs);
  drawJudge(ctx, cabinet.judge, runtime);
  drawBPM(ctx, cabinet.bpm, runtime);
  drawTempo(ctx, cabinet.tempo, runtime.tempo ?? 1);
}

/** A framed panel, with its caption in the top-left corner. */
function panel(ctx: CanvasRenderingContext2D, rect: BeMusicRect, caption?: string): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = LINE;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  if (caption) text(ctx, caption, rect.x + 8, rect.y + 10, { size: 9, color: MUTED, weight: 700 });
}

function drawProgress(ctx: CanvasRenderingContext2D, rect: BeMusicRect, ratio: number): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = ACCENT;
  const filled = rect.h * Math.max(0, Math.min(1, ratio));
  ctx.fillRect(rect.x, rect.y, rect.w, filled);
}

/** A key or turntable under each lane, lit while held and flashing on a press. */
function drawKeys(ctx: CanvasRenderingContext2D, frame: BeMusicGameplayFrame, rect: BeMusicRect): void {
  for (const lane of frame.lanes) {
    const flash = lane.pressedAtMs !== undefined && frame.nowMs - lane.pressedAtMs < KEY_FLASH_MS;
    const lit = Math.max(lane.beam, flash ? 1 : 0);
    const inset = Math.min(2, lane.w / 6);
    if (lane.kind === 'white' || lane.kind === 'black') {
      const y = lane.kind === 'black' ? rect.y : rect.y + 8;
      ctx.fillStyle = lane.kind === 'white' ? '#d8d8dc' : '#2a2a32';
      ctx.fillRect(lane.x + inset, y, lane.w - 2 * inset, rect.h - 8);
      if (lit > 0) {
        ctx.globalAlpha = lit * 0.8;
        ctx.fillStyle = ACCENT;
        ctx.fillRect(lane.x + inset, y, lane.w - 2 * inset, rect.h - 8);
        ctx.globalAlpha = 1;
      }
      continue;
    }
    // A scratch or wheel lane: a disc.
    const radius = Math.min(lane.w / 2, rect.h / 2) - 1;
    ctx.beginPath();
    ctx.arc(lane.x + lane.w / 2, rect.y + rect.h / 2, Math.max(2, radius), 0, Math.PI * 2);
    ctx.fillStyle = lit > 0 ? NOTE_FILL.scratch : '#2a2a32';
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.stroke();
  }
}

/** The gauge as cells; a two-player play splits the row in two, 1P's on the left. */
function drawGauges(ctx: CanvasRenderingContext2D, runtime: BeMusicGameplayRuntime, cabinet: CabinetLayout): void {
  const { gauge, gaugeLabelY } = cabinet;
  const second = runtime.secondPlayer;
  // In double play the box between the keys shows the value, so the gauge's own line just names it.
  const showValue = cabinet.center === undefined;
  if (!second) {
    drawGauge(ctx, runtime, gauge, gaugeLabelY, '', showValue);
    return;
  }
  const half = (gauge.w - 12) / 2;
  drawGauge(ctx, runtime, { ...gauge, w: half }, gaugeLabelY, '1P ', true);
  drawGauge(ctx, second, { ...gauge, x: gauge.x + half + 12, w: half }, gaugeLabelY, '2P ', true);
}

/** The box between the double-play banks of keys: the gauge both sides share. */
function drawCenter(ctx: CanvasRenderingContext2D, rect: BeMusicRect, runtime: BeMusicGameplayRuntime): void {
  panel(ctx, rect);
  const gauge = Math.max(0, Math.min(100, runtime.gauge ?? 0));
  text(ctx, String(Math.floor(gauge)), rect.x + rect.w / 2, rect.y + rect.h / 2, {
    size: 16,
    weight: 800,
    align: 'center',
    maxWidth: rect.w - 6,
  });
}

function drawGauge(
  ctx: CanvasRenderingContext2D,
  runtime: Pick<BeMusicGameplayRuntime, 'gauge' | 'clearThreshold' | 'gaugeLabel' | 'gaugeSurvival'>,
  rect: BeMusicRect,
  labelY: number,
  prefix: string,
  showValue: boolean,
): void {
  const gauge = Math.max(0, Math.min(100, runtime.gauge ?? 0));
  const clear = runtime.gaugeSurvival ? 0 : (runtime.clearThreshold ?? 80);
  text(ctx, `${prefix}${runtime.gaugeLabel ?? 'GROOVE'} GAUGE`, rect.x, labelY, { size: 9, color: MUTED, weight: 700 });
  if (showValue) text(ctx, `${Math.floor(gauge)}%`, rect.x + rect.w, labelY, { size: 13, weight: 700, align: 'right' });
  const cells = Math.max(10, Math.min(GAUGE_CELLS, Math.floor(rect.w / 4)));
  const pitch = rect.w / cells;
  for (let index = 0; index < cells; index++) {
    const share = ((index + 1) / cells) * 100;
    const lit = share <= gauge + 1e-6;
    const overClear = share > clear;
    ctx.fillStyle = lit ? (overClear ? DANGER : ACCENT) : overClear ? '#3a1f24' : '#1d2740';
    ctx.fillRect(rect.x + index * pitch, rect.y, Math.max(1, pitch - 1), rect.h);
  }
}

/** A caption over a right-aligned figure, framed. */
function drawFigure(ctx: CanvasRenderingContext2D, rect: BeMusicRect, caption: string, value: string): void {
  panel(ctx, rect, caption);
  // A short double-play row keeps the figure under its caption.
  const short = rect.h < 44;
  text(ctx, value, rect.x + rect.w - 8, short ? rect.y + rect.h - 10 : rect.y + rect.h / 2 + 7, {
    size: short ? 15 : 20,
    weight: 800,
    align: 'right',
    maxWidth: rect.w - 16,
  });
}

/** YOU and the pacemaker over three bars (the player, the best record, the pacemaker) on the DJ level lines. */
function drawGraph(
  ctx: CanvasRenderingContext2D,
  graph: NonNullable<CabinetLayout['graph']>,
  pace: ScorePace,
  runtime: BeMusicGameplayRuntime,
): void {
  const { header, bars, footer } = graph;
  panel(ctx, header);
  const rows: Array<[string, number]> = [
    ['YOU', pace.exScore],
    ['PACEMAKER', pace.target.exScore],
  ];
  rows.forEach(([label, value], index) => {
    const y = header.y + 15 + index * 24;
    text(ctx, label, header.x + 8, y, { size: 9, color: MUTED, weight: 700 });
    text(ctx, String(value), header.x + header.w - 8, y, { size: 15, weight: 800, align: 'right' });
  });

  panel(ctx, bars, 'MAX SCORE');
  const top = bars.y + 22;
  const bottom = bars.y + bars.h - 34;
  const height = bottom - top;
  const yOf = (score: number) => bottom - (pace.max > 0 ? Math.min(1, score / pace.max) : 0) * height;
  ctx.fillStyle = LINE;
  for (const [label, share] of RANK_LINES) {
    const y = Math.round(bottom - share * height) + 0.5;
    ctx.fillRect(bars.x + 6, y, bars.w - 12, 1);
    text(ctx, label, bars.x + 8, y - 7, { size: 9, color: MUTED, weight: 700 });
  }
  const columns = 3;
  const gap = 6;
  const barW = (bars.w - 40 - gap * (columns - 1)) / columns;
  const barX = (index: number) => bars.x + 34 + index * (barW + gap);
  const drawBar = (index: number, full: number | undefined, now: number, color: string) => {
    if (full !== undefined) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fillRect(barX(index), yOf(full), barW, bottom - yOf(full));
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.fillRect(barX(index), yOf(now), barW, bottom - yOf(now));
  };
  drawBar(0, undefined, pace.exScore, ACCENT);
  if (pace.best) drawBar(1, pace.best.exScore, pace.best.pace, '#5fd38d');
  drawBar(2, pace.target.exScore, pace.target.pace, DANGER);

  // The gaps, over the foot of the bars.
  const diffs: Array<[string, number | undefined]> = [
    ['TARGET', pace.target.diff],
    ['MY BEST', pace.best?.diff],
  ];
  diffs.forEach(([label, diff], index) => {
    const y = bottom + 10 + index * 12;
    text(ctx, label, bars.x + 8, y, { size: 9, color: MUTED, weight: 700, maxWidth: bars.w - 60 });
    text(ctx, diff === undefined ? '----' : formatScoreDiff(diff), bars.x + bars.w - 8, y, {
      size: 11,
      weight: 700,
      align: 'right',
      color: diff === undefined ? MUTED : diff >= 0 ? TEXT : DANGER,
    });
  });

  panel(ctx, footer, 'OPTION');
  text(ctx, runtime.random1P ?? 'OFF', footer.x + footer.w - 8, footer.y + 10, {
    size: 11,
    weight: 700,
    align: 'right',
    maxWidth: footer.w - 60,
  });
  // The pacemaker box sits on the panel's foot.
  const boxY = footer.y + footer.h - 8 - 26;
  ctx.strokeStyle = LINE;
  ctx.strokeRect(footer.x + 8.5, boxY + 0.5, footer.w - 17, 26);
  text(ctx, `PACEMAKER ${pace.target.label}`, footer.x + footer.w / 2, boxY + 13, {
    size: 11,
    weight: 700,
    align: 'center',
    maxWidth: footer.w - 24,
  });
}

function drawStage(ctx: CanvasRenderingContext2D, rect: BeMusicRect, label: string, nowMs: number): void {
  panel(ctx, rect);
  text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
    size: 13,
    weight: 800,
    align: 'center',
    maxWidth: rect.w - 16,
    nowMs,
  });
}

/** 1P's plate (name, difficulty, level), the title and artist, and 2P's plate in a two-player play. */
function drawPlayers(
  ctx: CanvasRenderingContext2D,
  rect: BeMusicRect,
  runtime: BeMusicGameplayRuntime,
  nowMs: number,
): void {
  panel(ctx, rect);
  const plateW = 92;
  const difficulty = resolveDifficultyName(runtime.chart);
  const level = runtime.chart?.playLevel;
  text(ctx, runtime.playerName ?? 'PLAYER 1P', rect.x + 8, rect.y + 9, {
    size: 9,
    color: MUTED,
    weight: 700,
    maxWidth: plateW - 12,
    nowMs,
  });
  if (difficulty) {
    ctx.fillStyle = INK;
    ctx.fillRect(rect.x + 8, rect.y + 16, plateW - 12, 12);
    text(ctx, difficulty, rect.x + 8 + (plateW - 12) / 2, rect.y + 22, {
      size: 9,
      weight: 800,
      align: 'center',
      color: ACCENT,
    });
  }
  text(ctx, level === undefined ? 'Lv.-' : `Lv.${level}`, rect.x + 8 + (plateW - 12) / 2, rect.y + 36, {
    size: 12,
    weight: 800,
    align: 'center',
  });

  const second = runtime.secondPlayer;
  const titleX = rect.x + plateW;
  const titleW = rect.w - plateW * (second ? 2 : 1) - 8;
  text(ctx, runtime.chartTitle ?? '', titleX + titleW / 2, rect.y + 17, {
    size: 15,
    weight: 800,
    align: 'center',
    maxWidth: titleW,
    nowMs,
  });
  text(ctx, runtime.chartArtist ?? '', titleX + titleW / 2, rect.y + 36, {
    size: 10,
    color: MUTED,
    align: 'center',
    maxWidth: titleW,
    nowMs,
  });
  if (second) {
    const x = rect.x + rect.w - plateW + 4;
    text(ctx, 'PLAYER 2P', x, rect.y + 11, { size: 9, color: MUTED, weight: 700 });
    text(ctx, `EX ${second.exScore ?? 0}`, x, rect.y + 30, { size: 12, weight: 800, maxWidth: plateW - 12 });
  }
}

/** The double-play chart panel, narrow: the title and artist over the difficulty, the level and the player's name. */
function drawChartStack(
  ctx: CanvasRenderingContext2D,
  rect: BeMusicRect,
  runtime: BeMusicGameplayRuntime,
  nowMs: number,
): void {
  panel(ctx, rect);
  const inner = rect.w - 16;
  text(ctx, runtime.chartTitle ?? '', rect.x + 8, rect.y + 12, { size: 13, weight: 800, maxWidth: inner, nowMs });
  text(ctx, runtime.chartArtist ?? '', rect.x + 8, rect.y + 28, { size: 9, color: MUTED, maxWidth: inner, nowMs });
  const difficulty = resolveDifficultyName(runtime.chart);
  const level = runtime.chart?.playLevel;
  let x = rect.x + 8;
  if (difficulty) {
    ctx.fillStyle = INK;
    ctx.fillRect(x, rect.y + 39, 56, 13);
    text(ctx, difficulty, x + 28, rect.y + 46, { size: 8, weight: 800, align: 'center', color: ACCENT, maxWidth: 52 });
    x += 62;
  }
  text(ctx, level === undefined ? 'Lv.-' : `Lv.${level}`, x, rect.y + 46, { size: 11, weight: 800 });
  if (runtime.playerName) {
    text(ctx, runtime.playerName, rect.x + rect.w - 8, rect.y + 46, {
      size: 8,
      color: MUTED,
      weight: 700,
      align: 'right',
      maxWidth: Math.max(20, rect.x + rect.w - 8 - (x + 44)),
      nowMs,
    });
  }
}

/** The counts, FAST / SLOW, and where the last timed press landed between EARLY and LATE. */
function drawJudge(ctx: CanvasRenderingContext2D, rect: BeMusicRect, runtime: BeMusicGameplayRuntime): void {
  panel(ctx, rect, 'JUDGE');
  const counts: Array<[string, number]> = [
    ['PG', runtime.perfect ?? 0],
    ['GR', runtime.great ?? 0],
    ['GD', runtime.good ?? 0],
    ['BD', runtime.bad ?? 0],
    ['PR', runtime.poor ?? 0],
    ['CB', (runtime.bad ?? 0) + (runtime.poor ?? 0)],
  ];
  const pitch = (rect.h - 26) / counts.length;
  const countW = Math.min(84, rect.w * 0.42);
  counts.forEach(([label, count], index) => {
    const y = rect.y + 24 + pitch * (index + 0.5);
    text(ctx, label, rect.x + 10, y, { size: 10, color: MUTED, weight: 700 });
    text(ctx, String(count), rect.x + countW, y, { size: 12, weight: 700, align: 'right' });
  });

  const middle = rect.x + countW + (rect.w - countW - 40) / 2 + 6;
  text(ctx, 'FAST', middle, rect.y + 34, { size: 10, color: ACCENT, weight: 800, align: 'center' });
  text(ctx, String(runtime.fast ?? 0), middle, rect.y + 50, { size: 13, weight: 700, align: 'center' });
  text(ctx, 'SLOW', middle, rect.y + 70, { size: 10, color: DANGER, weight: 800, align: 'center' });
  text(ctx, String(runtime.slow ?? 0), middle, rect.y + 86, { size: 13, weight: 700, align: 'center' });

  // LATE on top, EARLY below; the marker sits at the last timed press, on the GREAT window's scale.
  const meterX = rect.x + rect.w - 22;
  const meterTop = rect.y + 26;
  const meterBottom = rect.y + rect.h - 22;
  text(ctx, 'LATE', meterX + 3, rect.y + 16, { size: 8, color: MUTED, weight: 700, align: 'center' });
  text(ctx, 'EARLY', meterX + 3, rect.y + rect.h - 10, { size: 8, color: MUTED, weight: 700, align: 'center' });
  ctx.fillStyle = INK;
  ctx.fillRect(meterX, meterTop, 6, meterBottom - meterTop);
  const delta = runtime.lastJudgeDeltaMs;
  if (delta !== undefined) {
    const scale = runtime.judgeWindows?.note.great.lateMs ?? 40;
    const t = Math.max(-1, Math.min(1, delta / Math.max(1, scale)));
    const y = (meterTop + meterBottom) / 2 - (t * (meterBottom - meterTop)) / 2;
    ctx.fillStyle = delta > 0 ? DANGER : delta < 0 ? ACCENT : TEXT;
    ctx.fillRect(meterX - 3, y - 1.5, 12, 3);
  }
}

function drawBPM(ctx: CanvasRenderingContext2D, rect: BeMusicRect, runtime: BeMusicGameplayRuntime): void {
  panel(ctx, rect);
  const bpm = Math.round(runtime.bpm ?? 0);
  if (rect.h < 56) {
    // The double-play row under the gauge: MIN, the BPM and MAX side by side.
    const middle = rect.y + rect.h / 2;
    text(ctx, String(bpm), rect.x + rect.w / 2, middle - 4, { size: 20, weight: 800, align: 'center' });
    text(ctx, 'BPM', rect.x + rect.w / 2, middle + 14, { size: 8, color: MUTED, weight: 700, align: 'center' });
    text(ctx, 'MIN', rect.x + 10, middle - 8, { size: 8, color: MUTED, weight: 700 });
    text(ctx, String(Math.round(runtime.minBPM ?? bpm)), rect.x + 10, middle + 7, { size: 11, weight: 700 });
    text(ctx, 'MAX', rect.x + rect.w - 10, middle - 8, { size: 8, color: MUTED, weight: 700, align: 'right' });
    text(ctx, String(Math.round(runtime.maxBPM ?? bpm)), rect.x + rect.w - 10, middle + 7, {
      size: 11,
      weight: 700,
      align: 'right',
    });
    return;
  }
  text(ctx, String(bpm), rect.x + rect.w / 2, rect.y + 24, { size: 24, weight: 800, align: 'center' });
  const footY = rect.y + rect.h - 12;
  text(ctx, String(Math.round(runtime.minBPM ?? bpm)), rect.x + 10, footY, { size: 11, weight: 700 });
  text(ctx, 'MIN', rect.x + 10, footY - 14, { size: 8, color: MUTED, weight: 700 });
  text(ctx, 'BPM', rect.x + rect.w / 2, footY, { size: 9, color: MUTED, weight: 700, align: 'center' });
  text(ctx, String(Math.round(runtime.maxBPM ?? bpm)), rect.x + rect.w - 10, footY, {
    size: 11,
    weight: 700,
    align: 'right',
  });
  text(ctx, 'MAX', rect.x + rect.w - 10, footY - 14, { size: 8, color: MUTED, weight: 700, align: 'right' });
}

/** The play tempo where a cabinet shows its effector: `OFF` at the chart's own speed. */
function drawTempo(ctx: CanvasRenderingContext2D, rect: BeMusicRect, tempo: number): void {
  panel(ctx, rect, 'TEMPO');
  text(ctx, tempo === 1 ? 'OFF' : `x${tempo.toFixed(2)}`, rect.x + rect.w / 2, rect.y + rect.h / 2 + 5, {
    size: 13,
    weight: 800,
    align: 'center',
    color: tempo === 1 ? TEXT : ACCENT,
  });
}
