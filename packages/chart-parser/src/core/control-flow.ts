import { evaluateControlFlow, type ActiveControlFlowEntry, type RandomDraws } from '@be-music/chart-model';
import {
  cloneJSON,
  type BMSControlFlowCommand,
  type BMSControlFlowEntry,
  type BeMusicJSON,
  normalizeChannel,
  normalizeObjectKey,
} from '@be-music/chart-source';
import { buildBMSObjectLineEntry, sortAndNormalizeEvents, upsertMeasureLength } from './event-utils.ts';

type ControlFlowCommand = BMSControlFlowCommand;

export type ControlFlowCaptureFrameType = 'random' | 'if' | 'switch';

type MeasureLengthEntry = BeMusicJSON['measures'][number];

export interface ResolveControlFlowOptions {
  /**
   * Re-applies a captured `#xxx ...` header entry against `json`.
   *
   * `command` is the uppercased canonical form used for keyword dispatch. `commandRaw` is the case-preserved original —
   * set only when the captured entry differed in case (typically a lowercase indexed-header key from a `#BASE 62`
   * chart). Callers should fall back to `command` when `commandRaw` is undefined, which is the common base-36
   * case-insensitive path.
   */
  applyHeader: (json: BeMusicJSON, command: string, commandRaw: string | undefined, value: string) => void;
}

/**
 * Builds the chart `input`'s control flow resolves to under `draws`: the header and object lines
 * `evaluateControlFlow` (`@be-music/chart-model`) reports active are applied on a copy of `input`, in file order, and the
 * copy's `bms.controlFlow` is emptied.
 */
export function resolveControlFlow(
  input: BeMusicJSON,
  draws: RandomDraws,
  options: ResolveControlFlowOptions,
): BeMusicJSON {
  const json = cloneJSON(input);
  // Evaluated on the copy so the applied events never share `position` / `bmson` objects with `input`. Draws that do
  // not belong to this chart throw here, including for a chart without control flow handed non-empty draws.
  const activeEntries = evaluateControlFlow(json, draws);
  if (json.bms.controlFlow.length === 0) {
    return json;
  }

  if (json.bms.optionHeadersInControlFlow) {
    // This complete program owns option declaration order; do not append its unconditional base twice.
    delete json.bms.option;
    delete json.bms.options;
    delete json.bms.optionHeadersInControlFlow;
  }
  const measureByIndex = new Map<number, MeasureLengthEntry>();
  for (const measure of json.measures) {
    measureByIndex.set(measure.index, measure);
  }
  for (const entry of activeEntries) {
    applyActiveControlFlowEntry(json, entry, options.applyHeader, measureByIndex);
  }

  // The branches are applied: the result is a resolved chart. Dropping the control flow makes that visible to every
  // consumer and makes resolving twice a no-op instead of stacking a second branch on top.
  json.bms.controlFlow = [];
  json.measures.sort((left, right) => left.index - right.index);
  // Honor `#BASE 62` so post-control-flow event normalization preserves lowercase IDs instead of folding them. The
  // base was recorded on the chart by the initial `parseBMS` pass.
  const replayBase: 36 | 62 = json.bms.base === 62 ? 62 : 36;
  json.events = sortAndNormalizeEvents(json.events, replayBase);
  return json;
}

export function updateControlFlowCaptureStack(stack: ControlFlowCaptureFrameType[], command: ControlFlowCommand): void {
  if (command === 'RANDOM' || command === 'SETRANDOM') {
    stack.push('random');
    return;
  }
  if (command === 'SWITCH' || command === 'SETSWITCH') {
    stack.push('switch');
    return;
  }
  if (command === 'IF') {
    stack.push('if');
    return;
  }
  if (command === 'ENDIF') {
    removeCurrentCaptureFrame(stack, 'if');
    return;
  }
  if (command === 'ENDRANDOM') {
    removeCurrentCaptureFrame(stack, 'random');
    return;
  }
  if (command === 'ENDSW') {
    removeCurrentCaptureFrame(stack, 'switch');
  }
}

