/**
 * Which control buttons are down, and since when, from a screen's key events: what the screens need to read a button
 * held (START held opens a panel), held long (START+SELECT held quits a play), or pressed twice (START twice turns the
 * lane cover on and off). It reads nothing but the events and their `timeStamp`s, so it is as deterministic as they
 * are.
 *
 * A button is down from the first of its keys going down to the last of them coming up: a player who gave START two
 * keys holds it while either is held. A key's auto-repeats change nothing.
 */

import type { ControlButton } from './control-buttons.ts';

/** A button going down or up, as the tracker saw it. */
export interface ControlButtonChange {
  readonly button: ControlButton;
  readonly type: 'down' | 'up';
  readonly timeStamp: number;
  /** On a `down`: when the button last went down before, if it ever did (for a double press). */
  readonly previousDownAt?: number;
  /** On an `up`: how long it was down. */
  readonly heldMs?: number;
}

/** A key event as the tracker reads it: the key's physical code and the buttons it is. */
export interface ControlButtonKeyEvent {
  readonly type: 'down' | 'up';
  readonly code: string;
  readonly repeat: boolean;
  readonly timeStamp: number;
  readonly buttons: readonly ControlButton[];
}

export interface ControlButtonTracker {
  /** Takes a key event; returns the buttons that went down or up with it. */
  handle(event: ControlButtonKeyEvent): ControlButtonChange[];
  /** Whether `button` is down. */
  isDown(button: ControlButton): boolean;
  /** How long `button` has been down at `nowMs`, or `undefined` when it is up. */
  heldMs(button: ControlButton, nowMs: number): number | undefined;
  /** Lets every button go, without changes (the page lost focus, the screen left). */
  reset(): void;
}

export function createControlButtonTracker(): ControlButtonTracker {
  /** The keys (codes) holding each button down, and when it went down. */
  const down = new Map<ControlButton, { readonly codes: Set<string>; readonly at: number }>();
  const lastDownAt = new Map<ControlButton, number>();

  return {
    handle: (event) => {
      const changes: ControlButtonChange[] = [];
      if (event.repeat) return changes;
      for (const button of event.buttons) {
        const held = down.get(button);
        if (event.type === 'down') {
          if (held !== undefined) {
            held.codes.add(event.code);
            continue;
          }
          down.set(button, { codes: new Set([event.code]), at: event.timeStamp });
          const previousDownAt = lastDownAt.get(button);
          lastDownAt.set(button, event.timeStamp);
          changes.push({
            button,
            type: 'down',
            timeStamp: event.timeStamp,
            ...(previousDownAt !== undefined ? { previousDownAt } : {}),
          });
          continue;
        }
        if (held === undefined || !held.codes.delete(event.code) || held.codes.size > 0) continue;
        down.delete(button);
        changes.push({ button, type: 'up', timeStamp: event.timeStamp, heldMs: event.timeStamp - held.at });
      }
      return changes;
    },
    isDown: (button) => down.has(button),
    heldMs: (button, nowMs) => {
      const held = down.get(button);
      return held === undefined ? undefined : nowMs - held.at;
    },
    reset: () => {
      down.clear();
    },
  };
}
