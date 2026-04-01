import { afterEach, describe, expect, test, vi } from 'vitest';

interface MockLoggerConfig {
  flushError?: Error;
  endError?: Error;
}

async function loadLogModuleWithMocks(config: MockLoggerConfig = {}) {
  vi.resetModules();

  const listeners = new Map<string, (error: Error) => void>();
  const stream = {
    on: vi.fn((event: string, listener: (error: Error) => void) => {
      listeners.set(event, listener);
      return stream;
    }),
    end: vi.fn((callback?: (error?: Error | null) => void) => {
      callback?.(config.endError ?? null);
    }),
  };

  const levelCalls: Array<{ level: string; event: string; source: string }> = [];
  const logger = {
    debug: vi.fn((payload: { source: string }, event: string) => {
      levelCalls.push({ level: 'debug', event, source: payload.source });
    }),
    info: vi.fn((payload: { source: string }, event: string) => {
      levelCalls.push({ level: 'info', event, source: payload.source });
    }),
    warn: vi.fn((payload: { source: string }, event: string) => {
      levelCalls.push({ level: 'warn', event, source: payload.source });
    }),
    error: vi.fn((payload: { source: string }, event: string) => {
      levelCalls.push({ level: 'error', event, source: payload.source });
    }),
    flush: vi.fn((callback: (error?: Error | null) => void) => {
      callback(config.flushError ?? null);
    }),
  };

  vi.doMock('node:fs', () => ({
    createWriteStream: vi.fn(() => stream),
  }));
  vi.doMock('node:fs/promises', () => ({
    mkdir: vi.fn(async () => undefined),
  }));
  vi.doMock('pino', () => ({
    default: vi.fn(() => logger),
  }));

  const module = await import('./log.ts');
  return {
    ...module,
    logger,
    stream,
    levelCalls,
    emitStreamError: (error: Error) => listeners.get('error')?.(error),
  };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('node:fs');
  vi.doUnmock('node:fs/promises');
  vi.doUnmock('pino');
});

describe('log mocked error handling', () => {
  test('stops logging and rejects close when the stream emits an error', async () => {
    const { createFileLogger, emitStreamError, levelCalls } = await loadLogModuleWithMocks();
    const logger = await createFileLogger('/tmp/mock.ndjson');

    emitStreamError(new Error('stream failed'));
    logger.log({
      source: 'ui',
      level: 'warn',
      event: 'ui.skipped',
    });

    expect(levelCalls).toHaveLength(0);
    await expect(logger.close()).rejects.toMatchObject({
      message: 'stream failed',
    });
  });

  test('rejects close when pino flush fails', async () => {
    const { createFileLogger, stream } = await loadLogModuleWithMocks({
      flushError: new Error('flush failed'),
    });
    const logger = await createFileLogger('/tmp/mock.ndjson');

    await expect(logger.close()).rejects.toMatchObject({
      message: 'flush failed',
    });
    expect(stream.end).not.toHaveBeenCalled();
  });

  test('rejects close when stream.end fails after a successful flush', async () => {
    const { createFileLogger } = await loadLogModuleWithMocks({
      endError: new Error('end failed'),
    });
    const logger = await createFileLogger('/tmp/mock.ndjson');

    await expect(logger.close()).rejects.toMatchObject({
      message: 'end failed',
    });
  });
});
