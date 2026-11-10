import {
  formatScoreDiff,
  resolveScratchAngle,
  resolveCabinetLayout,
  resolveDifficultyName,
  resolveScorePace,
  resolveStageLabel,
  type BeMusicGameplayLayout,
  type BeMusicGameplayRuntime,
  type BeMusicRect,
  type CabinetLayout,
  type ScorePace,
} from '@be-music/player-skin-sdk';
import type { Container, Graphics } from 'pixi.js';
import { addHUDNumber, addHUDText, type ChildPool } from '../pixi-kit/index.ts';
import { drawFrame } from './draw.ts';
import { drawSongInfoLayers } from './song-info.ts';
import { clampPercent, drawGaugeCells } from './player-hud.ts';
import {
  SYN_AMBER,
  SYN_CYAN,
  SYN_DIM,
  SYN_EMBER,
  SYN_GREEN,
  SYN_MAGENTA,
  SYN_MIST,
  SYN_RED,
  SYN_TEXT_FONT,
  SYN_VOID,
  SYN_WHITE,
  displayStyle,
  labelStyle,
} from './style.ts';

type Runtime = BeMusicGameplayRuntime;

/** What the cabinet HUD draws with: the panels' graphics and text layer, and the pool both come from. */
export interface CabinetDraw {
  graphics: Graphics;
  layer: Container;
  pool: ChildPool;
  accent: number;
  pulse: number;
}

/** DJ level lines on the graph, as fractions of the maximum EX score. */
const RANK_LINES = [
  ['AAA', 8 / 9],
  ['AA', 7 / 9],
  ['A', 6 / 9],
] as const;

/**
 * Where the well under the lanes ends on the cabinet layout: under the keys, so the keys sit in it.
 */
export function cabinetWellBottom(layout: Pick<BeMusicGameplayLayout, 'playfield' | 'twoPlayer'>): number {
  const { keys } = resolveCabinetLayout(layout);
  return keys.y + keys.h + 4;
}

/**
 * The landscape play HUD in the cabinet layout ({@link resolveCabinetLayout}), in Synesthesia's hairline frames: keys,
 * gauge, score and hi-speed under the lanes; the score graph beside them; the stage band (with the play-mode light and
 * the ruleset), the players, the judgement counts, the BPM and the tempo around the monitor.
 */
export function drawSynesthesiaCabinet(draw: CabinetDraw, runtime: Runtime, layout: BeMusicGameplayLayout): void {
  const cabinet = resolveCabinetLayout(layout);
  const banks = layout.twoPlayer ? Object.values(layout.playfield.sides) : [layout.playfield];
  for (const bank of banks) {
    if (bank)
      draw.graphics
        .rect(bank.left - 3, cabinet.keys.y, bank.right - bank.left + 4, cabinet.keys.h)
        .fill({ color: SYN_VOID, alpha: 0.96 });
  }
  drawKeys(draw, cabinet.keys, layout, runtime);
  drawGauge(draw, cabinet, runtime);
  if (cabinet.center) drawCenter(draw, cabinet.center, runtime);
  drawFigure(draw, cabinet.score, cabinet.secondSide ? '1P SCORE' : 'SCORE', String(Math.max(0, runtime.score ?? 0)));
  drawFigure(
    draw,
    cabinet.hiSpeed,
    runtime.floatingHiSpeed ? 'FHS' : 'HI-SPEED',
    (runtime.hiSpeed ?? 0).toFixed(runtime.floatingHiSpeed ? 2 : 1),
  );
  const pace = resolveScorePace(runtime);
  if (cabinet.graph) drawGraph(draw, cabinet.graph, pace, runtime);
  drawStage(draw, cabinet.stage, runtime, cabinet.controls);
  if (cabinet.doublePlay) drawChartStack(draw, cabinet.players, runtime);
  else drawPlayers(draw, cabinet.players, runtime);
  if (cabinet.secondSide && runtime.secondPlayer) {
    drawFigure(draw, cabinet.secondSide.score, '2P SCORE', String(runtime.secondPlayer.score ?? 0));
    drawFigure(
      draw,
      cabinet.secondSide.hiSpeed,
      runtime.floatingHiSpeed ? 'FHS' : 'HI-SPEED',
      (runtime.hiSpeed ?? 0).toFixed(runtime.floatingHiSpeed ? 2 : 1),
    );
  }
  drawJudge(draw, cabinet.judge, runtime);
  drawBPM(draw, cabinet.bpm, runtime);
  drawTempo(draw, cabinet.tempo, runtime.tempo ?? 1);
}

