import type { CourseView } from '@be-music/player-scene-model';
import type { LibraryChart } from './chart.ts';
import { PLAYFIELD } from './playfield.ts';
import { STAGE_HEIGHT, STAGE_MARGIN, STAGE_WIDTH } from './stage.ts';
import type { BeMusicGameplayLayout, BeMusicGameplayRuntime, BeMusicRect, BeMusicStage } from './types.ts';

/**
 * The cabinet layout of the 16:9 play screen: the play area on the left (the lanes over the keys, the gauge, then the
 * score and hi-speed), the score graph beside it, and on the right the stage name, the players and the chart, the BGA,
 * and the judgement and BPM panels along the bottom. The lanes keep the standard geometry; the panels follow
 * `layout.playfield.right`, so a wider chart narrows the right-hand column and, when it leaves too little room, drops
 * the graph.
 */
export interface CabinetLayout {
  /** The play area's frame: the lanes down to the judgement line, the keys, the gauge, the score and the hi-speed. */
  play: BeMusicRect;
  /** The chart's progress, a thin bar left of the lanes; omitted when the lanes start at the stage's edge. */
  progress?: BeMusicRect;
  /** The key and scratch strip under the judgement line. */
  keys: BeMusicRect;
  /** The gauge bar; its label and percentage go on the line above it, inside {@link gaugeLabelY}. */
  gauge: BeMusicRect;
  /** Middle of the gauge's label line. */
  gaugeLabelY: number;
  score: BeMusicRect;
  hiSpeed: BeMusicRect;
  /** The score graph: YOU and PACEMAKER over the bars, then the lane option and the pacemaker's name. */
  graph?: { header: BeMusicRect; bars: BeMusicRect; footer: BeMusicRect };
  /** The stage name band across the top of the right-hand column, short of the top-right corner (a host's menu tab). */
  stage: BeMusicRect;
  /** The players and the chart: 1P's plate on the left, the title in the middle, 2P's plate on the right. */
  players: BeMusicRect;
  /** The BGA square, as {@link resolveCabinetBGARect} places it. */
  bga: BeMusicRect;
  /** The judgement counts, FAST / SLOW and the last timing. */
  judge: BeMusicRect;
  /** The BPM now with the chart's lowest and highest. */
  bpm: BeMusicRect;
  /** The play tempo, under the BPM. */
  tempo: BeMusicRect;
  /**
   * True for a double-play field centred on the stage ({@link cabinetStage}'s `doublePlayCenterX`): the stage band, the
   * chart, the BGA and the judgement panel take the left column, the graph and the tempo the right one, and the score,
   * the gauge, the hi-speed and the BPM sit under the lanes. The chart panel is then a narrow stack.
   */
  doublePlay: boolean;
  /** The box between the two sides' keys, for the gauge they share; double play only. */
  center?: BeMusicRect;
  /**
   * A free band at the top of the right column, short of the menu tab's corner, for what the narrow stage band has no
   * room for (the play mode, a DOM skin's buttons); double play only.
   */
  controls?: BeMusicRect;
}

/** Gap between the panels. */
const GAP = 10;
/** Width of the score graph column. */
const GRAPH_WIDTH = 132;
/** The right-hand column is never narrower than this; a wider chart gives up the graph first. */
const MIN_INFO_WIDTH = 300;
/** Narrowest the play area gets, so a 5 KEY chart still fits the score and the hi-speed under it. */
const MIN_PLAY_WIDTH = 210;
/** Top of the BGA area and of the bottom panels. */
const BGA_TOP = 90;
const PANELS_TOP = 360;
/** Below this the BGA would be a postage stamp; it is hidden instead, as on {@link wideStage}. */
const MIN_BGA_SIZE = 120;
/** The stage band stops short of the top-right corner, which a host keeps for its menu tab. */
const CORNER = 52;

/** Right edge of the play area for lanes ending at `playfieldRight`. */
function playRight(playfieldRight: number): number {
  return Math.max(playfieldRight + 8, STAGE_MARGIN + MIN_PLAY_WIDTH);
}

/** The right-hand column's left edge, and whether the graph sits between it and the play area. */
function infoColumn(playfieldRight: number): { left: number; graph: boolean } {
  const right = playRight(playfieldRight);
  const withGraph = right + GAP + GRAPH_WIDTH + GAP;
  if (STAGE_WIDTH - STAGE_MARGIN - withGraph >= MIN_INFO_WIDTH) return { left: withGraph, graph: true };
  return { left: right + GAP, graph: false };
}

/** Lanes starting this far right of the margin were centred for double play. */
const CENTRED_LEFT = 120;
/** Top of the double-play columns' panels under the stage band (left) or the menu tab's corner (right). */
const DP_TOP = 36;
/** Height of the double-play chart panel and of the row of score, gauge and hi-speed under the keys. */
const DP_CHART_H = 64;
const DP_ROW_H = 36;

