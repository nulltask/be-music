import type { NonstopConnection } from '../definition.ts';

/**
 * What the NONSTOP placement needs from one stage chart, in its own measures: positions are measure index plus the
 * fraction of the measure (`2.5` is the middle of measure 2), as LR2 counts them.
 */
export interface NonstopStageTiming {
  /** Stage-local seconds at a measure position, on the chart's own tempo; extends past the chart's last measure. */
  secondsAt(position: number): number;
  /** The first visible note (LR2 ops 10-29 / 50-69). */
  firstNote: number;
  /**
   * LR2's `firstNoteTime`: the first visible note in file order, then lowered by every object (any channel but 02 / 03)
   * on a line after it. Only the `lr2` placement reads it; defaults to {@link firstNote}.
   */
  lr2FirstNote?: number;
  /** The last visible note. */
  lastNote: number;
  /** The header `#BPM`, when the chart has one (FIT needs it). */
  headerBpm?: number;
  /** The BPM in force at the end of the chart, after its last tempo change. */
  finalBpm: number;
  /** The length of measure 0 (`#00002`), 1 by default. */
  firstMeasureLength: number;
}

/** Where one stage lands in the stitched play. Stitched seconds of a local position `p` are `offsetSeconds + secondsAt(p) / rate`. */
export interface NonstopStagePlacement {
  /** Stitched measure index of the stage's local measure 0. */
  measureOffset: number;
  /** Stitched seconds of the stage's local position 0. */
  offsetSeconds: number;
  /** FIT's time-stretch (and keysound pitch) factor: the previous stage's final BPM over this stage's `#BPM`; 1 without FIT. */
  rate: number;
  /** Measures cut from the start of the stage's own chart so it follows the previous one closely (0 for the first stage). */
  cut: number;
  /** Stitched measure of the bar line the stage hands over at: the next stage starts here, and the fades are timed from it. */
  boundaryMeasure: number;
  /** Stitched seconds of {@link boundaryMeasure}. */
  boundarySeconds: number;
}

export interface NonstopPlanOptions {
  /**
   * `'intended'` (default) places each stage after the previous one as LR2's NONSTOP loader means to. `'lr2'` follows
   * LR2's loader exactly (`LR2body.exe` 0x4b0690 `ParseBmsFile`), including what looks like a bug: from the third stage
   * on, a stage starts at the previous stage's last-measure line before that stage was cut, so its time origin runs on
   * by the previous cut at its own BPM and measure-0 length, and its first note is taken by LR2's file-order rule
   * ({@link NonstopStageTiming.lr2FirstNote}).
   */
  placement?: 'intended' | 'lr2';
}

/** BLANK2 hands over at the first bar line more than this long after the last-measure line (OpenLR2 L26549). */
const BLANK2_GAP_MS = 5000;
/** LR2 lays 1000 bar lines from a stage's start (OpenLR2 L26385); BLANK2 looks no further. */
const STAGE_BAR_LINES = 1000;
/** LR2's BPM when a chart sets none. */
const DEFAULT_BPM = 130;

/**
 * The bar line LR2 takes as a stage's last measure: the one nearest its last visible note, the earlier one on a tie
 * (OpenLR2 L26432-L26458, `objNumLastMeasureEarly` / `Late`).
 */
export function resolveNonstopLastMeasure(lastNote: number): number {
  const late = Math.floor(lastNote);
  const early = Math.ceil(lastNote);
  return early - lastNote < lastNote - late ? early : late;
}

/**
 * Places the stages of a NONSTOP course one after another the way LR2's chart loader stitches them
 * (`ParseBmsFile`, `LR2body.exe` 0x4b0690; OpenLR2 `LR2f.cpp` L25880-L27075):
 *
 * - Each stage hands over at its last-measure line ({@link resolveNonstopLastMeasure}); with `blank2` after it, at the
 *   first bar line more than 5 s later.
 * - The next stage starts at that line and has its leading measures cut so its first note comes within 0.5 measure of
 *   the previous stage's last-measure line (`>= 0.5` keeps cutting, as the binary compares), 1.5 after `blank1` (`>`),
 *   and none after `blank2`; it is then moved earlier by the time of the measures cut.
 * - After a `-fit` connection the stage is time-stretched by the previous stage's final BPM over its own `#BPM`.
 *
 * The positions LR2 keeps as 32-bit floats (the first-note and last-measure times) are rounded the same way.
 * `connections[k]` is the connection after stage `k`; a missing one reads as `fade`.
 */