function frame({ graphics, accent }: CabinetDraw, rect: BeMusicRect): void {
  drawFrame(graphics, rect.x, rect.y, rect.w, rect.h, accent);
}

/**
 * The keys and the turntable under the lanes' own caps (which light on a press): outlined key tops in each lane's
 * colour, the black keys set higher, and a disc under a scratch or wheel lane, rotating once every four chart beats.
 */
function drawKeys(draw: CabinetDraw, rect: BeMusicRect, layout: BeMusicGameplayLayout, runtime: Runtime): void {
  const { graphics, pulse } = draw;
  const top = rect.y;
  const height = rect.h;
  for (const lane of layout.lanes) {
    const lit = runtime.keyBeams?.[lane.channel ?? ''] ?? 0;
    const color = lane.kind === 'white' ? SYN_EMBER : lane.kind === 'black' ? SYN_CYAN : SYN_MAGENTA;
    if (lane.kind === 'white' || lane.kind === 'black') {
      const inset = Math.min(2, lane.w / 6);
      const y = lane.kind === 'black' ? top : top + 6;
      const h = height - 6;
      graphics.rect(lane.x + inset, y, lane.w - 2 * inset, h).fill({ color: SYN_VOID, alpha: 0.85 });
      if (lit > 0) graphics.rect(lane.x + inset, y, lane.w - 2 * inset, h).fill({ color, alpha: lit * 0.8 });
      graphics.rect(lane.x + inset, y, lane.w - 2 * inset, h).stroke({ color, width: 1, alpha: 0.45 + lit * 0.5 });
      continue;
    }
    const radius = Math.max(2, Math.min(lane.w / 2, height / 2) - 1);
    const cx = lane.x + lane.w / 2;
    const cy = top + height / 2;
    graphics.circle(cx, cy, radius).fill({ color: SYN_VOID, alpha: 0.85 });
    graphics.circle(cx, cy, radius).stroke({ color, width: 1, alpha: 0.45 + 0.5 * lit });
    const angle = resolveScratchAngle(
      runtime.chartBeat ?? 0,
      runtime.scratchInputs?.[lane.channel ?? ''],
      runtime.nowMs,
    );
    graphics
      .moveTo(cx, cy)
      .lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
      .stroke({ color, width: 1.5, alpha: 0.9 });
    graphics.circle(cx, cy, radius * 0.3).fill({ color, alpha: 0.3 + 0.2 * pulse + 0.5 * lit });
  }
}

/** The gauge cells under the keys, split in two (1P's on the left) in a two-player play. */
function drawGauge(draw: CabinetDraw, cabinet: CabinetLayout, runtime: Runtime): void {
  const { gauge, gaugeLabelY } = cabinet;
  const second = runtime.secondPlayer;
  const split = second ? gauge.x + (gauge.w + 12) / 2 : gauge.x + gauge.w;
  // In double play the box between the keys shows the value, so the gauge's own line just names it.
  const showValue = second !== undefined || cabinet.center === undefined;
  const one = (state: Parameters<typeof drawGaugeCells>[1], rect: BeMusicRect, prefix: string) => {
    const value = clampPercent(state.gauge ?? 0);
    addHUDText(
      draw.layer,
      `${prefix}${(state.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`,
      rect.x,
      gaugeLabelY,
      { ...labelStyle(), anchorY: 0.5, maxWidth: showValue ? rect.w - 48 : rect.w },
      draw.pool,
    );
    if (showValue) {
      addHUDNumber(
        draw.layer,
        `${Math.floor(value)}%`,
        // Short of the clear notch, which rises above the cells.
        rect.x + rect.w,
        gaugeLabelY,
        { ...displayStyle(11, SYN_WHITE), anchorX: 1, anchorY: 0.5 },
        draw.pool,
      );
    }
    drawGaugeCells(draw.graphics, state, rect, rect.h);
  };
  if (cabinet.secondSide && second) {
    one(runtime, gauge, '1P ');
    one(second, cabinet.secondSide.gauge, '2P ');
    return;
  }
  one(runtime, { ...gauge, w: split - 6 - gauge.x + (second ? 0 : 6) }, second ? '1P ' : '');
  if (second) {
    one(
      { ...second, ...(runtime.nowMs !== undefined ? { nowMs: runtime.nowMs } : {}) },
      { ...gauge, x: split, w: gauge.x + gauge.w - split },
      '2P ',
    );
  }
}