function isCentred(playfieldLeft: number): boolean {
  return playfieldLeft - STAGE_MARGIN >= CENTRED_LEFT;
}

/** The double-play left column (stage band, chart, BGA, judgement) for lanes starting at `playfieldLeft`. */
function leftColumn(playfieldLeft: number): { x: number; w: number } {
  return { x: STAGE_MARGIN, w: playfieldLeft - 14 - STAGE_MARGIN };
}

/**
 * The BGA square for lanes from `playfieldLeft` to `playfieldRight`: as large as the right-hand column's width and the
 * band between the players and the bottom panels allow, centred in the column; for a double-play field centred on the
 * stage, at the top of the left column under the chart. Too small a square gives an empty rect, so the play has no BGA.
 */
export function resolveCabinetBGARect(playfieldRight: number, playfieldLeft: number = STAGE_MARGIN): BeMusicRect {
  if (isCentred(playfieldLeft)) {
    const column = leftColumn(playfieldLeft);
    const top = DP_TOP + DP_CHART_H + 6;
    const size = Math.min(column.w, 190);
    return size >= MIN_BGA_SIZE
      ? { x: Math.round(column.x + (column.w - size) / 2), y: top, w: size, h: size }
      : { x: column.x, y: top, w: 0, h: 0 };
  }
  const { left } = infoColumn(playfieldRight);
  const width = STAGE_WIDTH - STAGE_MARGIN - left;
  const fit = Math.min(width, PANELS_TOP - GAP - BGA_TOP);
  const size = fit >= MIN_BGA_SIZE ? fit : 0;
  return { x: Math.round(left + (width - size) / 2), y: BGA_TOP, w: size, h: size };
}

/**
 * The 16:9 stage with the cabinet layout's BGA square: {@link wideStage}'s size and lanes, with a double-play field
 * centred on the stage.
 */
export const cabinetStage: BeMusicStage = {
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT,
  playfield: { standard: { top: PLAYFIELD.y, judgementY: PLAYFIELD.judgementY, doublePlayCenterX: STAGE_WIDTH / 2 } },
  resolveBGARect: resolveCabinetBGARect,
};

/** The {@link CabinetLayout} of a landscape gameplay `layout` on the {@link cabinetStage}. */
export function resolveCabinetLayout(layout: Pick<BeMusicGameplayLayout, 'playfield'>): CabinetLayout {
  const { playfield } = layout;
  if (isCentred(playfield.left)) return resolveDoublePlayCabinet(playfield);
  const right = playRight(playfield.right);
  const play = { x: STAGE_MARGIN, y: playfield.top, w: right - STAGE_MARGIN, h: STAGE_HEIGHT - 12 - playfield.top };
  const keys = { x: playfield.left, y: playfield.judgementY + 6, w: playfield.right - playfield.left, h: 40 };
  const gaugeLabelY = keys.y + keys.h + 14;
  const gauge = { x: STAGE_MARGIN + 4, y: gaugeLabelY + 10, w: play.w - 8, h: 12 };
  const scoreY = gauge.y + gauge.h + 8;
  // The score and the hi-speed sit inside the play area's frame, as the gauge does.
  const scoreH = play.y + play.h - 4 - scoreY;
  const scoreW = Math.round((play.w - 8 - GAP) * 0.58);
  const { left, graph } = infoColumn(playfield.right);
  const infoRight = STAGE_WIDTH - STAGE_MARGIN;
  const infoW = infoRight - left;
  const judgeW = Math.round((infoW - GAP) * 0.55);
  const sideW = infoW - GAP - judgeW;
  const graphX = right + GAP;
  return {
    play,
    ...(playfield.left - STAGE_MARGIN >= 12
      ? { progress: { x: STAGE_MARGIN + 2, y: playfield.top + 4, w: 6, h: playfield.judgementY - playfield.top - 8 } }
      : {}),
    keys,
    gauge,
    gaugeLabelY,
    score: { x: STAGE_MARGIN + 4, y: scoreY, w: scoreW, h: scoreH },
    hiSpeed: { x: STAGE_MARGIN + 4 + scoreW + GAP, y: scoreY, w: play.w - 8 - scoreW - GAP, h: scoreH },
    ...(graph
      ? {
          graph: {
            header: { x: graphX, y: 8, w: GRAPH_WIDTH, h: 54 },
            bars: { x: graphX, y: 68, w: GRAPH_WIDTH, h: PANELS_TOP - GAP - 68 },
            footer: { x: graphX, y: PANELS_TOP, w: GRAPH_WIDTH, h: STAGE_HEIGHT - 16 - PANELS_TOP },
          },
        }
      : {}),
    stage: { x: left, y: 8, w: STAGE_WIDTH - CORNER - left, h: 22 },
    players: { x: left, y: 36, w: infoW, h: BGA_TOP - 8 - 36 },
    bga: resolveCabinetBGARect(playfield.right),
    judge: { x: left, y: PANELS_TOP, w: judgeW, h: STAGE_HEIGHT - 16 - PANELS_TOP },
    bpm: { x: left + judgeW + GAP, y: PANELS_TOP, w: sideW, h: 64 },
    tempo: { x: left + judgeW + GAP, y: PANELS_TOP + 64 + 8, w: sideW, h: STAGE_HEIGHT - 16 - PANELS_TOP - 72 },
    doublePlay: false,
  };
}

