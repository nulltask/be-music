import {
  DEFAULT_CONTROL_ACTIONS,
  type ControlActionKeyEvent,
  type ControlActionMap,
} from '../controls/control-actions.ts';

/** The subset of a `KeyboardEvent` the result-screen key matchers read. */
export interface ResultKeyEvent extends ControlActionKeyEvent {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** What a key press asks of the result screen. */
export type ResultKeyAction =
  | { readonly type: 'retry' }
  | { readonly type: 'leave' }
  | { readonly type: 'continue' }
  | { readonly type: 'save-replay'; readonly slot: number };

/**
 * Whether a key press asks the result screen to retry the chart: a bare R by default. Presses with a modifier are left
 * alone so browser shortcuts such as Ctrl / Cmd+R (reload) keep working, and auto-repeats are ignored so a held key
 * can't fire a second retry.
 */
export function isResultRetryKey(
  event: ResultKeyEvent,
  actions: ControlActionMap = DEFAULT_CONTROL_ACTIONS.lr2,
): boolean {
  return !event.repeat && actions.is('result.retry', event);
}

/**
 * The replay slot (0-3) a key press saves into: a bare 1-4 by default, as beatoraja's result takes its number keys
 * (`ControlKeys.NUM1`-`NUM4`). Modified presses and auto-repeats save nothing.
 */
export function resultReplaySlotKey(
  event: ResultKeyEvent,
  actions: ControlActionMap = DEFAULT_CONTROL_ACTIONS.lr2,
): number | undefined {
  if (event.repeat) return undefined;
  const slots = [
    'result.save-replay-1',
    'result.save-replay-2',
    'result.save-replay-3',
    'result.save-replay-4',
  ] as const;
  const slot = slots.findIndex((id) => actions.is(id, event));
  return slot >= 0 ? slot : undefined;
}

/**
 * What a key press asks of the result screen by the player's keys (`actions`), in the order the screen takes them: a
 * retry (only when one is offered), leaving (Escape), the next step (Enter / Space) and a replay slot.
 */
export function resolveResultKeyAction(
  event: ResultKeyEvent,
  retryOffered: boolean,
  actions: ControlActionMap = DEFAULT_CONTROL_ACTIONS.lr2,
): ResultKeyAction | undefined {
  if (retryOffered && isResultRetryKey(event, actions)) return { type: 'retry' };
  if (actions.is('result.leave', event)) return { type: 'leave' };
  if (actions.is('result.continue', event)) return { type: 'continue' };
  const slot = resultReplaySlotKey(event, actions);
  return slot === undefined ? undefined : { type: 'save-replay', slot };
}