/** The box between the double-play banks of keys: the gauge both sides share. */
function drawCenter(draw: CabinetDraw, rect: BeMusicRect, runtime: Runtime): void {
  frame(draw, rect);
  addHUDNumber(
    draw.layer,
    String(Math.floor(clampPercent(runtime.gauge ?? 0))),
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    {
      ...displayStyle(12, SYN_WHITE),
      anchorX: 0.5,
      anchorY: 0.5,
      maxWidth: rect.w - 6,
      dropShadow: { color: draw.accent, alpha: 0.8, blur: 6, distance: 0 },
    },
    draw.pool,
  );
}

function drawFigure(draw: CabinetDraw, rect: BeMusicRect, caption: string, value: string): void {
  frame(draw, rect);
  addHUDText(draw.layer, caption, rect.x + 10, rect.y + 7, labelStyle(), draw.pool);
  // A short double-play row keeps the figure under its caption.
  const short = rect.h < 44;
  addHUDNumber(
    draw.layer,
    value,
    rect.x + rect.w - 10,
    short ? rect.y + rect.h - 18 : rect.y + rect.h - 26,
    {
      ...displayStyle(short ? 12 : 17, SYN_WHITE),
      anchorX: 1,
      maxWidth: rect.w - 20,
      dropShadow: { color: draw.accent, alpha: 0.8, blur: 6, distance: 0 },
    },
    draw.pool,
  );
}