/**
 * The double-play arrangement around lanes centred on the stage: the left column holds the stage band, the chart, the
 * BGA and the judgement panel; the right column (under the menu tab's corner) the graph and the tempo; and under the
 * keys sit the score (under 1P), the gauge both sides share, the hi-speed (under 2P), and the BPM below them. The box
 * between the two banks of keys shows the shared gauge.
 */
function resolveDoublePlayCabinet(playfield: BeMusicGameplayLayout['playfield']): CabinetLayout {
  const bottom = STAGE_HEIGHT - 16;
  const left = leftColumn(playfield.left);
  const rightX = playfield.right + 14;
  const right = { x: rightX, w: STAGE_WIDTH - STAGE_MARGIN - rightX };
  const play = {
    x: playfield.left - 8,
    y: playfield.top,
    w: playfield.right - playfield.left + 16,
    h: STAGE_HEIGHT - 8,
  };
  const keys = { x: playfield.left, y: playfield.judgementY + 6, w: playfield.right - playfield.left, h: 40 };
  const rowY = keys.y + keys.h + 6;
  const figureW = Math.min(120, Math.round(play.w * 0.24));
  const score = { x: playfield.left, y: rowY, w: figureW, h: DP_ROW_H };
  const hiSpeed = { x: playfield.right - figureW, y: rowY, w: figureW, h: DP_ROW_H };
  const gaugeX = score.x + score.w + GAP;
  const gauge = { x: gaugeX, y: rowY + 20, w: hiSpeed.x - GAP - gaugeX, h: 12 };
  const bpmW = Math.min(200, play.w - 40);
  const bga = resolveCabinetBGARect(playfield.right, playfield.left);
  const judgeY = bga.y + Math.max(bga.h, MIN_BGA_SIZE) + 8;
  const side1P = playfield.sides['1P'];
  const side2P = playfield.sides['2P'];
  const footerH = 64;
  const tempoH = 36;
  const tempoY = bottom - tempoH;
  const footerY = tempoY - 8 - footerH;
  return {
    play,
    progress: { x: playfield.left - 7, y: playfield.top + 4, w: 4, h: playfield.judgementY - playfield.top - 8 },
    keys,
    gauge,
    gaugeLabelY: rowY + 8,
    score,
    hiSpeed,
    graph: {
      header: { x: right.x, y: DP_TOP, w: right.w, h: 54 },
      bars: { x: right.x, y: DP_TOP + 60, w: right.w, h: footerY - 8 - (DP_TOP + 60) },
      footer: { x: right.x, y: footerY, w: right.w, h: footerH },
    },
    stage: { ...left, y: 8, h: 22 },
    players: { ...left, y: DP_TOP, h: DP_CHART_H },
    bga,
    judge: { ...left, y: judgeY, h: bottom - judgeY },
    bpm: {
      x: Math.round((playfield.left + playfield.right - bpmW) / 2),
      y: rowY + DP_ROW_H + 8,
      w: bpmW,
      h: bottom - (rowY + DP_ROW_H + 8),
    },
    tempo: { ...right, y: tempoY, h: tempoH },
    doublePlay: true,
    controls: { x: right.x, y: 8, w: STAGE_WIDTH - CORNER - right.x, h: 22 },
    ...(side1P && side2P && side2P.left - side1P.right >= 24
      ? { center: { x: side1P.right + 4, y: keys.y + 8, w: side2P.left - side1P.right - 8, h: keys.h - 8 } }
      : {}),
  };
}

/** One score the graph compares the player's against: its total for the chart, where it stands now, and the gap. */
export interface ScorePaceTarget {
  /** What it is called on the graph (`AAA`, `MY BEST`, ...). */
  label: string;
  /** EX score over the whole chart. */
  exScore: number;
  /** EX score it holds at the notes judged so far: `exScore` times the share of the chart's notes judged. */
  pace: number;
  /** The player's EX score minus {@link pace}: ahead when positive. */
  diff: number;
}

