import { parseHDXLongNoteMode } from './hdx-long-note-mode.ts';
import { findLastIndexAtOrBefore } from '@be-music/shared-utils/core';
import type { ChartOptionTimeline } from './chart-options.ts';
import { isChartPlayOptionDeclaration } from './chart-play-options.ts';

export interface ChartOptionState {
  /** Compulsory visual spacing multiplier, independent of audio tempo and user hi-speed limits. */
  hiSpeed?: number;
}
export interface ChartOptionStateCue {
  timeUs: number;
  /** Complete effective authored state at this instant. Empty restores user display settings. */
  state: ChartOptionState;
}
/** Versioned effective operations, safe to retain in a replay without reinterpreting unsupported source IDs later. */
export interface ChartOptionProgram {
  version: 1;
  initial: ChartOptionState;
  cues: ChartOptionStateCue[];
}
export interface ChartOptionDiagnostic {
  code:
    | 'unsupported-option'
    | 'invalid-parameter'
    | 'initial-only-alias'
    | 'initial-only-option'
    | 'missing-reference'
    | 'invalid-time';
  declaration?: string;
  key?: string;
  seconds?: number;
}
export interface CompiledChartOptions {
  program: ChartOptionProgram;
  diagnostics: ChartOptionDiagnostic[];
}

const LEGACY_HI_SPEED_VALUES = new Set([
  '0.2',
  '0.4',
  '0.6',
  '0.8',
  '1.0',
  '1.5',
  '2.0',
  '2.5',
  '3.0',
  '3.5',
  '4.0',
  '4.5',
  '5.0',
  '5.5',
  '6.0',
  '6.5',
  '7.0',
  '7.5',
  '8.0',
  '8.5',
  '9.0',
  '9.5',
  '10.0',
  '12.0',
  '15.0',
  '20.0',
  '100.0',
]);

function compileDeclaration(declaration: string, timed: boolean): number | ChartOptionDiagnostic['code'] {
  const modern = /^774:HI-SPEED_x(\d+(?:\.\d{1,2})?)$/.exec(declaration);
  if (modern) {
    const value = Number(modern[1]);
    return value >= 0.25 && value <= 100 ? value : 'invalid-parameter';
  }
  if (declaration.startsWith('774:HI-SPEED_')) return 'invalid-parameter';
  const legacy = /^774:HSP-(.+)$/.exec(declaration);
  if (legacy && LEGACY_HI_SPEED_VALUES.has(legacy[1]!))
    return timed ? 'initial-only-alias' : Math.max(0.25, Number(legacy[1]));
  if (parseHDXLongNoteMode(declaration) !== undefined) return 'initial-only-option';
  // RANDOM and gameplay CRAZY are initial-only in nanasigroove; `compileChartPlayOptions` consumes the initial ones.
  if (isChartPlayOptionDeclaration(declaration)) return 'initial-only-option';
  if (declaration.startsWith('charatbeatHDX:LONGMODE')) return 'invalid-parameter';
  return 'unsupported-option';
}

/**
 * Compile supported native declarations once. Unknown or disallowed declarations are diagnosed and do not cancel
 * earlier accepted values. Equal-time A6 operations execute in normalized IR order (Be-Music policy).
 */
export function compileChartOptions(timeline: ChartOptionTimeline): CompiledChartOptions {
  const diagnostics: ChartOptionDiagnostic[] = [];
  let state: ChartOptionState = {};
  for (const declaration of timeline.initial) {
    // LONGMODE is resolved by note-rules before note extraction, not a display/replay-profile operation.
    if (parseHDXLongNoteMode(declaration) !== undefined) continue;
    // RANDOM and gameplay CRAZY are play options (`compileChartPlayOptions`), not display operations.
    if (isChartPlayOptionDeclaration(declaration)) continue;
    const value = compileDeclaration(declaration, false);
    if (typeof value === 'number') state = { ...state, hiSpeed: value };
    else diagnostics.push({ code: value, declaration });
  }
  const initial = { ...state };
  const cues: ChartOptionStateCue[] = [];
  for (const cue of [...timeline.cues].sort((left, right) => left.seconds - right.seconds)) {
    const context = { key: cue.key, seconds: cue.seconds };
    if (cue.declaration === undefined) {
      diagnostics.push({ code: 'missing-reference', ...context });
      continue;
    }
    const timeUs = Math.round(cue.seconds * 1_000_000);
    if (!Number.isSafeInteger(timeUs) || timeUs < 0) {
      diagnostics.push({ code: 'invalid-time', declaration: cue.declaration, ...context });
      continue;
    }
    const value = compileDeclaration(cue.declaration, true);
    if (typeof value !== 'number') {
      diagnostics.push({ code: value, declaration: cue.declaration, ...context });
      continue;
    }
    state = { ...state, hiSpeed: value };
    cues.push({ timeUs, state });
  }
  return { program: { version: 1, initial, cues }, diagnostics };
}

/** Active effective authored options at integer replay/chart microseconds; stateless across pause and seek. */
export function resolveChartOptionsAt(program: ChartOptionProgram, timeUs: number): ChartOptionState {
  const index = findLastIndexAtOrBefore(program.cues, timeUs, (cue) => cue.timeUs);
  return { ...(index < 0 ? program.initial : program.cues[index]!.state) };
}
