import readline from 'node:readline';
import type { LogEntry } from '@be-music/utils';
import {
  beginStatefulKeyboardProtocolOptIn,
  resolveInputTokenEvent,
} from '../manual-input.ts';
import { resolveHighSpeedControlActionFromLaneChannels, type HighSpeedControlAction } from '../core/high-speed-control.ts';
import type { PlayerInputSignalBus } from '../core/input-signal-bus.ts';
import { beginSharedRawInputCapture, type RawInputCapture } from '../raw-input-capture.ts';

export interface NodeInputRuntimeOptions {
  mode: 'auto' | 'manual';
  inputSignals: PlayerInputSignalBus;
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>;
  onLog?: (entry: LogEntry) => void;
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
  const shouldResetRawModeOnStart = process.platform === 'win32';
  let rawInputCapture: RawInputCapture | undefined;
  let suppressKeypressUntilMs = 0;
  let stopStatefulKeyboardProtocol: () => void = () => undefined;
  let pendingProtocolKeypress = '';
  let pendingProtocolKeypressUpdatedAtMs = 0;
  let lastAcceptedInputSignature = '';
  let lastAcceptedInputSource: 'keypress' | 'data' | undefined;
  let lastAcceptedInputAtMs = 0;
  let loggedFirstKeyPress = false;
  let loggedFirstRawData = false;
  let loggedFirstAcceptedInput = false;
  let loggedFirstIgnoredInput = false;

  const emitRuntimeLog = (event: string, fields?: Record<string, unknown>): void => {
    options.onLog?.({
      source: 'input-runtime',
      level: 'info',
      event,
      fields: {
        emittedAtUnixMs: Date.now(),
        emittedAtMonotonicMs: performance.now(),
        mode: options.mode,
        ...fields,
      },
    });
  };

  emitRuntimeLog('input-runtime.created', {
    canCaptureInput,
    platform: process.platform,
    stdinIsRaw: Boolean(stdin.isRaw),
    mappedTokenCount: options.inputTokenToChannels.size,
  });

  const emitInterrupt = (reason: 'escape' | 'ctrl-c' | 'restart'): void => {
    options.inputSignals.pushCommand({
      kind: 'interrupt',
      reason,
    });
  };

  const emitManualInput = (
    inputEvent: ReturnType<typeof resolveInputTokenEvent>,
    source: 'keypress' | 'data',
  ): void => {
    const pressTokens = inputEvent.tokens;
    const repeatTokens = inputEvent.repeatTokens;
    const releaseTokens = inputEvent.releaseTokens;
    const isStatefulProtocol = inputEvent.protocol !== 'legacy';
    const acceptedRawLegacyFallback =
      source === 'data' && inputEvent.protocol === 'legacy' && process.platform === 'win32' && pressTokens.length > 0;

    if (source === 'data' && !isStatefulProtocol && !acceptedRawLegacyFallback) {
      if (!loggedFirstIgnoredInput) {
        loggedFirstIgnoredInput = true;
        emitRuntimeLog('input-runtime.input.ignored', {
          source,
          protocol: inputEvent.protocol,
          tokens: pressTokens.join(','),
          repeatTokens: repeatTokens.join(','),
          releaseTokens: releaseTokens.join(','),
          reason: 'raw-data-not-stateful',
        });
      }
      return;
    }

    if (isDuplicateAcceptedInput(inputEvent, source)) {
      return;
    }

    if (source === 'data' && (isStatefulProtocol || acceptedRawLegacyFallback)) {
      suppressKeypressUntilMs = Date.now() + 36;
    }

    if (isStatefulProtocol && (pressTokens.length > 0 || repeatTokens.length > 0 || releaseTokens.length > 0)) {
      options.inputSignals.pushCommand({
        kind: 'kitty-state',
        pressTokens: [...pressTokens],
        repeatTokens: [...repeatTokens],
        releaseTokens: [...releaseTokens],
      });
    }

    if (!loggedFirstAcceptedInput) {
      loggedFirstAcceptedInput = true;
      emitRuntimeLog('input-runtime.input.accepted', {
        source,
        protocol: inputEvent.protocol,
        tokens: pressTokens.join(','),
        repeatTokens: repeatTokens.join(','),
        releaseTokens: releaseTokens.join(','),
      });
    }

    handlePressedTokens(pressTokens);
  };

