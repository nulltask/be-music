import type {
  BmsControlFlowCommand,
  BmsControlFlowEntry,
  BmsControlFlowHeaderEntry,
  BmsControlFlowObjectEntry,
} from '@be-music/json';

/** The control-flow lines that set a `#RANDOM` / `#SWITCH` value: two that draw it and two that fix it. */
export type RandomDrawCommand = 'RANDOM' | 'SETRANDOM' | 'SWITCH' | 'SETSWITCH';

/**
 * The value one `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` line put in force.
 *
 * - `#RANDOM n` / `#SWITCH n` draw `value` from `1..n`; `range` is `n`. A missing, zero, negative or non-numeric `n`
 *   is a single-outcome line: `range` 1, `value` 1, and nothing is drawn for it.
 * - `#SETRANDOM n` / `#SETSWITCH n` fix the value to `n` (1 when `n` is missing or not positive); `range` is 1, since
 *   the line has one outcome, and `value` is `n`.
 */
export interface RandomDraw {
  readonly command: RandomDrawCommand;
  /** Number of outcomes the line offers. */
  readonly range: number;
  /** The value in force after the line, `1..range` for a drawing line. */
  readonly value: number;
}

/**
 * The outcome of a chart's control flow for one play: one {@link RandomDraw} per `#RANDOM` / `#SETRANDOM` /
 * `#SWITCH` / `#SETSWITCH` line, in file order. Every such line has an entry, including the ones nested in a branch
 * that is not taken, because the evaluator walks every line whatever the branch state.
 *
 * Draw it once with {@link drawRandomOutcomes}, then hand the same value to everything that needs the play's
 * branches (the resolver, the engine's RANDOM summary, the play log, hashing), so nothing rolls `#RANDOM` again.
 */
export type RandomDraws = ReadonlyArray<RandomDraw>;

/** Anything carrying a BMS control-flow list (a `BeMusicJson`, or just its `bms` part). */
export interface ControlFlowSource {
  readonly bms: { readonly controlFlow: ReadonlyArray<BmsControlFlowEntry> };
}

/** A captured `#xxx` header or object line that is active under a set of draws. */
export type ActiveControlFlowEntry = BmsControlFlowHeaderEntry | BmsControlFlowObjectEntry;

/**
 * Draws the outcome of every `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` line of `source`, in file order.
 *
 * `random` returns a value in `[0, 1)` (out-of-range and non-finite values are clamped) and is called exactly once
 * per line with more than one outcome; single-outcome lines and the `#SET…` lines do not consume it.
 */
export function drawRandomOutcomes(source: ControlFlowSource, random: () => number): RandomDraws {
  const draws: RandomDraw[] = [];
  for (const entry of source.bms.controlFlow) {
    if (entry.kind !== 'directive' || !isRandomDrawCommand(entry.command)) {
      continue;
    }
    if (entry.command === 'SETRANDOM' || entry.command === 'SETSWITCH') {
      draws.push({ command: entry.command, range: 1, value: parseControlFlowInteger(entry.value) ?? 1 });
      continue;
    }
    const range = parseControlFlowInteger(entry.value) ?? 1;
    draws.push({ command: entry.command, range, value: range <= 1 ? 1 : drawValue(range, random()) });
  }
  return draws;
}

/**
 * Lists the captured header and object lines of `source` that are active when its control flow takes `draws`, in
 * file order. This is the one evaluator of the control-flow semantics; the parser applies its result to build the
 * resolved chart.
 *
 * Semantics (LR2 / beatoraja compatible):
 * - One stack holds `#RANDOM`, `#IF` and `#SWITCH` frames. `#ENDIF` / `#ENDRANDOM` / `#ENDSW` remove the innermost
 *   frame of their kind, so an `#IF` left open (a missing `#ENDIF`) outlives its `#ENDRANDOM` and keeps gating the
 *   lines after it.
 * - `#IF n` tests the innermost `#RANDOM` value; `#ELSEIF` / `#ELSE` act on the innermost `#IF`. `#CASE` / `#DEF` /
 *   `#SKIP` act on the innermost `#SWITCH`, with fall-through until `#SKIP`.
 * - A line is active when every `#IF` and `#SWITCH` frame on the stack is active. Header lines inside a taken
 *   branch (`#WAVxx`, `#BPM`, …) take effect for the whole chart, exactly like ones outside control flow.
 *
 * @throws RangeError when `draws` was not drawn for this control flow (another line count, command, range, or a
 *   value outside the line's outcomes).
 */
