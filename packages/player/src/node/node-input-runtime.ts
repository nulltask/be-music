import readline from 'node:readline';
import {
  beginKittyKeyboardProtocolOptIn,
  resolveInputTokenEvent,
} from '../manual-input.ts';
import { resolveHighSpeedControlActionFromLaneChannels, type HighSpeedControlAction } from '../core/high-speed-control.ts';
import type { PlayerInputSignalBus } from '../core/player-input-signal-bus.ts';

export interface NodeInputRuntimeOptions {
  mode: 'auto' | 'manual';
  inputSignals: PlayerInputSignalBus;
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>;
}

export interface NodeInputRuntime {
  start: () => void;
  stop: () => void;
}

export function createNodeInputRuntime(options: NodeInputRuntimeOptions): NodeInputRuntime {
  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const canCaptureInput = process.stdin.isTTY;
  let started = false;
  let stopped = false;
  let wasRawMode = false;
  let suppressLegacyKeypressUntilMs = 0;
  let stopKittyKeyboardProtocol: () => void = () => undefined;

  const emitInterrupt = (reason: 'escape' | 'ctrl-c' | 'restart'): void => {
    options.inputSignals.pushCommand({
      kind: 'interrupt',
      reason,
    });
  };

  const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
    if (options.mode === 'manual' && Date.now() < suppressLegacyKeypressUntilMs) {
      return;
    }
    const inputEvent = resolveInputTokenEvent(chunk ?? '', key);
    if (options.mode === 'manual' && inputEvent.kittyProtocolEvent) {
      return;
    }
    const tokens = inputEvent.tokens;

    if (key.sequence === '\u0003' || tokens.includes('ctrl+c')) {
      emitInterrupt('ctrl-c');
      return;
    }
    if (key.name?.toLowerCase() === 'escape' || key.sequence === '\u001b' || tokens.includes('escape')) {
      emitInterrupt('escape');
      return;
    }
    if (isRestartInputTokens(tokens) || isRestartKeyPress(chunk, key)) {
      emitInterrupt('restart');
      return;
    }

    const highSpeedAction = resolveHighSpeedControlActionFromAltLaneTokens(tokens, options.inputTokenToChannels, key);
    if (highSpeedAction) {
      options.inputSignals.pushCommand({
        kind: 'high-speed',
        action: highSpeedAction,
      });
      return;
    }

    if (tokens.includes('space') || isSpaceKey(key)) {
      options.inputSignals.pushCommand({
        kind: 'toggle-pause',
      });
      return;
    }

    if (options.mode === 'manual' && tokens.length > 0) {
      options.inputSignals.pushCommand({
        kind: 'lane-input',
        tokens: [...tokens],
      });
    }
  };

  const onRawInputData = (data: Buffer): void => {
    if (options.mode !== 'manual') {
      return;
    }
    const chunk = data.toString('utf8');
    const inputEvent = resolveInputTokenEvent(chunk, {
      name: undefined,
      sequence: chunk,
      ctrl: false,
      meta: false,
      shift: false,
    } satisfies readline.Key);
    if (!inputEvent.kittyProtocolEvent) {
      return;
    }

    suppressLegacyKeypressUntilMs = Date.now() + 36;

    const pressTokens = inputEvent.tokens;
    const repeatTokens = inputEvent.repeatTokens;
    const releaseTokens = inputEvent.releaseTokens;
    if (pressTokens.length > 0 || repeatTokens.length > 0 || releaseTokens.length > 0) {
      options.inputSignals.pushCommand({
        kind: 'kitty-state',
        pressTokens: [...pressTokens],
        repeatTokens: [...repeatTokens],
        releaseTokens: [...releaseTokens],
      });
    }

    if (pressTokens.length === 0) {
      return;
    }
    if (pressTokens.includes('ctrl+c')) {
      emitInterrupt('ctrl-c');
      return;
    }
    if (pressTokens.includes('escape')) {
      emitInterrupt('escape');
      return;
    }
    if (isRestartInputTokens(pressTokens)) {
      emitInterrupt('restart');
      return;
    }

    const highSpeedAction = resolveHighSpeedControlActionFromAltLaneTokens(pressTokens, options.inputTokenToChannels);
    if (highSpeedAction) {
      options.inputSignals.pushCommand({
        kind: 'high-speed',
        action: highSpeedAction,
      });
      return;
    }

    if (pressTokens.includes('space')) {
      options.inputSignals.pushCommand({
        kind: 'toggle-pause',
      });
      return;
    }

    options.inputSignals.pushCommand({
      kind: 'lane-input',
      tokens: [...pressTokens],
    });
  };

  const start = (): void => {
    if (!canCaptureInput || started) {
      return;
    }
    started = true;
    stopped = false;
    wasRawMode = Boolean(stdin.isRaw);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKeyPress);
    if (options.mode === 'manual') {
      stopKittyKeyboardProtocol = beginKittyKeyboardProtocolOptIn();
      process.stdin.prependListener('data', onRawInputData);
    }
  };

  const stop = (): void => {
    if (!canCaptureInput || stopped) {
      return;
    }
    stopped = true;
    process.stdin.removeListener('keypress', onKeyPress);
    process.stdin.removeListener('data', onRawInputData);
    process.stdin.setRawMode(wasRawMode);
    stopKittyKeyboardProtocol();
  };

  return {
    start,
    stop,
  };
}