  const handlePressedTokens = (tokens: readonly string[]): void => {
    if (tokens.length === 0) {
      return;
    }
    if (tokens.includes('ctrl+c')) {
      emitInterrupt('ctrl-c');
      return;
    }
    if (tokens.includes('escape')) {
      emitInterrupt('escape');
      return;
    }
    if (isRestartInputTokens(tokens)) {
      emitInterrupt('restart');
      return;
    }

    const highSpeedAction = resolveHighSpeedControlActionFromAltLaneTokens(tokens, options.inputTokenToChannels);
    if (highSpeedAction) {
      options.inputSignals.pushCommand({
        kind: 'high-speed',
        action: highSpeedAction,
      });
      return;
    }

    if (tokens.includes('space')) {
      options.inputSignals.pushCommand({
        kind: 'toggle-pause',
      });
      return;
    }

    options.inputSignals.pushCommand({
      kind: 'lane-input',
      tokens: [...tokens],
    });
  };

  const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
    if (options.mode === 'manual' && Date.now() < suppressKeypressUntilMs) {
      return;
    }
    if (!loggedFirstKeyPress) {
      loggedFirstKeyPress = true;
      emitRuntimeLog('input-runtime.keypress.first', {
        chunk: chunk ?? '',
        sequence: key.sequence ?? '',
        keyName: key.name,
      });
    }
    const inputEvents = resolveKeyPressInputEvents(chunk, key);
    if (inputEvents.length === 0) {
      return;
    }

    if (options.mode === 'manual') {
      for (const inputEvent of inputEvents) {
        emitManualInput(inputEvent, 'keypress');
      }
      return;
    }

    const inputEvent = inputEvents[0]!;
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
    if (!loggedFirstRawData) {
      loggedFirstRawData = true;
      emitRuntimeLog('input-runtime.raw-data.first', {
        chunk,
        protocol: inputEvent.protocol,
        tokens: inputEvent.tokens.join(','),
        repeatTokens: inputEvent.repeatTokens.join(','),
        releaseTokens: inputEvent.releaseTokens.join(','),
      });
    }
    emitManualInput(inputEvent, 'data');
  };

  const start = (): void => {
    if (!canCaptureInput || started) {
      return;
    }
    started = true;
    stopped = false;
    pendingProtocolKeypress = '';
    pendingProtocolKeypressUpdatedAtMs = 0;
    lastAcceptedInputSignature = '';
    lastAcceptedInputSource = undefined;
    lastAcceptedInputAtMs = 0;
    wasRawMode = Boolean(stdin.isRaw);
    rawInputCapture = beginSharedRawInputCapture({
      forceResetRawMode: shouldResetRawModeOnStart,
    });
    readline.emitKeypressEvents(process.stdin);
    process.stdin.on('keypress', onKeyPress);
    if (options.mode === 'manual') {
      stopStatefulKeyboardProtocol = beginStatefulKeyboardProtocolOptIn(process.stdout, process.platform, process.env);
      process.stdin.prependListener('data', onRawInputData);
    }
    emitRuntimeLog('input-runtime.started', {
      stdinIsRaw: Boolean(stdin.isRaw),
    });
  };

  const stop = (): void => {
    if (!canCaptureInput || stopped) {
      return;
    }
    stopped = true;
    pendingProtocolKeypress = '';
    pendingProtocolKeypressUpdatedAtMs = 0;
    process.stdin.removeListener('keypress', onKeyPress);
    process.stdin.removeListener('data', onRawInputData);
    rawInputCapture?.restore();
    rawInputCapture = undefined;
    stopStatefulKeyboardProtocol();
    emitRuntimeLog('input-runtime.stopped', {
      restoreRawMode: wasRawMode,
    });
  };

  return {
    start,
    stop,
  };

  function resolveKeyPressInputEvents(
    chunk: string | undefined,
    key: readline.Key,
  ): Array<ReturnType<typeof resolveInputTokenEvent>> {
    const nowMs = Date.now();
    if (
      pendingProtocolKeypress.length > 0 &&
      nowMs - pendingProtocolKeypressUpdatedAtMs > PROTOCOL_KEYPRESS_FRAGMENT_TIMEOUT_MS
    ) {
      pendingProtocolKeypress = '';
      pendingProtocolKeypressUpdatedAtMs = 0;
    }

    const keyChunk = chunk ?? '';
    const keySequence = key.sequence ?? '';
    const piece = keyChunk.length > 0 ? keyChunk : keySequence;
    if (piece.length === 0) {
      return [];
    }

    if (pendingProtocolKeypress.length > 0) {
      if (!isProtocolKeypressContinuationPiece(piece)) {
        pendingProtocolKeypress = '';
        pendingProtocolKeypressUpdatedAtMs = 0;
      } else {
        pendingProtocolKeypress += piece;
        pendingProtocolKeypressUpdatedAtMs = nowMs;
        const consumed = consumeProtocolKeypressSequences(pendingProtocolKeypress);
        pendingProtocolKeypress = consumed.pending;
        if (consumed.sequences.length > 0) {
          return consumed.sequences.map((sequence) =>
            resolveInputTokenEvent(sequence, {
              ...key,
              sequence,
            }),
          );
        }
        return [];
      }
    }

    if (isProtocolKeypressStart(piece)) {
      pendingProtocolKeypress = piece;
      pendingProtocolKeypressUpdatedAtMs = nowMs;
      const consumed = consumeProtocolKeypressSequences(pendingProtocolKeypress);
      pendingProtocolKeypress = consumed.pending;
      if (consumed.sequences.length > 0) {
        return consumed.sequences.map((sequence) =>
          resolveInputTokenEvent(sequence, {
            ...key,
            sequence,
          }),
        );
      }
      return [];
    }

    return [resolveInputTokenEvent(keyChunk, key)];
  }

  function isDuplicateAcceptedInput(
    inputEvent: ReturnType<typeof resolveInputTokenEvent>,
    source: 'keypress' | 'data',
  ): boolean {
    const signature = [
      inputEvent.protocol,
      inputEvent.tokens.join(','),
      inputEvent.repeatTokens.join(','),
      inputEvent.releaseTokens.join(','),
    ].join('|');
    if (signature === 'legacy|||') {
      return false;
    }
    const nowMs = Date.now();
    const duplicate =
      source !== lastAcceptedInputSource &&
      signature === lastAcceptedInputSignature &&
      nowMs - lastAcceptedInputAtMs <= CROSS_SOURCE_DUPLICATE_WINDOW_MS;
    lastAcceptedInputSignature = signature;
    lastAcceptedInputSource = source;
    lastAcceptedInputAtMs = nowMs;
    return duplicate;
  }
}