export function evaluateControlFlow(source: ControlFlowSource, draws: RandomDraws): ActiveControlFlowEntry[] {
  const active: ActiveControlFlowEntry[] = [];
  const stack: ControlFlowFrame[] = [];
  let drawIndex = 0;
  const entries = source.bms.controlFlow;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.kind === 'directive') {
      if (isRandomDrawCommand(entry.command)) {
        const draw = draws[drawIndex];
        assertDrawMatches(draw, drawIndex, entry.command, entry.value);
        drawIndex += 1;
        pushValueFrame(stack, entry.command, draw.value, index);
        continue;
      }
      applyBranchCommand(stack, entry.command, entry.value, index);
      continue;
    }
    if (isControlFlowActive(stack)) {
      active.push(entry);
    }
  }
  if (drawIndex !== draws.length) {
    throw new RangeError(
      `RandomDraws do not match the control flow: the chart has ${drawIndex} #RANDOM / #SWITCH lines, the draws ${draws.length}.`,
    );
  }
  return active;
}

/** Whether `source` still carries control flow, i.e. has not been resolved yet. */
export function hasControlFlow(source: ControlFlowSource): boolean {
  return source.bms.controlFlow.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// The frame-stack semantics. Exported for the chart fingerprint, which runs them over every outcome at once
// (`fingerprint-control-flow.ts`); not part of the package API.
// ---------------------------------------------------------------------------------------------------------------------

interface ControlFrameBase {
  /** Index in `bms.controlFlow` of the directive that pushed the frame. */
  origin: number;
}

export interface RandomControlFrame extends ControlFrameBase {
  type: 'random';
  value: number;
}

export interface IfControlFrame extends ControlFrameBase {
  type: 'if';
  active: boolean;
  matched: boolean;
  hasElse: boolean;
}

export interface SwitchControlFrame extends ControlFrameBase {
  type: 'switch';
  value: number;
  active: boolean;
  matched: boolean;
  fallthrough: boolean;
  terminated: boolean;
}

/** One frame of the control-flow stack. */
export type ControlFlowFrame = RandomControlFrame | IfControlFrame | SwitchControlFrame;

export function isRandomDrawCommand(command: BmsControlFlowCommand): command is RandomDrawCommand {
  return command === 'RANDOM' || command === 'SETRANDOM' || command === 'SWITCH' || command === 'SETSWITCH';
}

/**
 * The value a `#SETRANDOM` / `#SETSWITCH` line fixes, or `undefined` for a `#RANDOM` / `#SWITCH` line with more than one
 * outcome (a variable). Single-outcome `#RANDOM` / `#SWITCH` lines are fixed to 1.
 */
export function fixedDrawValue(command: RandomDrawCommand, rawValue: string | undefined): number | undefined {
  if (command === 'SETRANDOM' || command === 'SETSWITCH') {
    return parseControlFlowInteger(rawValue) ?? 1;
  }
  return (parseControlFlowInteger(rawValue) ?? 1) <= 1 ? 1 : undefined;
}

/** Number of outcomes a `#RANDOM` / `#SWITCH` line offers (1 for the `#SET…` lines). */
export function drawRange(command: RandomDrawCommand, rawValue: string | undefined): number {
  return command === 'SETRANDOM' || command === 'SETSWITCH' ? 1 : (parseControlFlowInteger(rawValue) ?? 1);
}

function assertDrawMatches(
  draw: RandomDraw | undefined,
  index: number,
  command: RandomDrawCommand,
  rawValue: string | undefined,
): asserts draw is RandomDraw {
  const prefix = `RandomDraws do not match the control flow at #${command} line ${index + 1}`;
  if (draw === undefined) {
    throw new RangeError(`${prefix}: no draw for it.`);
  }
  if (draw.command !== command) {
    throw new RangeError(`${prefix}: the draw is for #${draw.command}.`);
  }
  if (command === 'SETRANDOM' || command === 'SETSWITCH') {
    const fixed = parseControlFlowInteger(rawValue) ?? 1;
    if (draw.range !== 1 || draw.value !== fixed) {
      throw new RangeError(`${prefix}: the line fixes ${fixed}, the draw has ${draw.value}.`);
    }
    return;
  }
  const range = parseControlFlowInteger(rawValue) ?? 1;
  if (draw.range !== range) {
    throw new RangeError(`${prefix}: the line offers ${range} outcomes, the draw ${draw.range}.`);
  }
  if (!Number.isInteger(draw.value) || draw.value < 1 || draw.value > range) {
    throw new RangeError(`${prefix}: ${draw.value} is not in 1..${range}.`);
  }
}

/** Pushes the frame of a `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` line whose value is `value`. */
export function pushValueFrame(
  stack: ControlFlowFrame[],
  command: RandomDrawCommand,
  value: number,
  origin: number,
): void {
  if (command === 'RANDOM' || command === 'SETRANDOM') {
    stack.push({ type: 'random', value, origin });
    return;
  }
  stack.push({ type: 'switch', value, active: false, matched: false, fallthrough: false, terminated: false, origin });
}

/** Applies any other directive (`#IF`, `#ELSE`, `#CASE`, `#ENDSW`, …) to the stack. */
export function applyBranchCommand(
  stack: ControlFlowFrame[],
  command: BmsControlFlowCommand,
  rawValue: string | undefined,
  origin: number,
): void {
  switch (command) {
    case 'IF': {
      const label = parseControlFlowInteger(rawValue);
      const randomValue = getCurrentRandomValue(stack);
      const matched = label !== undefined && randomValue !== undefined && label === randomValue;
      stack.push({ type: 'if', active: matched, matched, hasElse: false, origin });
      return;
    }
    case 'ELSEIF': {
      const frame = getCurrentFrame(stack, 'if');
      if (!frame || frame.hasElse || frame.matched) {
        if (frame) {
          frame.active = false;
        }
        return;
      }
      const label = parseControlFlowInteger(rawValue);
      const randomValue = getCurrentRandomValue(stack);
      const matched = label !== undefined && randomValue !== undefined && label === randomValue;
      frame.active = matched;
      if (matched) {
        frame.matched = true;
      }
      return;
    }
    case 'ELSE': {
      const frame = getCurrentFrame(stack, 'if');
      if (!frame || frame.hasElse) {
        if (frame) {
          frame.active = false;
        }
        return;
      }
      frame.hasElse = true;
      frame.active = !frame.matched;
      frame.matched = true;
      return;
    }
    case 'ENDIF':
      removeCurrentFrame(stack, 'if');
      return;
    case 'ENDRANDOM':
      removeCurrentFrame(stack, 'random');
      return;
    case 'CASE':
    case 'DEF': {
      const frame = getCurrentFrame(stack, 'switch');
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
      let matched: boolean;
      if (command === 'CASE') {
        const label = parseControlFlowInteger(rawValue);
        matched = label !== undefined && label === frame.value;
      } else {
        matched = !frame.matched;
      }
      frame.active = matched;
      frame.fallthrough = matched;
      if (matched) {
        frame.matched = true;
      }
      return;
    }
    case 'SKIP': {
      const frame = getCurrentFrame(stack, 'switch');
      if (!frame || !frame.active) {
        return;
      }
      frame.terminated = true;
      frame.active = false;
      frame.fallthrough = false;
      return;
    }
    case 'ENDSW':
      removeCurrentFrame(stack, 'switch');
      return;
    default:
      return;
  }
}

/** A control-flow line's positive integer argument (`#RANDOM n`, `#IF n`, …), or `undefined`. */
export function parseControlFlowInteger(value?: string): number | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  return normalized <= 0 ? undefined : normalized;
}