/** YOU and the pacemaker, the three filaments of light (the player, the best record, the pacemaker) and the gaps. */
function drawGraph(
  draw: CabinetDraw,
  graph: NonNullable<CabinetLayout['graph']>,
  pace: ScorePace,
  runtime: Runtime,
): void {
  const { graphics, layer, pool } = draw;
  const { header, bars, footer } = graph;
  frame(draw, header);
  for (const [row, label, value] of [
    [0, runtime.secondPlayer ? '1P' : 'YOU', pace.exScore],
    [1, 'PACEMAKER', pace.target.exScore],
  ] as const) {
    const y = header.y + 8 + row * 24;
    addHUDText(layer, label, header.x + 8, y + 2, { ...labelStyle(), size: 8, maxWidth: header.w - 60 }, pool);
    addHUDNumber(
      layer,
      String(value),
      header.x + header.w - 8,
      y,
      { ...displayStyle(12, row === 0 ? SYN_WHITE : SYN_MIST), anchorX: 1, maxWidth: 48 },
      pool,
    );
  }

  frame(draw, bars);
  addHUDText(layer, 'MAX SCORE', bars.x + 8, bars.y + 6, labelStyle(), pool);
  const top = bars.y + 22;
  const bottom = bars.y + bars.h - 34;
  const height = bottom - top;
  const yOf = (score: number) => bottom - (pace.max > 0 ? Math.min(1, score / pace.max) : 0) * height;
  for (const [label, share] of RANK_LINES) {
    const y = bottom - share * height;
    graphics.rect(bars.x + 6, y, bars.w - 12, 1).fill({ color: SYN_WHITE, alpha: 0.18 });
    addHUDText(layer, label, bars.x + 8, y - 11, { ...labelStyle(), fill: SYN_AMBER }, pool);
  }
  const gap = 6;
  const barW = (bars.w - 40 - gap * 2) / 3;
  const barX = (index: number) => bars.x + 34 + index * (barW + gap);
  const bar = (index: number, full: number | undefined, now: number, color: number) => {
    if (full !== undefined) {
      graphics.rect(barX(index), yOf(full), barW, bottom - yOf(full)).fill({ color, alpha: 0.12 });
    }
    graphics.rect(barX(index), yOf(now), barW, bottom - yOf(now)).fill({ color, alpha: 0.85 });
    graphics.rect(barX(index), yOf(now) - 1, barW, 2).fill({ color: SYN_WHITE, alpha: 0.9 });
  };
  bar(0, undefined, pace.exScore, draw.accent);
  if (pace.best) bar(1, pace.best.exScore, pace.best.pace, SYN_GREEN);
  bar(2, pace.target.exScore, pace.target.pace, SYN_MAGENTA);
  const diffs = [
    [0, 'TARGET', pace.target.diff],
    [1, 'MY BEST', pace.best?.diff],
  ] as const;
  for (const [row, label, diff] of diffs) {
    const y = bottom + 6 + row * 13;
    addHUDText(layer, label, bars.x + 8, y, { ...labelStyle(), size: 8, maxWidth: bars.w - 60 }, pool);
    addHUDNumber(
      layer,
      diff === undefined ? '----' : formatScoreDiff(diff),
      bars.x + bars.w - 8,
      y - 1,
      { ...displayStyle(9, diff === undefined ? SYN_DIM : diff >= 0 ? SYN_CYAN : SYN_RED), anchorX: 1 },
      pool,
    );
  }

  frame(draw, footer);
  addHUDText(layer, 'OPTION', footer.x + 10, footer.y + 7, labelStyle(), pool);
  addHUDText(
    layer,
    // A source-qualified lane option shows its bare name (`lr2:S-RANDOM` as S-RANDOM, ADR 0019).
    (runtime.random1P ?? 'OFF').replace(/^[^:]*:/, ''),
    footer.x + footer.w - 10,
    footer.y + 6,
    { ...displayStyle(9, SYN_MIST), anchorX: 1, maxWidth: footer.w - 70 },
    pool,
  );
  // The pacemaker box sits on the panel's foot.
  const boxY = footer.y + footer.h - 8 - 26;
  graphics.rect(footer.x + 8, boxY, footer.w - 16, 26).stroke({ color: draw.accent, width: 1, alpha: 0.5 });
  addHUDText(
    layer,
    `PACEMAKER ${pace.target.label}`,
    footer.x + footer.w / 2,
    boxY + 8,
    { ...displayStyle(9, SYN_WHITE), anchorX: 0.5, maxWidth: footer.w - 24 },
    pool,
  );
}

/** The stage name, centred; the play-mode light on the left and the ruleset on the right. */
/**
 * The stage name, centred in its band; the play-mode light and the ruleset on its ends, or in `controls` (the double-play
 * band above the graph) when the stage band is too narrow for them.
 */
function drawStage(draw: CabinetDraw, rect: BeMusicRect, runtime: Runtime, controls?: BeMusicRect): void {
  const { graphics, layer, pool, accent, pulse } = draw;
  frame(draw, rect);
  const ends = controls ?? rect;
  if (controls) frame(draw, controls);
  const autoplay = runtime.autoplay === true;
  const light = autoplay ? SYN_AMBER : accent;
  graphics.circle(ends.x + 12, ends.y + ends.h / 2, 3).fill({ color: light, alpha: 1 });
  graphics.circle(ends.x + 12, ends.y + ends.h / 2, 7).fill({ color: light, alpha: 0.18 + 0.2 * pulse });
  addHUDText(
    layer,
    autoplay ? 'AUTO' : 'PLAY',
    ends.x + 22,
    ends.y + 6,
    { ...displayStyle(8, SYN_MIST), letterSpacing: 2 },
    pool,
  );
  addHUDText(
    layer,
    resolveStageLabel(runtime.course).toUpperCase(),
    rect.x + rect.w / 2,
    rect.y + 5,
    {
      ...displayStyle(11, SYN_WHITE),
      letterSpacing: 3,
      anchorX: 0.5,
      maxWidth: controls ? rect.w - 20 : rect.w - 180,
      dropShadow: { color: accent, alpha: 0.7, blur: 6, distance: 0 },
    },
    pool,
  );
  const ruleset = runtime.rulesetLabel?.toUpperCase();
  if (ruleset) {
    addHUDText(
      layer,
      ruleset,
      ends.x + ends.w - 10,
      ends.y + 7,
      { ...displayStyle(8, accent), letterSpacing: 2, anchorX: 1, maxWidth: 70 },
      pool,
    );
  }
}

