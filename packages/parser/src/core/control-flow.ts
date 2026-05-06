import {
  cloneJson,
  type BmsControlFlowCommand,
  type BmsControlFlowEntry,
  type BeMusicEvent,
  type BeMusicJson,
  normalizeChannel,
  normalizeObjectKey,
} from '@be-music/json';
import { collectNonZeroObjectTokens, sortAndNormalizeEvents, upsertMeasureLength } from './event-utils.ts';

type ControlFlowCommand = BmsControlFlowCommand;

export type ControlFlowCaptureFrameType = 'random' | 'if' | 'switch';

interface RandomControlFrame {
  type: 'random';
  value: number;
}

interface IfControlFrame {
  type: 'if';
  active: boolean;
  matched: boolean;
  hasElse: boolean;
}

interface SwitchControlFrame {
  type: 'switch';
  value: number;
  active: boolean;
  matched: boolean;
  fallthrough: boolean;
  terminated: boolean;
}

type ControlFlowFrame = RandomControlFrame | IfControlFrame | SwitchControlFrame;
type MeasureLengthEntry = BeMusicJson['measures'][number];

export interface ResolveControlFlowOptions {
  random?: () => number;
  /**
   * Re-applies a captured `#xxx ...` header entry against `json`.
   *
   * `command` is the uppercased canonical form used for keyword dispatch. `commandRaw` is the case-preserved original —
   * set only when the captured entry differed in case (typically a lowercase indexed-header key from a `#BASE 62`
   * chart). Callers should fall back to `command` when `commandRaw` is undefined, which is the common base-36
   * case-insensitive path.
   */
  applyHeader: (json: BeMusicJson, command: string, commandRaw: string | undefined, value: string) => void;
}

