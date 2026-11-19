import type { CreatePlayerInputRuntimeContext, PlayerInputRuntime } from '@be-music/player-engine';
import type { InputSource, PlayerInputSignalBus } from '@be-music/player-engine/signals';
import { isIIDXArcadeGamepad, sampleArcadeScratch, type ArcadeScratchState } from './arcade-gamepad.ts';
import { logger } from '../logger.ts';

const log = logger('web-input-runtime');

/**
 * Construction-time inputs for {@link createWebInputRuntime}. The runtime forwards keyboard and standard Gamepad
 * presses / releases into the engine's `inputSignals` bus as `lane-input` / `kitty-state` commands, so its judge /
 * fallback / LN logic needs no runtime-specific code path. Unlike the TUI it sends no `high-speed` command (the TUI's
 * Alt / Option + lane shortcut): the play session steps the hi-speed with the arrow keys itself.
 */
export interface WebInputRuntimeOptions {
  inputSignals: PlayerInputSignalBus;
  /**
   * Map produced by {@link createInputTokenToChannelsMap} (re-exported through the engine's
   * {@link CreatePlayerInputRuntimeContext}). Used to keep a bound F5 as a lane key; the runtime sends raw tokens and the engine owns the
   * lane resolution path.
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
  /** Whether to poll standard-mapped gamepads using the CS DualShock lane layout. Defaults to enabled. */
  gamepadInput?: boolean;
}

/** The CS DualShock layout expressed as Web Gamepad standard button indices and IIDX lane channels. */
export const CS_GAMEPAD_BUTTON_CHANNELS: Readonly<Record<number, string>> = {
  // The CS version assigns the D-pad as one control for the first white key.
  12: '1',
  4: '2', // L1: left black key
  2: '3', // Square: second white key
  5: '4', // R1: middle black key
  0: '5', // Cross: third white key
  3: '8', // Triangle: right black key
  1: '9', // Circle: fourth white key
  6: '6', // L2: turntable, clockwise
  7: '6', // R2: turntable, counter-clockwise
};

const rawGamepadEvents = ['gamepadrawinputchanged', 'gamepadrawinputchange', 'rawgamepadinputchange'] as const;
const gamepadPollIntervalMs = 4;
const gamepadPressThreshold = 0.5;