/** 1P's plate (name, difficulty, level), the title and artist, and 2P's EX score in a two-player play. */
function drawPlayers(draw: CabinetDraw, rect: BeMusicRect, runtime: Runtime): void {
  const { graphics, layer, pool, accent } = draw;
  frame(draw, rect);
  const plateW = 116;
  const plateX = rect.x + 8;
  addHUDText(
    layer,
    (runtime.playerName ?? 'PLAYER 1P').toUpperCase(),
    plateX,
    rect.y + 6,
    { ...labelStyle(), maxWidth: plateW - 8 },
    pool,
  );
  const difficulty = resolveDifficultyName(runtime.chart);
  if (difficulty) {
    graphics.rect(plateX, rect.y + 28, 70, 14).stroke({ color: SYN_AMBER, width: 1, alpha: 0.7 });
    addHUDText(
      layer,
      difficulty,
      plateX + 35,
      rect.y + 31,
      { ...displayStyle(7, SYN_AMBER), anchorX: 0.5, letterSpacing: 1 },
      pool,
    );
  }
  const level = runtime.chart?.playLevel;
  // A level does not change during a play, so its figures keep their natural spacing.
  addHUDText(
    layer,
    level === undefined ? 'Lv.-' : `Lv.${level}`,
    plateX + 78,
    rect.y + 30,
    { ...displayStyle(9, SYN_WHITE), maxWidth: plateW - 86 },
    pool,
  );
  const second = runtime.secondPlayer;
  const titleX = rect.x + plateW + 4;
  const titleW = rect.w - plateW * (second ? 2 : 1) - 12;
  drawSongInfoLayers(runtime, (info) => {
    const title = addHUDText(
      layer,
      info.chartTitle?.trim() || 'Untitled chart',
      titleX + titleW / 2,
      rect.y + 10,
      {
        size: 14,
        weight: '500',
        fill: SYN_WHITE,
        fontFamily: SYN_TEXT_FONT,
        anchorX: 0.5,
        maxWidth: titleW,
        dropShadow: { color: accent, alpha: 0.7, blur: 6, distance: 0 },
      },
      pool,
    );
    const artist = info.chartArtist?.trim();
    return [
      title,
      artist
        ? addHUDText(
            layer,
            artist,
            titleX + titleW / 2,
            rect.y + 33,
            { size: 9, weight: '300', fill: SYN_MIST, fontFamily: SYN_TEXT_FONT, anchorX: 0.5, maxWidth: titleW },
            pool,
          )
        : undefined,
    ];
  });
  if (second) {
    const x = rect.x + rect.w - 10;
    addHUDText(layer, 'PLAYER 2P', x, rect.y + 6, { ...labelStyle(), anchorX: 1 }, pool);
    addHUDNumber(
      layer,
      `EX ${Math.max(0, second.exScore)}`,
      x,
      rect.y + 24,
      { ...displayStyle(10, SYN_MIST), anchorX: 1, maxWidth: plateW - 12 },
      pool,
    );
  }
}

