import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createFileLogger } from './log.ts';

describe('log', () => {
  test('writes NDJSON log entries to a file', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'be-music-log-'));
    const logPath = join(baseDir, 'logs', 'player.ndjson');
    try {
      const logger = await createFileLogger(logPath);
      logger.log({
        source: 'cli',
        level: 'info',
        event: 'cli.start',
        fields: { input: '/charts/sample.bms' },
      });
      await logger.close();

      const content = await readFile(logPath, 'utf8');
      const parsed = JSON.parse(content.trim()) as {
        source: string;
        level: string;
        event: string;
        fields: { input: string };
        pid: number;
        ts: string;
      };
      expect(parsed.source).toBe('cli');
      expect(parsed.level).toBe('info');
      expect(parsed.event).toBe('cli.start');
      expect(parsed.fields.input).toBe('/charts/sample.bms');
      expect(typeof parsed.pid).toBe('number');
      expect(typeof parsed.ts).toBe('string');
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