function drawValue(range: number, randomValue: number): number {
  const clamped = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.999999999, randomValue)) : 0;
  return Math.floor(clamped * range) + 1;
}

/** A header or object line is applied when every `#IF` and `#SWITCH` frame on the stack is active. */
export function isControlFlowActive(stack: ReadonlyArray<ControlFlowFrame>): boolean {
  for (const frame of stack) {
    if (frame.type !== 'random' && !frame.active) {
      return false;
    }
  }
  return true;
}

/** The value of the innermost `#RANDOM` / `#SETRANDOM` frame, which `#IF` / `#ELSEIF` compare with. */
function getCurrentRandomValue(stack: ReadonlyArray<ControlFlowFrame>): number | undefined {
  return getCurrentFrame(stack, 'random')?.value;
}

/**
 * The innermost frame of a kind: `#IF` / `#ELSEIF` compare with the innermost `#RANDOM`, `#ELSE` / `#ELSEIF` act on the
 * innermost `#IF`, and `#CASE` / `#DEF` / `#SKIP` on the innermost `#SWITCH`.
 */
export function getCurrentFrame(stack: ReadonlyArray<ControlFlowFrame>, type: 'random'): RandomControlFrame | undefined;
export function getCurrentFrame(stack: ReadonlyArray<ControlFlowFrame>, type: 'if'): IfControlFrame | undefined;
export function getCurrentFrame(stack: ReadonlyArray<ControlFlowFrame>, type: 'switch'): SwitchControlFrame | undefined;
export function getCurrentFrame(
  stack: ReadonlyArray<ControlFlowFrame>,
  type: ControlFlowFrame['type'],
): ControlFlowFrame | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index]!;
    if (frame.type === type) {
      return frame;
    }
  }
  return undefined;
}

/** `#ENDIF` / `#ENDRANDOM` / `#ENDSW` remove the innermost frame of their kind, wherever it is on the stack. */
export function removeCurrentFrame(stack: ControlFlowFrame[], type: ControlFlowFrame['type']): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]!.type === type) {
      stack.splice(index, 1);
      return;
    }
  }
}
