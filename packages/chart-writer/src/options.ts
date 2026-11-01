import type { ChartExportDiagnosticHandler } from './bga-export.ts';

export interface BMSStringifyOptions {
  eol?: '\n' | '\r\n';
  /** Called for each part of a bmson chart that BMS cannot represent and the output leaves out. */
  onDiagnostic?: ChartExportDiagnosticHandler;
  maxResolution?: number;
  /**
   * When `true`, skip the round-trip re-parse that normally verifies the preserved source / object lines still encode
   * the same chart as `json`. The default (`false`) re-runs `parseBMS` against the just-rendered output and falls back
   * to canonical sections on mismatch — the safe choice when callers may have mutated the JSON between parse and
   * stringify. Set to `true` only when you can guarantee the preservation arrays were produced by an in-process parse
   * of unchanged content (e.g. a pure round-trip in tests, a SHA-stable export pipeline); doing so halves stringify
   * time on charts large enough for the re-parse to dominate (`stringifier:200`).
   */
  skipPreservationValidation?: boolean;
}

export interface BmsonStringifyOptions {
  /**
   * Output pulses per beat. Finite values >= 1 are floored. Otherwise a bmson source keeps its own resolution, and a BMS
   * chart gets the least multiple of 240 at which every object and measure boundary lands on a whole pulse, capped at
   * 61,440 (past the cap, positions round to it). Positions and LN endpoints round to the output grid. A positive LN that
   * would become a tap raises RangeError.
   */
  resolution?: number;
  indent?: number;
  /** Called for each part of a BMS chart that native bmson cannot represent and the output leaves out. */
  onDiagnostic?: ChartExportDiagnosticHandler;
  /** See {@link BMSStringifyOptions.skipPreservationValidation}. */
  skipPreservationValidation?: boolean;
}