export function resolveControlFlow(input: BeMusicJson, options: ResolveControlFlowOptions): BeMusicJson {
  if (input.bms.controlFlow.length === 0) {
    return cloneJson(input);
  }

  const random = options.random ?? Math.random;
  const json = cloneJson(input);
  const stack: ControlFlowFrame[] = [];
  const measureByIndex = new Map<number, MeasureLengthEntry>();
  for (const measure of json.measures) {
    measureByIndex.set(measure.index, measure);
  }

  for (const entry of json.bms.controlFlow) {
    if (entry.kind === 'directive') {
      applyControlFlowCommand(stack, entry.command, entry.value, random);
      continue;
    }
    if (!isControlFlowActive(stack)) {
      continue;
    }
    applyActiveControlFlowEntry(json, entry, options.applyHeader, measureByIndex);
  }

  json.measures.sort((left, right) => left.index - right.index);
  // Honor `#BASE 62` so post-control-flow event normalization preserves lowercase IDs instead of folding them. The
  // base was recorded on the chart by the initial `parseBms` pass.
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
): Extract<BmsControlFlowEntry, { kind: 'object' }> | undefined {
  if (channel === '02') {
    const measureLength = Number.parseFloat(data);
    if (!Number.isFinite(measureLength) || measureLength <= 0) {
      return undefined;
    }
    return {
      kind: 'object',
      measure,
      channel,
      events: [],
      measureLength,
    };
  }

  const parsed = collectNonZeroObjectTokens(data, base);
  const events: BeMusicEvent[] = [];
  for (const token of parsed.tokens) {
    events.push({
      measure,
      channel,
      position: [token.index, parsed.tokenCount],
      value: token.value,
    });
  }

  if (events.length === 0) {
    return undefined;
  }
  return {
    kind: 'object',
    measure,
    channel,
    events,
  };
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
  json: BeMusicJson,
  entry: BmsControlFlowEntry,
  applyHeader: (json: BeMusicJson, command: string, commandRaw: string | undefined, value: string) => void,
  measureByIndex?: Map<number, MeasureLengthEntry>,
): void {
  if (entry.kind === 'header') {
    applyHeader(json, entry.command, entry.commandRaw, entry.value);
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

function applyControlFlowCommand(
  stack: ControlFlowFrame[],
  command: ControlFlowCommand,
  rawValue?: string,
  random: () => number = Math.random,
): void {
  if (command === 'RANDOM') {
    const max = parsePositiveInteger(rawValue) ?? 1;
    stack.push({
      type: 'random',
      value: generateRandomValue(max, random),
    });
    return;
  }

  if (command === 'SETRANDOM') {
    stack.push({
      type: 'random',
      value: parsePositiveInteger(rawValue) ?? 1,
    });
    return;
  }

  if (command === 'IF') {
    const label = parsePositiveInteger(rawValue);
    const randomValue = getCurrentRandomValue(stack);
    const matched = label !== undefined && randomValue !== undefined && label === randomValue;
    stack.push({
      type: 'if',
      active: matched,
      matched,
      hasElse: false,
    });
    return;
  }

  if (command === 'ELSEIF') {
    const frame = getCurrentIfFrame(stack);
    if (!frame || frame.hasElse || frame.matched) {
      if (frame) {
        frame.active = false;
      }
      return;
    }

    const label = parsePositiveInteger(rawValue);
    const randomValue = getCurrentRandomValue(stack);
    const matched = label !== undefined && randomValue !== undefined && label === randomValue;
    frame.active = matched;
    if (matched) {
      frame.matched = true;
    }
    return;
  }

  if (command === 'ELSE') {
    const frame = getCurrentIfFrame(stack);
    if (!frame || frame.hasElse) {
      if (frame) {
        frame.active = false;
      }
      return;
    }

    frame.hasElse = true;
    if (frame.matched) {
      frame.active = false;
      return;
    }
    frame.active = true;
    frame.matched = true;
    return;
  }

  if (command === 'ENDIF') {
    removeCurrentFrame(stack, 'if');
    return;
  }

  if (command === 'ENDRANDOM') {
    removeCurrentFrame(stack, 'random');
    return;
  }

  if (command === 'SWITCH') {
    const max = parsePositiveInteger(rawValue) ?? 1;
    stack.push({
      type: 'switch',
      value: generateRandomValue(max, random),
      active: false,
      matched: false,
      fallthrough: false,
      terminated: false,
    });
    return;
  }

  if (command === 'SETSWITCH') {
    stack.push({
      type: 'switch',
      value: parsePositiveInteger(rawValue) ?? 1,
      active: false,
      matched: false,
      fallthrough: false,
      terminated: false,
    });
    return;
  }

  if (command === 'CASE') {
    const frame = getCurrentSwitchFrame(stack);
    if (!frame) {
      return;
    }
    if (frame.terminated) {
      frame.active = false;
      frame.fallthrough = false;
      return;
    }
    if (frame.fallthrough) {
      frame.active = true;
      return;
    }

    const label = parsePositiveInteger(rawValue);
    const matched = label !== undefined && label === frame.value;
    frame.active = matched;
    frame.fallthrough = matched;
    if (matched) {
      frame.matched = true;
    }
    return;
  }

  if (command === 'DEF') {
    const frame = getCurrentSwitchFrame(stack);
    if (!frame) {
      return;
    }
    if (frame.terminated) {
      frame.active = false;
      frame.fallthrough = false;
      return;
    }
    if (frame.fallthrough) {
      frame.active = true;
      return;
    }

    const shouldActivate = !frame.matched;
    frame.active = shouldActivate;
    frame.fallthrough = shouldActivate;
    if (shouldActivate) {
      frame.matched = true;
    }
    return;
  }

  if (command === 'SKIP') {
    const frame = getCurrentSwitchFrame(stack);
    if (!frame) {
      return;
    }
    if (!frame.active) {
      return;
    }
    frame.terminated = true;
    frame.active = false;
    frame.fallthrough = false;
    return;
  }

  if (command === 'ENDSW') {
    removeCurrentFrame(stack, 'switch');
  }
}

function parsePositiveInteger(value?: string): number | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function generateRandomValue(max: number, random: () => number): number {
  const normalized = Math.max(1, Math.floor(max));
  if (normalized <= 1) {
    return 1;
  }
  const value = random();
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
  return Math.floor(clamped * normalized) + 1;
}

function isControlFlowActive(stack: ControlFlowFrame[]): boolean {
  for (const frame of stack) {
    if (frame.type === 'if' && !frame.active) {
      return false;
    }
    if (frame.type === 'switch' && !frame.active) {
      return false;
    }
  }
  return true;
}

function getCurrentRandomValue(stack: ControlFlowFrame[]): number | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    if (frame.type === 'random') {
      return frame.value;
    }
  }
  return undefined;
}

function getCurrentIfFrame(stack: ControlFlowFrame[]): IfControlFrame | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    if (frame.type === 'if') {
      return frame;
    }
  }
  return undefined;
}

function getCurrentSwitchFrame(stack: ControlFlowFrame[]): SwitchControlFrame | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    if (frame.type === 'switch') {
      return frame;
    }
  }
  return undefined;
}

function removeCurrentFrame(stack: ControlFlowFrame[], type: ControlFlowFrame['type']): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].type === type) {
      stack.splice(index, 1);
      return;
    }
  }
}