function isSpaceKey(key: readline.Key): boolean {
  return key.name?.toLowerCase() === 'space' || key.sequence === ' ';
}

function isRestartInputTokens(tokens: readonly string[]): boolean {
  return tokens.includes('shift+r');
}

function isRestartKeyPress(chunk: string | undefined, key: readline.Key): boolean {
  if (typeof chunk === 'string' && chunk === 'R') {
    return true;
  }
  return key.name?.toLowerCase() === 'r' && key.shift === true;
}

function resolveHighSpeedControlActionFromAltLaneTokens(
  tokens: readonly string[],
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>,
  key?: readline.Key,
): HighSpeedControlAction | undefined {
  const channels = new Set<string>();
  const addChannelsForAltToken = (token: string): void => {
    if (!token.startsWith('alt+')) {
      return;
    }
    const baseToken = token.slice('alt+'.length).toLowerCase();
    const mapped = inputTokenToChannels.get(baseToken);
    if (!mapped) {
      return;
    }
    for (const channel of mapped) {
      channels.add(channel);
    }
  };

  for (const token of tokens) {
    const normalizedToken = token.toLowerCase();
    addChannelsForAltToken(normalizedToken);
    if (normalizedToken.startsWith('option+')) {
      addChannelsForAltToken(`alt+${normalizedToken.slice('option+'.length)}`);
    }
  }

  if (key?.meta) {
    const keyName = normalizeLegacyKeyNameToken(key.name);
    if (keyName) {
      addChannelsForAltToken(`alt+${keyName}`);
    }
  }

  if (channels.size === 0) {
    return undefined;
  }
  return resolveHighSpeedControlActionFromLaneChannels([...channels]);
}

function normalizeLegacyKeyNameToken(name: string | undefined): string | undefined {
  if (typeof name !== 'string' || name.length === 0) {
    return undefined;
  }
  const lowered = name.toLowerCase();
  if (lowered.length === 1) {
    return lowered;
  }
  if (lowered === 'comma') {
    return ',';
  }
  if (lowered === 'period') {
    return '.';
  }
  if (lowered === 'slash') {
    return '/';
  }
  if (lowered === 'semicolon') {
    return ';';
  }
  if (lowered === 'quote') {
    return "'";
  }
  if (lowered === 'leftbracket') {
    return '[';
  }
  if (lowered === 'rightbracket') {
    return ']';
  }
  return undefined;
}