export function planNonstopCourse(
  stages: readonly NonstopStageTiming[],
  connections: readonly NonstopConnection[],
  options: NonstopPlanOptions = {},
): NonstopStagePlacement[] {
  const lr2 = options.placement === 'lr2';
  const placements: NonstopStagePlacement[] = [];
  // The loader's running state, carried from stage to stage (LR2 names in comments).
  let lastMeasure = 0; // lastMeasure (int)
  let lastNoteTime = 0; // lastNoteTime (float): the last-measure line, cut-adjusted
  let realtimeMs = 0; // bpmt_realtime
  let prevPosition = 0; // prevNoteBmstime
  let nowBpm: number | undefined; // nowBPM, scaled by FIT
  stages.forEach((stage, index) => {
    const connection = index > 0 ? (connections[index - 1] ?? 'fade') : undefined;
    const stageStart = lastMeasure; // stageStartMeasure
    const prevLast = lastNoteTime; // prevStageLastNoteTime
    // How far the stage starts past where the previous one was placed: LR2's uncut start; 0 in the intended placement.
    const carry = stageStart - prevPosition;
    const fit = connection === 'fade-fit' || connection === 'cut-fit';
    const rate =
      fit && stage.headerBpm !== undefined && stage.headerBpm > 0 && nowBpm !== undefined
        ? nowBpm / stage.headerBpm
        : 1;
    const startBpm = stage.headerBpm !== undefined ? stage.headerBpm * rate : (nowBpm ?? DEFAULT_BPM);
    // The stage's first object sits at `stageStart`; the time from the previous object runs at this stage's BPM and
    // measure-0 length. In the intended placement the previous object is always at `stageStart`, so this is 0.
    const originMs = realtimeMs + carry * (240_000 / startBpm) * stage.firstMeasureLength;
    const localMs = (position: number): number => originMs + (stage.secondsAt(position) * 1000) / rate;

    let lastLine = resolveNonstopLastMeasure(stage.lastNote);
    lastNoteTime = Math.fround(stageStart + lastLine);
    let lineMs = localMs(lastLine);
    // LR2 requires the last-measure line's scroll position (`realtime × 1.2` in NONSTOP) to be past 0.
    if (connections[index] === 'blank2' && Math.trunc(lineMs * 1.2) > 0) {
      for (let line = lastLine + 1; line < STAGE_BAR_LINES; line += 1) {
        if (localMs(line) > lineMs + BLANK2_GAP_MS) {
          lastLine = line;
          lineMs = localMs(line);
          break;
        }
      }
    }

    let cut = 0;
    let shiftMs = 0;
    let shifted = false;
    if (index > 0) {
      const firstNote = Math.fround(stageStart + (lr2 ? (stage.lr2FirstNote ?? stage.firstNote) : stage.firstNote));
      cut = Math.trunc(firstNote) - stageStart - 1;
      if (connection === 'blank2') {
        cut = 0;
      } else if (connection === 'blank1') {
        while (firstNote - cut - prevLast > 1.5) cut += 1;
      } else {
        while (firstNote - cut - prevLast >= 0.5) cut += 1;
      }
      // A first note in measure 0 can leave the cut at -1 when nothing needs cutting; LR2 would then walk its bar lines
      // past the end, so the cut stops at 0.
      cut = Math.max(0, cut);
      lastNoteTime = Math.fround(lastNoteTime - cut);
      if (connection !== 'blank2' && stageStart > 0 && originMs > 0) {
        shiftMs = localMs(cut) - localMs(0);
        shifted = true;
      }
    }

    const lineMeasure = stageStart + lastLine;
    realtimeMs = lineMs - shiftMs;
    prevPosition = shifted ? lineMeasure - cut : lineMeasure;
    // LR2 starts the next stage at the line before this stage was cut; the intended placement at the line as placed.
    lastMeasure = lr2 ? lineMeasure : prevPosition;
    nowBpm = stage.finalBpm * rate;
    placements.push({
      measureOffset: stageStart - cut,
      offsetSeconds: (originMs - shiftMs) / 1000,
      rate,
      cut: cut - carry,
      boundaryMeasure: lineMeasure - cut,
      boundarySeconds: (lineMs - shiftMs) / 1000,
    });
  });
  return placements;
}