/**
 * Web-side adapter for the engine's `PlayerInputRuntime` contract. `start()` attaches the `keydown` / `keyup`
 * listeners, listens for raw Gamepad input and polls as a fallback; `stop()` detaches and releases held inputs. Pressing a key resolves to
 * its lowercase token (matching the {@link createLaneBindings} convention — `'z'`, `'shift-left'`, etc.) and pushes a `lane-input` command. Special
 * shortcuts (`Escape`, `F5` for restart, `Pause` for pause) are routed through `interrupt` / `toggle-pause`
 * commands so the engine sees the same control surface the TUI exposes.
 *
 * A browser reports every key release (`keyup`), so the runtime declares `reportsKeyReleases`: the engine judges the
 * play as key-state input from its first key instead of inferring when the first key came up.
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
  let gamepadTimer: ReturnType<typeof setInterval> | undefined;
  const gamepadTarget = typeof window === 'undefined' ? undefined : window;
  const latestGamepadSample = new Map<number, Gamepad>();
  const scratchByPad = new Map<number, ArcadeScratchState>();
  const padSlots: [number | undefined, number | undefined] = [undefined, undefined];
  const arcadeButtonChannels = ['1', '2', '3', '4', '5', '8', '9'];
  const gamepadButtons = new Map<
    string,
    {
      pressed: boolean;
      token: string;
      source: InputSource;
      code: string;
    }
  >();

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
    if (keyEvent.code === 'F5' && !options.inputTokenToChannels.has('f5')) {
      // F5 is the LR2 / beatoraja convention for restart. Block the browser's reload before the engine handles it.
      keyEvent.preventDefault();
      options.inputSignals.pushCommand({ kind: 'interrupt', reason: 'restart' });
      return;
    }
    if (keyEvent.code === 'Pause') {
      keyEvent.preventDefault();
      options.inputSignals.pushCommand({ kind: 'toggle-pause' });
      return;
    }
    const tokens = keyboardEventToTokens(keyEvent);
    if (tokens.length === 0) return;
    // The engine's `inputTokenToChannels` decides whether tokens map to lane channels, scratch channels, or no-op.
    // We just hand over the raw token list — the engine owns the rest of the lookup chain.
    keyEvent.preventDefault();
    // `KeyboardEvent.timeStamp` is a `DOMHighResTimeStamp` on the same time origin as `performance.now()`. We
    // promote it to the wall-clock-ms domain (`Date.now()`-equivalent with sub-ms precision) by adding
    // `performance.timeOrigin` so the value is process-shared the same way the TUI's `pressedAt` is — the
    // engine reads it the same way regardless of runtime. The engine then subtracts the wall-clock delta
    // between this and its drain time so the judge resolves against the true press moment instead of "next
    // 60 Hz tick" — eliminates up to ~16 ms of late-bias on every press.
    const pressedAt = performance.timeOrigin + keyEvent.timeStamp;
    options.inputSignals.pushCommand({
      kind: 'lane-input',
      tokens,
      // The physical key, for the replay (`ReplayInputEvent.code`): the tokens are normalised from it.
      code: keyEvent.code,
      pressedAt,
    });
    // ALSO emit a kitty-state press: it is what holds the lane down in the engine's judge (key-state input — a lane
    // is down from its kitty-state press to its release), so a long note stays held for as long as the key is. It
    // also promotes the lane laser from a brief `flash-lane` flicker to a sustained `press-lane` so the lane glow
    // lasts the full hold (`applyEngineCommand` switches between the two on the view side). Browsers don't expose
    // the Kitty protocol so we synthesize the event here from the regular keydown — release symmetry lives in
    // `handleKeyUp` below. `pressTokens` mirrors the raw token list (the engine resolves channels itself).
    options.inputSignals.pushCommand({
      kind: 'kitty-state',
      pressTokens: tokens,
      repeatTokens: [],
      releaseTokens: [],
      code: keyEvent.code,
      pressedAt,
    });
  };

  const handleKeyUp = (event: Event): void => {
    if (typeof (event as KeyboardEvent).code !== 'string') return;
    const keyEvent = event as KeyboardEvent;
    const tokens = keyboardEventToTokens(keyEvent);
    if (tokens.length === 0) return;
    // `kitty-state` carries press / repeat / release sets so the engine can model held inputs precisely. Web
    // browsers don't expose Kitty-style protocol events, so we synthesize a minimal release-only shape — the
    // engine's LN release path keys on `releaseTokens` and ignores press / repeat in this case.
    // `pressedAt` here represents the release event's timestamp (same wall-clock-ms domain as `lane-input`): the
    // replay records the release at that instant, as it records a press.
    options.inputSignals.pushCommand({
      kind: 'kitty-state',
      pressTokens: [],
      repeatTokens: [],
      releaseTokens: tokens,
      code: keyEvent.code,
      pressedAt: performance.timeOrigin + keyEvent.timeStamp,
    });
  };

  const sampleGamepads = (pads: readonly (Gamepad | null)[], partial = false): void => {
    const seen = new Set<string>();
    const nowMs = performance.now();
    const pressedAt = performance.timeOrigin + nowMs;
    const mappedPads = pads
      .filter(
        (pad): pad is Gamepad =>
          pad !== null && pad.connected !== false && (pad.mapping === 'standard' || isIIDXArcadeGamepad(pad)),
      )
      .map((pad) => {
        const previous = latestGamepadSample.get(pad.index);
        // A timer snapshot or queued event can be older than the last sample we consumed.
        if (previous !== undefined && previous.id === pad.id && previous.timestamp > pad.timestamp && pad.timestamp > 0)
          return previous;
        latestGamepadSample.set(pad.index, pad);
        return pad;
      });
    if (!partial) {
      for (const index of latestGamepadSample.keys()) {
        if (!mappedPads.some((pad) => pad.index === index)) latestGamepadSample.delete(index);
      }
      for (const index of scratchByPad.keys()) {
        if (!mappedPads.some((pad) => pad.index === index && isIIDXArcadeGamepad(pad))) scratchByPad.delete(index);
      }
      for (const [slot, index] of padSlots.entries()) {
        if (!mappedPads.some((pad) => pad.index === index)) padSlots[slot] = undefined;
      }
    }
    for (const pad of mappedPads) {
      const slot = padSlots.indexOf(undefined);
      if (slot !== -1 && !padSlots.includes(pad.index)) padSlots[slot] = pad.index;
    }
    for (const [slot, index] of padSlots.entries()) {
      const pad = mappedPads.find((candidate) => candidate.index === index);
      if (!pad) continue;
      const sidePrefix = String(slot + 1);
      const arcade = isIIDXArcadeGamepad(pad);
      const scratch = arcade ? sampleArcadeScratch(pad.axes[0]!, nowMs, scratchByPad.get(pad.index)) : undefined;
      if (scratch !== undefined) scratchByPad.set(pad.index, scratch);
      else scratchByPad.delete(pad.index);
      const channels = arcade ? { ...arcadeButtonChannels, 17: '6', 18: '6' } : CS_GAMEPAD_BUTTON_CHANNELS;
      const buttonPressed = (button: GamepadButton | undefined): boolean =>
        button !== undefined && (button.pressed || button.value >= gamepadPressThreshold);
      for (const [buttonIndexText, channelSuffix] of Object.entries(channels)) {
        const buttonIndex = Number(buttonIndexText);
        const isDpad = !arcade && buttonIndex === 12;
        const isAxis = arcade && buttonIndex >= 17;
        const scratchDirection =
          buttonIndex === (arcade ? 17 : 6) ? 'up' : buttonIndex === (arcade ? 18 : 7) ? 'down' : undefined;
        const token = tokenForChannel(options.inputTokenToChannels, `${sidePrefix}${channelSuffix}`);
        if (token === undefined) continue;
        const key = `${sidePrefix}:${pad.index}:${arcade}:${buttonIndex}`;
        seen.add(key);
        const pressed = isAxis
          ? scratch?.direction === scratchDirection
          : isDpad
            ? pad.buttons.slice(12, 16).some(buttonPressed)
            : buttonPressed(pad.buttons[buttonIndex]);
        const previous = gamepadButtons.get(key);
        if ((previous?.pressed ?? false) === pressed) continue;
        // `deviceName` is the pad's `Gamepad.id`; the replay keeps it only when the player opted in
        // (`ReplayRecordingOptions.includeDeviceNames`), and judging never reads it.
        const source: InputSource =
          scratchDirection === undefined
            ? {
                kind: 'button',
                device: 'controller',
                label: isDpad ? `p${sidePrefix}-dpad` : `p${sidePrefix}-b${buttonIndex}`,
                ...(pad.id !== '' ? { deviceName: pad.id } : {}),
              }
            : {
                kind: 'turntable',
                device: 'controller',
                label: `p${sidePrefix}-tt`,
                direction: scratchDirection,
                ...(pad.id !== '' ? { deviceName: pad.id } : {}),
              };
        const code = isAxis
          ? `gamepad-axis-x-${scratchDirection}`
          : isDpad
            ? 'gamepad-dpad'
            : `gamepad-button-${buttonIndex}`;
        gamepadButtons.set(key, { pressed, token, source, code });
        if (pressed) {
          options.inputSignals.pushCommand({
            kind: 'lane-input',
            tokens: [token],
            source,
            ...(scratchDirection !== undefined ? { spin: scratchDirection === 'up' ? 'cw' : 'ccw' } : {}),
            code,
            pressedAt,
          });
          options.inputSignals.pushCommand({
            kind: 'kitty-state',
            pressTokens: [token],
            repeatTokens: [],
            releaseTokens: [],
            source,
            code,
            pressedAt,
          });
        } else {
          options.inputSignals.pushCommand({
            kind: 'kitty-state',
            pressTokens: [],
            repeatTokens: [],
            releaseTokens: [token],
            source,
            code,
            pressedAt,
          });
        }
      }
    }
    if (partial) return;
    // A disconnected pad or a button disappearing from a changed mapping must release any held long note.
    for (const [key, previous] of gamepadButtons) {
      if (seen.has(key)) continue;
      if (previous.pressed) {
        options.inputSignals.pushCommand({
          kind: 'kitty-state',
          pressTokens: [],
          repeatTokens: [],
          releaseTokens: [previous.token],
          source: previous.source,
          code: previous.code,
          pressedAt: performance.timeOrigin + performance.now(),
        });
      }
      gamepadButtons.delete(key);
    }
  };

  const pollGamepads = (): void => {
    let pads: Array<Gamepad | null>;
    try {
      pads = Array.from(navigator.getGamepads());
    } catch {
      return;
    }
    sampleGamepads(pads);
  };

  const onRawGamepadInput = (event: Event): void => {
    const pad = (event as GamepadEvent).gamepad;
    if (attached && pad) sampleGamepads([pad], true);
  };

  return {
    reportsKeyReleases: true,
    start: (): void => {
      if (attached) return;
      target.addEventListener('keydown', handleKeyDown);
      target.addEventListener('keyup', handleKeyUp);
      attached = true;
      if (options.gamepadInput !== false) {
        for (const event of rawGamepadEvents) gamepadTarget?.addEventListener(event, onRawGamepadInput);
        if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
          pollGamepads();
          gamepadTimer = setInterval(pollGamepads, gamepadPollIntervalMs);
        }
      }
      log.debug('input listeners attached');
    },
    stop: (): void => {
      if (!attached) return;
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('keyup', handleKeyUp);
      for (const event of rawGamepadEvents) gamepadTarget?.removeEventListener(event, onRawGamepadInput);
      if (gamepadTimer !== undefined) {
        clearInterval(gamepadTimer);
        gamepadTimer = undefined;
      }
      const releasedAt = performance.timeOrigin + performance.now();
      for (const previous of gamepadButtons.values()) {
        if (!previous.pressed) continue;
        options.inputSignals.pushCommand({
          kind: 'kitty-state',
          pressTokens: [],
          repeatTokens: [],
          releaseTokens: [previous.token],
          source: previous.source,
          code: previous.code,
          pressedAt: releasedAt,
        });
      }
      gamepadButtons.clear();
      scratchByPad.clear();
      latestGamepadSample.clear();
      padSlots.fill(undefined);
      attached = false;
      log.debug('input listeners detached');
    },
  };
}

function tokenForChannel(
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>,
  channel: string,
): string | undefined {
  for (const [token, channels] of inputTokenToChannels) {
    if (channels.includes(channel)) return token;
  }
  return undefined;
}

/**
 * Maps a `KeyboardEvent` to the engine's lowercase-token convention. The engine's `inputTokenToChannels` map keys
 * off the `inputTokens` field of each `LaneBinding` (`packages/player-engine/src/core/lane-layout.ts`), which uses lowercase
 * letter / symbol strings (`'z'`, `'shift-left'`, etc.); we mirror that here so a chart's _____5KEY_SP_BINDINGS
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
export function keyboardEventToTokens(event: Pick<KeyboardEvent, 'code'>): string[] {
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
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return [code.toLowerCase()];
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
    case 'Minus':
      return ['-'];
    case 'Equal':
      return ['='];
    case 'BracketLeft':
      return ['['];
    case 'BracketRight':
      return [']'];
    case 'Backslash':
      return ['\\'];
    case 'Backquote':
      return ['`'];
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
 *
 * `onReady` fires synchronously during runtime construction with the engine-side `inputSignals` bus the runtime
 * is wired into. Hosts that need to push their own input commands (`toggle-pause` from a pause-key handler the
 * host kept on the view side, etc.) capture the reference here.
 */
export function createWebInputRuntimeFactory(
  baseOptions: Omit<WebInputRuntimeOptions, 'inputSignals' | 'inputTokenToChannels'> & {
    onReady?: (signals: { inputSignals: PlayerInputSignalBus }) => void;
  },
): (context: CreatePlayerInputRuntimeContext) => PlayerInputRuntime {
  return (context) => {
    try {
      baseOptions.onReady?.({ inputSignals: context.inputSignals });
    } catch (error) {
      log.warn('createWebInputRuntimeFactory.onReady threw', error);
    }
    return createWebInputRuntime({
      ...baseOptions,
      inputSignals: context.inputSignals,
      inputTokenToChannels: context.inputTokenToChannels,
    });
  };
}
