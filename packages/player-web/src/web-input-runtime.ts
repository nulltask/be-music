import type { CreatePlayerInputRuntimeContext, PlayerInputRuntime } from '@be-music/player/core/engine';
import type { PlayerInputSignalBus } from '@be-music/player/core/input-signal-bus';
import { logger } from './logger.ts';

const log = logger('web-input-runtime');

/**
 * Construction-time inputs for {@link createWebInputRuntime}. The factory closes over the host's `KeyboardEvent`
 * source (typically `window`) and forwards every press / release into the engine's `inputSignals` bus as the same
 * `lane-input` / `toggle-pause` / `interrupt` / `high-speed` commands the TUI runtime emits — that way the engine's
 * judge / fallback / LN logic doesn't need a runtime-specific code path.
 */
export interface WebInputRuntimeOptions {
  inputSignals: PlayerInputSignalBus;
  /**
   * Map produced by {@link createInputTokenToChannelsMap} (re-exported through the engine's
   * {@link CreatePlayerInputRuntimeContext}). Used here only for the high-speed-modifier token lookup; the engine
   * owns the full lane resolution path.
   */
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>;
  /**
   * Source of `keydown` / `keyup` events. Defaults to `window` when omitted, but callers can pass a more scoped
   * target (e.g. a focusable canvas) so other inputs on the page don't bleed into chart input.
   */
  target?: EventTarget;
  /**
   * Optional hook fired before each keydown is processed. Returning `true` suppresses the event (e.g. when an
   * overlay modal owns focus). The runtime still calls `preventDefault` so the browser's default key handling
   * doesn't leak through.
   */
  shouldSkipKey?: (event: KeyboardEvent) => boolean;
}

/**
 * Web-side adapter for the engine's `PlayerInputRuntime` contract. `start()` attaches the `keydown` / `keyup`
 * listeners; `stop()` detaches them. Pressing a key resolves to its lowercase token (matching the
 * {@link createLaneBindings} convention — `'z'`, `'shift-left'`, etc.) and pushes a `lane-input` command. Special
 * shortcuts (`Escape`, `F5` for restart, `Space` for pause) are routed through `interrupt` / `toggle-pause`
 * commands so the engine sees the same control surface the TUI exposes.
 *
 * Browser-specific concerns kept off the engine side:
 * - `KeyboardEvent.repeat` is filtered (we don't want OS auto-repeat to cause spurious lane judgements).
 * - `Tab` and modifier-only presses are ignored (they would otherwise produce empty token lists that the engine
 *   would still log as lane-input attempts).
 * - `F5` reload is intercepted (`preventDefault`) before the browser can reload the page.
 */
export function createWebInputRuntime(options: WebInputRuntimeOptions): PlayerInputRuntime {
  const target: EventTarget = options.target ?? globalThis;
  let attached = false;

  const handleKeyDown = (event: Event): void => {
    // Duck-type check rather than `instanceof KeyboardEvent` so the runtime is testable in Node (no DOM globals).
    // Production browser code always satisfies the shape; the test harness mocks it.
    if (typeof (event as KeyboardEvent).code !== 'string') return;
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.repeat) return;
    if (options.shouldSkipKey?.(keyEvent)) return;

    // Special control keys are handled BEFORE the lane-token resolution so a key without a meaningful lane mapping
    // (Escape / F5 / etc.) still gets routed to its corresponding interrupt / pause command.
    if (keyEvent.code === 'Escape') {
      keyEvent.preventDefault();
      options.inputSignals.pushCommand({ kind: 'interrupt', reason: 'escape' });
      return;
    }
    if (keyEvent.code === 'F5') {
      // F5 is the LR2 / beatoraja convention for restart. Block the browser's reload before the engine handles it.
      keyEvent.preventDefault();
      options.inputSignals.pushCommand({ kind: 'interrupt', reason: 'restart' });
      return;
    }
    if (keyEvent.code === 'Space') {
      keyEvent.preventDefault();
      options.inputSignals.pushCommand({ kind: 'toggle-pause' });
      return;
    }
    const tokens = keyboardEventToTokens(keyEvent);
    if (tokens.length === 0) return;
    // The engine's `inputTokenToChannels` decides whether tokens map to lane channels, scratch channels, or no-op.
    // We just hand over the raw token list — the engine owns the rest of the lookup chain.
    keyEvent.preventDefault();
    options.inputSignals.pushCommand({ kind: 'lane-input', tokens });
  };

  const handleKeyUp = (event: Event): void => {
    if (typeof (event as KeyboardEvent).code !== 'string') return;
    const tokens = keyboardEventToTokens(event as KeyboardEvent);
    if (tokens.length === 0) return;
    // `kitty-state` carries press / repeat / release sets so the engine can model held inputs precisely. Web
    // browsers don't expose Kitty-style protocol events, so we synthesize a minimal release-only shape — the
    // engine's LN release path keys on `releaseTokens` and ignores press / repeat in this case.
    options.inputSignals.pushCommand({
      kind: 'kitty-state',
      pressTokens: [],
      repeatTokens: [],
      releaseTokens: tokens,
    });
  };

  return {
    start: (): void => {
      if (attached) return;
      target.addEventListener('keydown', handleKeyDown);
      target.addEventListener('keyup', handleKeyUp);
      attached = true;
      log.debug('input listeners attached');
    },
    stop: (): void => {
      if (!attached) return;
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('keyup', handleKeyUp);
      attached = false;
      log.debug('input listeners detached');
    },
  };
}