export function createControlFlowObjectEntry(
  measure: number,
  channel: string,
  data: string,
  base: 36 | 62 = 36,
): Extract<BMSControlFlowEntry, { kind: 'object' }> | undefined {
  // Same line interpretation as the strict parse path — `buildBMSObjectLineEntry` owns the rule so captured
  // control-flow bodies can never drift from regular object lines.
  const entry = buildBMSObjectLineEntry(measure, channel, data, base);
  if (!entry) {
    return undefined;
  }
  return {
    kind: 'object',
    ...entry,
  };
}

/**
 * Maps real-world control-flow spelling variants onto their canonical commands: `#END IF` / bare `#END` → `#ENDIF`,
 * `#ELSE IF n` → `#ELSEIF n`. hitkey's command memo records these misspellings in released charts; without the
 * aliases the enclosing `#IF` never closes, and on a non-matching `#RANDOM` roll every line down to EOF silently
 * disappears. `#END <anything else>` and a plain `#ELSE` are NOT aliased — they fall through to normal header
 * handling.
 */
export function resolveControlFlowAliasDirective(
  command: string,
  value: string,
): { command: ControlFlowCommand; value?: string } | undefined {
  if (command === 'END') {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.toUpperCase() === 'IF') {
      return { command: 'ENDIF' };
    }
    return undefined;
  }
  if (command === 'ELSE') {
    const match = value.match(/^IF\b\s*(.*)$/i);
    if (match) {
      const rest = match[1]!.trim();
      return { command: 'ELSEIF', value: rest.length > 0 ? rest : undefined };
    }
  }
  return undefined;
}

export function normalizeControlFlowCommand(input: unknown): ControlFlowCommand | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  const normalized = input.toUpperCase();
  if (
    normalized === 'RANDOM' ||
    normalized === 'SETRANDOM' ||
    normalized === 'IF' ||
    normalized === 'ELSEIF' ||
    normalized === 'ELSE' ||
    normalized === 'ENDIF' ||
    normalized === 'ENDRANDOM' ||
    normalized === 'SWITCH' ||
    normalized === 'SETSWITCH' ||
    normalized === 'CASE' ||
    normalized === 'SKIP' ||
    normalized === 'DEF' ||
    normalized === 'ENDSW'
  ) {
    return normalized;
  }
  return undefined;
}

function removeCurrentCaptureFrame(stack: ControlFlowCaptureFrameType[], type: ControlFlowCaptureFrameType): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index] === type) {
      stack.splice(index, 1);
      return;
    }
  }
}

function applyActiveControlFlowEntry(
  json: BeMusicJSON,
  entry: ActiveControlFlowEntry,
  applyHeader: (json: BeMusicJSON, command: string, commandRaw: string | undefined, value: string) => void,
  measureByIndex?: Map<number, MeasureLengthEntry>,
): void {
  if (entry.kind === 'header') {
    // A later top-level line defines the same header and already won, as file order decides in LR2 and beatoraja.
    if (entry.overriddenByLaterHeader !== true) {
      applyHeader(json, entry.command, entry.commandRaw, entry.value);
    }
    return;
  }
  if (entry.kind === 'object') {
    if (typeof entry.measureLength === 'number' && entry.measureLength > 0) {
      upsertMeasureLength(json, entry.measure, entry.measureLength, measureByIndex);
    }
    const replayBase: 36 | 62 = json.bms.base === 62 ? 62 : 36;
    for (const event of entry.events) {
      json.events.push({
        measure: entry.measure,
        channel: normalizeChannel(entry.channel),
        position: event.position,
        value: normalizeObjectKey(event.value, replayBase),
        ...(event.bmson ? { bmson: event.bmson } : {}),
      });
    }
  }
}
