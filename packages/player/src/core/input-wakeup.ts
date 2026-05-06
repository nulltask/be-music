import { effect } from 'alien-signals';
import type { PlayerInputSignalBus } from './input-signal-bus.ts';

/**
 * Awaitable wake-up triggered by `inputSignals.pushCommand`. The engine's manual-play / auto-play loops use
 * this to cut their inter-tick sleep short the moment a press lands mid-tick: instead of sleeping the full
 * 16.67 ms to the next 60 Hz boundary, the loop wakes up within ~1 ms and re-drains the input queue.
 *
 * Why this matters even with `pressedAt` already in place:
 * - `pressedAt` (introduced earlier in the latency-reduction work) ensures the JUDGE timestamp matches the
 *   physical press regardless of when the engine drains. So the lane judge result is already correct.
 * - This wake-up addresses a different latency: the AUDIO and VISUAL response. A keysound triggered at
 *   drain time is heard up to 16 ms sooner under event-driven wake-up; a lane flash queued at drain time
 *   reaches the next rAF boundary up to 16 ms earlier. For a player, this is the difference between "the
 *   game responded immediately" and "there's a tiny lag before the keysound fires."
 *
 * Implementation note: the wake-up owns a single shared "next wake-up" Promise that's re-armed each time it
 * resolves. Concurrent waiters all observe the same notification — there's no per-call resolver leak. This
 * matters because the engine loop calls `wait()` on every tick, and the alien-signals `effect` callback fires
 * once per `pushCommand`; without re-arming we'd either lose notifications or accumulate stale resolvers.
 */
export interface InputWakeUp {
  /**
   * Resolves on the next `inputSignals.pushCommand` call (= next `tick` increment). Subsequent calls observe
   * the next wake-up after that, so a caller can `wait()` in a loop without missing edges.
   */
  wait: () => Promise<void>;
  /**
   * Releases the alien-signals effect subscription and resolves any pending waiter so the engine loop can
   * exit cleanly. Idempotent.
   */
  dispose: () => void;
}

export function createInputWakeUp(inputSignals: PlayerInputSignalBus): InputWakeUp {
  let resolveNext: (() => void) | undefined;
  let nextWake: Promise<void> = new Promise<void>((resolve) => {
    resolveNext = resolve;
  });
  // `observedTick` advances only when a `wait()` call actually consumes the most-recent push. The effect
  // reads but doesn't update it. This produces level-triggered semantics: a push that happens BETWEEN the
  // loop's `consumeInputCommands` and its next `wait()` is still observed by that next `wait()` (it
  // returns immediately rather than blocking until a subsequent push). Without this, a push landing in
  // that window would be "missed" by the wake-up and the loop would sleep up to a full tick before
  // re-draining — the exact latency this whole helper is meant to eliminate.
  let observedTick = inputSignals.tick();
  let disposed = false;

  // alien-signals' `effect` re-runs whenever any signal it reads changes. Reading `inputSignals.tick()` here
  // subscribes us to its updates; the effect fires after every `pushCommand`. We compare against
  // `observedTick` so the initial run (which sees the current tick value, not a change) doesn't fire the
  // resolver.
  const unsubscribe = effect(() => {
    const tick = inputSignals.tick();
    if (tick === observedTick) return;
    const pendingResolve = resolveNext;
    // Re-arm BEFORE resolving so any synchronous waiter that immediately re-`wait()`s in their `.then()`
    // observes the freshly-armed promise rather than the one we're about to resolve.
    nextWake = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
    pendingResolve?.();
  });

  return {
    wait: () => {
      if (disposed) return Promise.resolve();
      const currentTick = inputSignals.tick();
      if (currentTick !== observedTick) {
        // A push landed since the last `wait()` returned (or since construction). Consume it synchronously
        // — the caller doesn't need to block.
        observedTick = currentTick;
        return Promise.resolve();
      }
      return nextWake;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      resolveNext?.();
    },
  };
}