/** The double-play chart panel, narrow: the title and artist over the difficulty, the level and the player's name. */
function drawChartStack(draw: CabinetDraw, rect: BeMusicRect, runtime: Runtime): void {
  const { graphics, layer, pool, accent } = draw;
  frame(draw, rect);
  const inner = rect.w - 16;
  drawSongInfoLayers(runtime, (info) => [
    addHUDText(
      layer,
      info.chartTitle?.trim() || 'Untitled chart',
      rect.x + 8,
      rect.y + 5,
      {
        size: 12,
        weight: '500',
        fill: SYN_WHITE,
        fontFamily: SYN_TEXT_FONT,
        maxWidth: inner,
        dropShadow: { color: accent, alpha: 0.7, blur: 6, distance: 0 },
      },
      pool,
    ),
    addHUDText(
      layer,
      info.chartArtist?.trim() ?? '',
      rect.x + 8,
      rect.y + 23,
      { size: 8, weight: '300', fill: SYN_MIST, fontFamily: SYN_TEXT_FONT, maxWidth: inner },
      pool,
    ),
  ]);
  let x = rect.x + 8;
  const difficulty = resolveDifficultyName(runtime.chart);
  if (difficulty) {
    graphics.rect(x, rect.y + 40, 58, 12).stroke({ color: SYN_AMBER, width: 1, alpha: 0.7 });
    addHUDText(layer, difficulty, x + 29, rect.y + 42, { ...displayStyle(6, SYN_AMBER), anchorX: 0.5 }, pool);
    x += 64;
  }
  const level = runtime.chart?.playLevel;
  addHUDText(layer, level === undefined ? 'Lv.-' : `Lv.${level}`, x, rect.y + 41, displayStyle(9, SYN_WHITE), pool);
  if (runtime.playerName) {
    addHUDText(
      layer,
      runtime.playerName.toUpperCase(),
      rect.x + rect.w - 8,
      rect.y + 43,
      { ...labelStyle(), size: 7, anchorX: 1, maxWidth: Math.max(20, rect.x + rect.w - 8 - (x + 46)) },
      pool,
    );
  }
}

const COUNT_COLORS = [SYN_WHITE, SYN_AMBER, SYN_GREEN, SYN_CYAN, SYN_RED, SYN_MAGENTA] as const;

/** The counts, FAST / SLOW, and where the last timed press landed between EARLY and LATE. */
function drawJudge(draw: CabinetDraw, rect: BeMusicRect, runtime: Runtime): void {
  const { graphics, layer, pool } = draw;
  frame(draw, rect);
  addHUDText(layer, runtime.secondPlayer ? '1P JUDGE' : 'JUDGE', rect.x + 10, rect.y + 6, labelStyle(), pool);
  const counts = [
    ['PG', runtime.perfect],
    ['GR', runtime.great],
    ['GD', runtime.good],
    ['BD', runtime.bad],
    ['PR', runtime.poor],
    ['CB', (runtime.bad ?? 0) + (runtime.poor ?? 0)],
  ] as const;
  const pitch = (rect.h - 24) / counts.length;
  const countW = Math.min(84, rect.w * 0.42);
  counts.forEach(([label, count], index) => {
    const y = rect.y + 20 + pitch * index;
    addHUDText(layer, label, rect.x + 10, y + 1, { ...labelStyle(), fill: COUNT_COLORS[index] }, pool);
    addHUDNumber(
      layer,
      String(Math.max(0, count ?? 0)),
      rect.x + countW,
      y,
      { ...displayStyle(9, SYN_WHITE), anchorX: 1 },
      pool,
    );
  });
  const middle = rect.x + countW + (rect.w - countW - 40) / 2 + 6;
  for (const [row, label, color, count] of [
    [0, 'FAST', SYN_CYAN, runtime.fast],
    [1, 'SLOW', SYN_MAGENTA, runtime.slow],
  ] as const) {
    const y = rect.y + 24 + row * 36;
    addHUDText(layer, label, middle, y, { ...labelStyle(), fill: color, anchorX: 0.5 }, pool);
    addHUDNumber(
      layer,
      String(Math.max(0, count ?? 0)),
      middle,
      y + 13,
      { ...displayStyle(11, SYN_WHITE), anchorX: 0.5 },
      pool,
    );
  }
  const meterX = rect.x + rect.w - 22;
  const meterTop = rect.y + 24;
  const meterBottom = rect.y + rect.h - 22;
  addHUDText(layer, 'LATE', meterX + 3, rect.y + 8, { ...labelStyle(), size: 7, anchorX: 0.5 }, pool);
  addHUDText(layer, 'EARLY', meterX + 3, rect.y + rect.h - 16, { ...labelStyle(), size: 7, anchorX: 0.5 }, pool);
  graphics.rect(meterX + 2, meterTop, 2, meterBottom - meterTop).fill({ color: SYN_DIM, alpha: 0.4 });
  graphics.rect(meterX - 2, (meterTop + meterBottom) / 2, 10, 1).fill({ color: SYN_WHITE, alpha: 0.5 });
  const delta = runtime.lastJudgeDeltaMs;
  if (delta !== undefined) {
    const scale = runtime.judgeWindows?.note.great.lateMs ?? 40;
    const t = Math.max(-1, Math.min(1, delta / Math.max(1, scale)));
    const y = (meterTop + meterBottom) / 2 - (t * (meterBottom - meterTop)) / 2;
    const color = delta > 0 ? SYN_MAGENTA : delta < 0 ? SYN_CYAN : SYN_WHITE;
    graphics.rect(meterX - 3, y - 1.5, 12, 3).fill({ color, alpha: 1 });
    graphics.rect(meterX - 6, y - 4, 18, 8).fill({ color, alpha: 0.18 });
  }
}

