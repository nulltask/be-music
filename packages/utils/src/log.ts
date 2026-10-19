import pino from 'pino';

// Lazy-load Node built-ins so the module remains importable from a browser bundle (the file logger is the only
// caller that needs them, and the browser side never invokes `createFileLogger`). Vite externalises these
// `node:` prefixes for browser targets but only emits a runtime error if code actually reaches them — keeping
// the resolution lazy confines the error to the Node-only `createFileLogger` path that browsers never call.
type NodeFS = typeof import('node:fs');
type NodeFSPromises = typeof import('node:fs/promises');
type NodePath = typeof import('node:path');
let nodeFSPromise: Promise<NodeFS> | undefined;
let nodeFSPromisesPromise: Promise<NodeFSPromises> | undefined;
let nodePathPromise: Promise<NodePath> | undefined;
const loadNodeFS = (): Promise<NodeFS> => (nodeFSPromise ??= import('node:fs'));
const loadNodeFSPromises = (): Promise<NodeFSPromises> => (nodeFSPromisesPromise ??= import('node:fs/promises'));
const loadNodePath = (): Promise<NodePath> => (nodePathPromise ??= import('node:path'));

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  source: string;
  level: LogLevel;
  event: string;
  fields?: Record<string, unknown>;
}

export interface Logger {
  log: (entry: LogEntry) => void;
  close: () => Promise<void>;
}

export async function createFileLogger(logFilePath: string): Promise<Logger> {
  const [{ mkdir }, { dirname }, { createWriteStream }] = await Promise.all([
    loadNodeFSPromises(),
    loadNodePath(),
    loadNodeFS(),
  ]);
  await mkdir(dirname(logFilePath), { recursive: true });
  const stream = createWriteStream(logFilePath, {
    flags: 'a',
    encoding: 'utf8',
  });
  const logger = pino(
    {
      base: { pid: process.pid },
      messageKey: 'event',
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    stream,
  );
  let closed = false;
  let streamError: Error | undefined;
  stream.on('error', (error) => {
    streamError = error;
  });

  return {
    log: (entry) => {
      if (closed || streamError) {
        return;
      }
      logger[entry.level](
        {
          source: entry.source,
          fields: entry.fields,
        },
        entry.event,
      );
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      if (streamError) {
        throw streamError;
      }
      await new Promise<void>((resolve, reject) => {
        logger.flush((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        stream.end((error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export function createNoopLogger(): Logger {
  return {
    log: () => undefined,
    close: () => Promise.resolve(),
  };
}
