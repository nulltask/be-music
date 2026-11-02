import { parseHDXLongNoteMode } from './hdx-long-note-mode.ts';
import { findLastIndexAtOrBefore } from '@be-music/shared-utils/core';
import type { ChartOptionTimeline } from './chart-options.ts';
import { isChartPlayOptionDeclaration } from './chart-play-options.ts';
import { parseChartVisualOption, type ChartVisualOptionFields } from './chart-option-visual.ts';
import { resolveChartLegacyOptionAlias } from './chart-option-legacy.ts';

export interface ChartOptionState extends ChartVisualOptionFields {
  /** Compulsory visual spacing multiplier, independent of audio tempo and user hi-speed limits. */
  hiSpeed?: number;
}
/**
 * The effective-program profile this build compiles. Version 1 holds HI-SPEED only; version 2 adds HIDDEN, CHANGE-HS
 * and the CRAZY size / X-wave subfamilies (#843); version 3 adds HIDDEN_M-SUDDEN and the other visual CRAZY options
 * (STAR, SPIN, CLONE, LINEMOVE, the Y / XY / 3D waves, HIDJUDGE, DARK, REVERSE; #931). A replay keeps the version it
 * was recorded with, so an older recording never activates a family implemented after it.
 */
export const CHART_OPTION_PROGRAM_VERSION = 3;
export interface ChartOptionStateCue {
  timeUs: number;
  /** Complete effective authored state at this instant. Empty restores user display settings. */
  state: ChartOptionState;
}
/** Versioned effective operations, safe to retain in a replay without reinterpreting unsupported source IDs later. */
export interface ChartOptionProgram {
  version: 1 | 2 | 3;
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

type StateChange = (state: ChartOptionState) => ChartOptionState;

function compileDeclaration(source: string, timed: boolean): StateChange | ChartOptionDiagnostic['code'] {
  // Legacy HID-* / CRA-* IDs are initial-only, like the legacy HSP values: A6 disregards old IDs.
  const legacy = resolveChartLegacyOptionAlias(source);
  if (legacy !== undefined && timed) return 'initial-only-alias';
  const declaration = legacy ?? source;
  const hiSpeed = compileHiSpeed(declaration, timed);
  if (typeof hiSpeed === 'number') return (state) => ({ ...state, hiSpeed });
  if (hiSpeed !== 'unsupported-option') return hiSpeed;
  const visual = parseChartVisualOption(declaration);
  if (visual === undefined) return 'unsupported-option';
  return (state) => {
    const next: ChartOptionState = { ...state, ...visual.set };
    for (const field of visual.clear) delete next[field];
    return next;
  };
}

function compileHiSpeed(declaration: string, timed: boolean): number | ChartOptionDiagnostic['code'] {
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
  // `CRAZY_OFF` also clears the visual CRAZY subfamilies, so it stays a display operation too.
  if (isChartPlayOptionDeclaration(declaration) && parseChartVisualOption(declaration) === undefined)
    return 'initial-only-option';
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
  for (const source of timeline.initial) {
    const declaration = resolveChartLegacyOptionAlias(source) ?? source;
    // LONGMODE is resolved by note-rules before note extraction, not a display/replay-profile operation.
    if (parseHDXLongNoteMode(declaration) !== undefined) continue;
    // RANDOM and gameplay CRAZY are play options (`compileChartPlayOptions`), not display operations; `CRAZY_OFF` is both.
    if (isChartPlayOptionDeclaration(declaration) && parseChartVisualOption(declaration) === undefined) continue;
    const value = compileDeclaration(declaration, false);
    if (typeof value === 'function') state = value(state);
    else diagnostics.push({ code: value, declaration: source });
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
    if (typeof value !== 'function') {
      diagnostics.push({ code: value, declaration: cue.declaration, ...context });
      continue;
    }
    state = value(state);
    cues.push({ timeUs, state });
  }
  return { program: { version: CHART_OPTION_PROGRAM_VERSION, initial, cues }, diagnostics };
}

/** Active effective authored options at integer replay/chart microseconds; stateless across pause and seek. */
export function resolveChartOptionsAt(program: ChartOptionProgram, timeUs: number): ChartOptionState {
  const index = findLastIndexAtOrBefore(program.cues, timeUs, (cue) => cue.timeUs);
  return { ...(index < 0 ? program.initial : program.cues[index]!.state) };
}