const PROTOCOL_KEYPRESS_FRAGMENT_TIMEOUT_MS = 24;
const CROSS_SOURCE_DUPLICATE_WINDOW_MS = 8;

function isProtocolKeypressStart(piece: string): boolean {
  return piece.startsWith('\u001b[');
}

function isProtocolKeypressContinuationPiece(piece: string): boolean {
  return piece.includes('\u001b[') || /^[0-9;:_u]+$/.test(piece);
}

function consumeProtocolKeypressSequences(buffer: string): {
  sequences: string[];
  pending: string;
} {
  const sequences: string[] = [];
  let consumedLength = 0;
  const matcher = new RegExp(PROTOCOL_KEYPRESS_SEQUENCE.source, 'g');
  for (const match of buffer.matchAll(matcher)) {
    const start = match.index ?? -1;
    if (start !== consumedLength) {
      break;
    }
    const sequence = match[0];
    sequences.push(sequence);
    consumedLength += sequence.length;
  }
  let pending = buffer.slice(consumedLength);
  if (pending.length > 0 && !pending.startsWith('\u001b[')) {
    const nextProtocolStart = pending.indexOf('\u001b[');
    pending = nextProtocolStart >= 0 ? pending.slice(nextProtocolStart) : '';
  }
  return {
    sequences,
    pending,
  };
}

const KITTY_KEYPRESS_SEQUENCE = /^\u001b\[[0-9:]+(?:;[0-9:]+)*u$/;
const WIN32_KEYPRESS_SEQUENCE = /^\u001b\[[0-9]+(?:;[0-9]+){5}_$/;
const PROTOCOL_KEYPRESS_SEQUENCE =
  /\u001b\[[0-9]+(?:;[0-9]+){5}_|\u001b\[[0-9:]+(?:;[0-9:]+)*u/;

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
  return key.name?.toLowerCase() === 'r' && Boolean(key.shift);
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