/**
 * Maps a `KeyboardEvent` to the engine's lowercase-token convention. The engine's `inputTokenToChannels` map keys
 * off the `inputTokens` field of each `LaneBinding` (`packages/player/src/core/lane-layout.ts`), which uses lowercase
 * letter / symbol strings (`'z'`, `'shift-left'`, etc.); we mirror that here so a chart's IIDX_5KEY_SP_BINDINGS
 * (`{ inputTokens: ['shift-left'] }`) gets routed correctly when the player presses Left Shift.
 *
 * Modifier-aware forms are emitted in BOTH variants when applicable — pressing Left Shift produces both
 * `'shift-left'` and `'shift'` so a chart binding either spelling matches.
 *
 * Returns an empty array for keys without a meaningful mapping (the engine treats empty token lists as no-ops, so
 * upstream callers don't need to special-case them).
 *
 * Exported for testability — the runtime calls it internally per event.
 */
export function keyboardEventToTokens(event: KeyboardEvent): string[] {
  const code = event.code;
  // Fast path: KeyA..KeyZ → 'a'..'z'.
  if (code.length === 4 && code.startsWith('Key')) {
    const letter = code.charAt(3).toLowerCase();
    if (letter >= 'a' && letter <= 'z') return [letter];
  }
  // Digits: Digit0..Digit9 → '0'..'9' (used by some 9-key skins as alternate bindings).
  if (code.length === 6 && code.startsWith('Digit')) {
    return [code.charAt(5)];
  }
  switch (code) {
    case 'ShiftLeft':
      return ['shift-left', 'shift'];
    case 'ShiftRight':
      return ['shift-right', 'shift'];
    case 'ControlLeft':
      return ['ctrl-left', 'ctrl'];
    case 'ControlRight':
      return ['ctrl-right', 'ctrl'];
    case 'AltLeft':
      return ['alt-left', 'alt'];
    case 'AltRight':
      return ['alt-right', 'alt'];
    case 'Space':
      return ['space'];
    case 'Enter':
      return ['enter'];
    case 'Escape':
      return ['escape'];
    case 'Tab':
      return ['tab'];
    case 'Semicolon':
      return [';'];
    case 'Comma':
      return [','];
    case 'Period':
      return ['.'];
    case 'Slash':
      return ['/'];
    case 'ArrowUp':
      return ['up'];
    case 'ArrowDown':
      return ['down'];
    case 'ArrowLeft':
      return ['left'];
    case 'ArrowRight':
      return ['right'];
    default:
      return [];
  }
}

/**
 * Convenience factory matching the shape `PlayerOptions.createInputRuntime` expects. Closes over a single
 * {@link WebInputRuntimeOptions} so callers can pass `{ createInputRuntime: createWebInputRuntimeFactory(...) }`
 * directly to `manualPlay` / `autoPlay`.
 */
export function createWebInputRuntimeFactory(
  baseOptions: Omit<WebInputRuntimeOptions, 'inputSignals' | 'inputTokenToChannels'>,
): (context: CreatePlayerInputRuntimeContext) => PlayerInputRuntime {
  return (context) =>
    createWebInputRuntime({
      ...baseOptions,
      inputSignals: context.inputSignals,
      inputTokenToChannels: context.inputTokenToChannels,
    });
}
