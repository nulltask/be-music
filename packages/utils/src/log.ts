import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import pino from 'pino';

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
