/**
 * The physical input a lane press or release came from (#605): one key of a keyboard, one button of a controller, a
 * touch zone, or one rotation direction of a turntable. Keyboard keys, controller buttons and the two directions of a
 * turntable share this one model, so beatoraja's scratch rules — a scratch hold remembers the source that started it
 * (`sckey` in `JudgeManager`) — apply to every device alike.
 *
 * A source names a coarse device class and a normalised label only. It never carries anything that identifies the
 * device itself: no `Gamepad.id`, no vendor or product id, no serial.
 */

/** `key` and `button` are digital inputs; `turntable` is one rotation direction of a turntable. */
export type InputSourceKind = 'key' | 'button' | 'turntable';
/** The coarse class of device a source belongs to. */
export type InputSourceDevice = 'keyboard' | 'controller' | 'touch';
/** The way a turntable source turns. A turntable is always two sources, `up` and `down`. */
export type TurntableDirection = 'up' | 'down';

export interface InputSource {
  kind: InputSourceKind;
  device: InputSourceDevice;
  /** A normalised name (`'shift-left'`, `'b1'`, `'tt'`), never a device string. Lowercase, no whitespace. */
  label: string;
  /** Present on a `turntable` source only, and required there. */
  direction?: TurntableDirection;
}

const INPUT_SOURCE_KINDS: ReadonlySet<unknown> = new Set(['key', 'button', 'turntable']);
const INPUT_SOURCE_DEVICES: ReadonlySet<unknown> = new Set(['keyboard', 'controller', 'touch']);
const TURNTABLE_DIRECTIONS: ReadonlySet<unknown> = new Set(['up', 'down']);
/** Printable ASCII without spaces, 1 to 32 characters. */
const INPUT_SOURCE_LABEL = /^[\x21-\x7e]{1,32}$/;

export function isInputSourceKind(value: unknown): value is InputSourceKind {
  return INPUT_SOURCE_KINDS.has(value);
}

export function isInputSourceDevice(value: unknown): value is InputSourceDevice {
  return INPUT_SOURCE_DEVICES.has(value);
}

export function isTurntableDirection(value: unknown): value is TurntableDirection {
  return TURNTABLE_DIRECTIONS.has(value);
}

/** True for a normalised label: printable ASCII without whitespace or uppercase letters, at most 32 characters. */
export function isInputSourceLabel(value: unknown): value is string {
  return typeof value === 'string' && INPUT_SOURCE_LABEL.test(value) && value === value.toLowerCase();
}

/**
 * A string that is equal for two sources exactly when they are the same physical input. The judge core keys lane holds
 * and ANY KEY routes by it, so a live play and a replay of it see the same keys.
 */
export function inputSourceKey(source: InputSource): string {
  return source.direction === undefined
    ? `${source.device}/${source.kind}/${source.label}`
    : `${source.device}/${source.kind}/${source.label}/${source.direction}`;
}

/** True when both are the same source, or both are unknown. */
export function isSameInputSource(left: InputSource | undefined, right: InputSource | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return inputSourceKey(left) === inputSourceKey(right);
}

/**
 * The source of a keyboard press or release: the key its first token names (`'shift-left'`, `'z'`). Each physical key
 * bound to a lane is its own source — a scratch lane's Shift, Ctrl and Space are three. `undefined` without tokens.
 */
export function keyboardInputSource(tokens: readonly string[]): InputSource | undefined {
  const token = tokens[0]?.toLowerCase();
  return token === undefined || !isInputSourceLabel(token)
    ? undefined
    : { kind: 'key', device: 'keyboard', label: token };
}

/**
 * Whether a scratch hold started by `source` can be ended by ANOTHER source on the same lane, so beatoraja's strict
 * rules apply to it. A turntable direction always has the other direction, and every keyboard scratch lane has at
 * least two keys (Shift, and Ctrl or Option / Alt with Space on 1P; `createLaneBindings`). A touch zone, a controller
 * button and an unknown source are the only input of their kind on the lane, so a hold they start falls back to the
 * lenient rule: any fresh press on the lane ends it, whichever source it comes from, and a release settles nothing.
 */
export function hasScratchCounterpart(source: InputSource | undefined): boolean {
  return source !== undefined && (source.kind === 'turntable' || source.device === 'keyboard');
}

/**
 * Whether a press from `press` ends a back-spin scratch whose head was hit from `head` (beatoraja's "BSS終端処理"): a
 * press from any other source does; a press from the head's own source does only under the lenient rule
 * ({@link hasScratchCounterpart}).
 */
export function endsBackSpinScratch(head: InputSource | undefined, press: InputSource | undefined): boolean {
  return !hasScratchCounterpart(head) || !isSameInputSource(head, press);
}

/**
 * Whether a release from `release` lets go of a scratch long note (or, for a back-spin scratch, may end it) whose
 * head was hit from `head`, under beatoraja's rule: only the head's own source does. Unknown sources match anything,
 * so input recorded without a source keeps the lane-level behaviour.
 */
export function releasesScratchHold(head: InputSource | undefined, release: InputSource | undefined): boolean {
  return head === undefined || release === undefined || isSameInputSource(head, release);
}

/** An input source with the id a replay's `play.inputSources` table gives it. */
export interface IdentifiedInputSource extends InputSource {
  id: number;
}

/** The sources a play used, numbered in the order they first appeared (a replay's `play.inputSources`). */
export interface InputSourceTable {
  /** The id of `source`, registering it if it is new. */
  idOf(source: InputSource): number;
  /** The table, in id order. */
  list(): IdentifiedInputSource[];
  clear(): void;
}

export function createInputSourceTable(): InputSourceTable {
  const ids = new Map<string, number>();
  const sources: IdentifiedInputSource[] = [];
  return {
    idOf: (source) => {
      const key = inputSourceKey(source);
      const known = ids.get(key);
      if (known !== undefined) return known;
      const id = sources.length;
      ids.set(key, id);
      sources.push({
        id,
        kind: source.kind,
        device: source.device,
        label: source.label,
        ...(source.direction !== undefined ? { direction: source.direction } : {}),
      });
      return id;
    },
    list: () => sources.map((source) => ({ ...source })),
    clear: () => {
      ids.clear();
      sources.length = 0;
    },
  };
}

/** Looks a recorded source id up in a replay's table: `undefined` for an id the table does not hold. */
export function createInputSourceLookup(
  sources: readonly IdentifiedInputSource[] | undefined,
): (id: number | undefined) => InputSource | undefined {
  const byId = new Map<number, InputSource>();
  for (const source of sources ?? []) byId.set(source.id, source);
  return (id) => (id === undefined ? undefined : byId.get(id));
}