function drawBPM(draw: CabinetDraw, rect: BeMusicRect, runtime: Runtime): void {
  const { layer, pool, accent } = draw;
  frame(draw, rect);
  const bpm = Math.round(runtime.bpm ?? 0);
  if (rect.h < 56) {
    addHUDNumber(
      layer,
      String(bpm),
      rect.x + rect.w / 2,
      rect.y + 3,
      { ...displayStyle(16, SYN_WHITE), anchorX: 0.5, maxWidth: rect.w / 3 },
      pool,
    );
    addHUDText(layer, 'BPM', rect.x + rect.w / 2, rect.y + 24, { ...labelStyle(), anchorX: 0.5, size: 8 }, pool);
    for (const [label, value, x, anchorX] of [
      ['MIN', runtime.minBPM ?? bpm, rect.x + 8, 0],
      ['MAX', runtime.maxBPM ?? bpm, rect.x + rect.w - 8, 1],
    ] as const) {
      addHUDText(layer, label, x, rect.y + 5, { ...labelStyle(), size: 8, anchorX }, pool);
      addHUDNumber(
        layer,
        String(Math.round(value)),
        x,
        rect.y + 21,
        { ...displayStyle(9, SYN_MIST), anchorX, maxWidth: rect.w / 3 - 10 },
        pool,
      );
    }
    return;
  }
  addHUDNumber(
    layer,
    String(bpm),
    rect.x + rect.w / 2,
    rect.y + 10,
    { ...displayStyle(18, SYN_WHITE), anchorX: 0.5, dropShadow: { color: accent, alpha: 0.8, blur: 6, distance: 0 } },
    pool,
  );
  const footY = rect.y + rect.h - 18;
  addHUDText(layer, 'MIN', rect.x + 10, footY - 12, labelStyle(), pool);
  addHUDNumber(layer, String(Math.round(runtime.minBPM ?? bpm)), rect.x + 10, footY, displayStyle(9, SYN_MIST), pool);
  addHUDText(layer, 'BPM', rect.x + rect.w / 2, footY, { ...labelStyle(), anchorX: 0.5 }, pool);
  addHUDText(layer, 'MAX', rect.x + rect.w - 10, footY - 12, { ...labelStyle(), anchorX: 1 }, pool);
  addHUDNumber(
    layer,
    String(Math.round(runtime.maxBPM ?? bpm)),
    rect.x + rect.w - 10,
    footY,
    { ...displayStyle(9, SYN_MIST), anchorX: 1 },
    pool,
  );
}

/** The play tempo where a cabinet shows its effector: `OFF` at the chart's own speed. */
function drawTempo(draw: CabinetDraw, rect: BeMusicRect, tempo: number): void {
  frame(draw, rect);
  const stacked = rect.w < 100;
  addHUDText(
    draw.layer,
    'TEMPO',
    stacked ? rect.x + rect.w / 2 : rect.x + 10,
    stacked ? rect.y + 5 : rect.y + rect.h / 2 - 4,
    { ...labelStyle(), anchorX: stacked ? 0.5 : 0 },
    draw.pool,
  );
  addHUDNumber(
    draw.layer,
    tempo === 1 ? 'OFF' : `x${tempo.toFixed(2)}`,
    stacked ? rect.x + rect.w / 2 : rect.x + rect.w - 10,
    stacked ? rect.y + 20 : rect.y + rect.h / 2 - 6,
    { ...displayStyle(11, tempo === 1 ? SYN_WHITE : SYN_AMBER), anchorX: stacked ? 0.5 : 1 },
    draw.pool,
  );
}
