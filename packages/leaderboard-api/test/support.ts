import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  computeChartFingerprint,
  computePlayFingerprint,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
} from '@be-music/chart';
import { parseBMS } from '@be-music/parser';
import type { BeMusicReplay, ReplayInputEvent, ReplayNote } from '@be-music/player/replay';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');
export const ORIGIN = 'http://localhost';

/** A workerd-backed D1 database and R2 bucket with every migration applied (test only). */
export async function startTestBindings(): Promise<{ env: Env; dispose: () => Promise<void> }> {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {}',
      compatibilityDate: '2026-10-01',
      d1Databases: ['DB'],
      r2Buckets: ['BLOBS'],
    }),
  );
  const DB = (await mf.getD1Database('DB')) as unknown as D1Database;
  const BLOBS = (await mf.getR2Bucket('BLOBS')) as unknown as R2Bucket;
  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const text = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of text.split('--> statement-breakpoint')) {
      if (statement.trim().length > 0) await DB.prepare(statement).run();
    }
  }
  return {
    env: { DB, BLOBS, BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth' },
    dispose: () => mf.dispose(),
  };
}

/** Signs in anonymously and returns the session cookie. */
export async function signInAnonymously(
  fetchApp: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  const response = await fetchApp('/api/auth/sign-in/anonymous', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: '{}',
  });
  if (!response.ok) throw new Error(`anonymous sign-in failed: ${response.status} ${await response.text()}`);
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
  return cookies.join('; ');
}

export interface TestChart {
  text: string;
  /** The chart parsed (`BeMusicJSON`), as a client sends a stage chart. */
  json: ReturnType<typeof parseBMS>;
  chartFingerprint: string;
  playFingerprint: string;
  chartDocument: unknown;
  playDocument: unknown;
}

/** A chart without control flow (both fingerprints equal) built from `#xxxyy:` object lines. */
export function makeChart(lines: readonly string[]): TestChart {
  const text = ['#PLAYER 1', '#BPM 120', ...lines].join('\n');
  const json = parseBMS(text);
  const options = { chartPath: undefined };
  return {
    text,
    json,
    chartFingerprint: computeChartFingerprint(json, options),
    playFingerprint: computePlayFingerprint(json, options),
    chartDocument: createChartFingerprintDocument(json, options),
    playDocument: createPlayFingerprintDocument(json, options),
  };
}

/**
 * A replay of `noteCount` notes on lane 11, one every half second; `hits` of them, from note `skip` on, are pressed
 * dead on (PGREAT), the rest are never pressed.
 */
export function makeReplay(
  chart: TestChart,
  options: {
    noteCount: number;
    hits: number;
    skip?: number;
    play?: Partial<BeMusicReplay['play']>;
    chart?: Partial<BeMusicReplay['chart']>;
  },
): BeMusicReplay {
  const skip = options.skip ?? 0;
  const notes: ReplayNote[] = [];
  const inputs: ReplayInputEvent[] = [];
  for (let index = 0; index < options.noteCount; index += 1) {
    const timeUs = 1_000_000 + index * 500_000;
    notes.push({ id: index, channel: '11', type: 'normal', timeUs });
    if (index >= skip && index < skip + options.hits) {
      inputs.push({ seq: inputs.length, timeUs, action: 'down', channels: ['11'] });
      inputs.push({ seq: inputs.length, timeUs: timeUs + 50_000, action: 'up', channels: ['11'] });
    }
  }
  return {
    format: 'be-music-replay',
    version: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      title: 'Test Song',
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: options.noteCount,
      notes,
      chartFingerprint: chart.chartFingerprint,
      playFingerprint: chart.playFingerprint,
      ...options.chart,
    },
    inputs,
    play: { mode: 'manual', autoScratch: false, gauge: 'EASY', judgeRuleset: 'lr2', ...options.play },
  };
}

/** A gzipped submission request body. */
export function submissionBody(
  replay: unknown,
  playDocument: unknown,
  chartDocument?: unknown,
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    gzipSync(JSON.stringify({ replay, playDocument, ...(chartDocument !== undefined ? { chartDocument } : {}) })),
  );
}
