import readline from 'node:readline';
import {
  beginStatefulKeyboardProtocolOptIn,
  inspectInputTokenEvent,
  type InputProtocolInspection,
} from './manual-input.ts';

interface DiagnosticChunk {
  text: string;
  escaped: string;
  hex: string;
}

interface DiagnosticKey {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

let sequence = 0;

main();

function main(): void {
  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('Keyboard diagnostic requires a TTY on stdin/stdout.\n');
    process.exitCode = 1;
    return;
  }

  const wasRawMode = Boolean(stdin.isRaw);
  const shouldResetRawModeOnStart = process.platform === 'win32';
  readline.emitKeypressEvents(process.stdin);
  if (shouldResetRawModeOnStart && stdin.isRaw) {
    process.stdin.setRawMode(false);
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const stopStatefulKeyboardProtocol = beginStatefulKeyboardProtocolOptIn(process.stdout, process.platform, process.env);

  process.stdout.write('Keyboard diagnostics started. Press keys to inspect stdin events. Press Ctrl+C to exit.\n');
  emitRecord({
    kind: 'config',
    platform: process.platform,
    termProgram: process.env.TERM_PROGRAM,
    wezTermPane: Boolean(process.env.WEZTERM_PANE),
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
    statefulProtocols: process.env.BE_MUSIC_KEYBOARD_PROTOCOLS ?? (process.platform === 'win32' ? 'none' : 'kitty'),
  });

  const cleanup = (): void => {
    process.stdin.off('keypress', onKeyPress);
    process.stdin.off('data', onData);
    stopStatefulKeyboardProtocol();
    process.stdin.setRawMode(wasRawMode);
  };

  const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
    const actualChunk = chunk ?? '';
    const inspection = inspectInputTokenEvent(actualChunk, key);
    emitRecord({
      kind: 'keypress',
      chunk: describeChunk(actualChunk),
      key: describeKey(key),
      selected: inspection.selected,
      protocols: normalizeProtocols(inspection.protocols),
    });
    if (key.sequence === '\u0003' || inspection.selected.tokens.includes('ctrl+c')) {
      cleanup();
      process.exit(0);
    }
  };

  const onData = (data: Buffer): void => {
    const chunk = data.toString('utf8');
    const inspection = inspectInputTokenEvent(chunk, {
      name: undefined,
      sequence: chunk,
      ctrl: false,
      meta: false,
      shift: false,
    } satisfies readline.Key);
    emitRecord({
      kind: 'data',
      chunk: describeChunk(chunk),
      selected: inspection.selected,
      protocols: normalizeProtocols(inspection.protocols),
    });
  };

  process.stdin.on('keypress', onKeyPress);
  process.stdin.on('data', onData);
}

function emitRecord(payload: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({
      sequence: sequence++,
      at: new Date().toISOString(),
      ...payload,
    })}\n`,
  );
}

function describeChunk(value: string): DiagnosticChunk {
  return {
    text: value,
    escaped: escapeControlCharacters(value),
    hex: [...Buffer.from(value)].map((byte) => byte.toString(16).padStart(2, '0')).join(' '),
  };
}

function describeKey(key: readline.Key): DiagnosticKey {
  return {
    name: key.name,
    sequence: key.sequence,
    ctrl: key.ctrl,
    meta: key.meta,
    shift: key.shift,
  };
}

function normalizeProtocols(protocols: {
  legacy: InputProtocolInspection;
  kitty: InputProtocolInspection;
  win32: InputProtocolInspection;
}): Record<string, InputProtocolInspection & { rawEventCount: number }> {
  return {
    legacy: withRawEventCount(protocols.legacy),
    kitty: withRawEventCount(protocols.kitty),
    win32: withRawEventCount(protocols.win32),
  };
}

function withRawEventCount(protocol: InputProtocolInspection): InputProtocolInspection & { rawEventCount: number } {
  return {
    ...protocol,
    rawEventCount: protocol.tokens.length + protocol.repeatTokens.length + protocol.releaseTokens.length,
  };
}

function escapeControlCharacters(value: string): string {
  return value.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return `\\u${code.toString(16).padStart(4, '0')}`;
  });
}