/** The score graph's figures: the player's EX score against the chart's maximum, the pacemaker and the best record. */
export interface ScorePace {
  exScore: number;
  /** The chart's maximum EX score. */
  max: number;
  /** Share of the chart's notes judged so far, 0..1. */
  progress: number;
  /** The pacemaker: the host's target, else the AAA line. */
  target: ScorePaceTarget;
  /** The player's best record on the chart; omitted without one. */
  best?: ScorePaceTarget;
}

/** EX score of the AAA line (eight ninths of the maximum), the pacemaker when the host names none. */
function aaaLine(max: number): number {
  return Math.ceil((max * 8) / 9);
}

/**
 * The score graph's figures for a gameplay `runtime`: the player's EX score, the pacemaker's ({@link
 * BeMusicGameplayRuntime.targetEXScore}, else the AAA line) and the best record's ({@link
 * BeMusicGameplayRuntime.bestEXScore}), each held to the share of the chart's notes judged so far, as a pacemaker reads.
 * A host that knows where its target stands now ({@link BeMusicGameplayRuntime.targetPaceEXScore}, a replay ghost) gives
 * that in place of the share.
 */
export function resolveScorePace(
  runtime: Pick<
    BeMusicGameplayRuntime,
    | 'exScore'
    | 'exScoreMax'
    | 'totalNotes'
    | 'perfect'
    | 'great'
    | 'good'
    | 'bad'
    | 'poor'
    | 'bestEXScore'
    | 'targetEXScore'
    | 'targetPaceEXScore'
    | 'targetLabel'
  >,
): ScorePace {
  const exScore = runtime.exScore ?? 0;
  const max = Math.max(0, runtime.exScoreMax ?? 0);
  const total = runtime.totalNotes ?? 0;
  const judged =
    (runtime.perfect ?? 0) + (runtime.great ?? 0) + (runtime.good ?? 0) + (runtime.bad ?? 0) + (runtime.poor ?? 0);
  const progress = total > 0 ? Math.min(1, judged / total) : 0;
  const against = (label: string, score: number): ScorePaceTarget => {
    const pace = Math.round(score * progress);
    return { label, exScore: score, pace, diff: exScore - pace };
  };
  const hostTarget = runtime.targetEXScore !== undefined && runtime.targetEXScore > 0;
  const hostPace = runtime.targetPaceEXScore;
  return {
    exScore,
    max,
    progress,
    target: hostTarget
      ? hostPace !== undefined
        ? {
            label: runtime.targetLabel ?? 'TARGET',
            exScore: runtime.targetEXScore!,
            pace: hostPace,
            diff: exScore - hostPace,
          }
        : against(runtime.targetLabel ?? 'TARGET', runtime.targetEXScore!)
      : against(runtime.targetLabel ?? 'AAA', aaaLine(max)),
    ...(runtime.bestEXScore !== undefined && runtime.bestEXScore > 0
      ? { best: against('MY BEST', runtime.bestEXScore) }
      : {}),
  };
}

/** A score difference as the graph shows it: a sign and four digits (`+0168`, `-0003`, `±0000`). */
export function formatScoreDiff(diff: number): string {
  const digits = String(Math.abs(Math.trunc(diff))).padStart(4, '0');
  return diff > 0 ? `+${digits}` : diff < 0 ? `-${digits}` : `±${digits}`;
}

const ORDINALS = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH', '10TH'] as const;

/**
 * What the stage band says: `1ST STAGE` … for a course stage, `FINAL STAGE` for its last, the course's title for a
 * NONSTOP run (one stitched play), and `FREE PLAY` for a single chart.
 */
export function resolveStageLabel(
  course: Pick<CourseView, 'kind' | 'title' | 'stages' | 'stageIndex'> | undefined,
): string {
  if (!course) return 'FREE PLAY';
  if (course.kind === 'nonstop' || course.stageIndex === undefined) return course.title;
  if (course.stages.length > 1 && course.stageIndex === course.stages.length - 1) return 'FINAL STAGE';
  return `${ORDINALS[course.stageIndex] ?? `${course.stageIndex + 1}TH`} STAGE`;
}

const DIFFICULTY_NAMES = ['BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'INSANE'] as const;

/** The chart's `#DIFFICULTY` (1–5) by name (`BEGINNER` … `INSANE`); `undefined` when it sets none. */
export function resolveDifficultyName(chart: Pick<LibraryChart, 'chart'> | undefined): string | undefined {
  const value = chart?.chart.metadata.difficulty;
  return typeof value === 'number' ? DIFFICULTY_NAMES[Math.trunc(value) - 1] : undefined;
}
