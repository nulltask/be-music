import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import {
  makeChart,
  makePlaylog,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  submissionBody,
} from '../test/support.ts';
import { createApp } from './app.ts';
import type { Env } from './env.ts';

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 15);
const app = createApp({ now: () => (clock += 1000), chartsetLookup: async () => undefined });
const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

async function submit(cookie: string, body: Uint8Array<ArrayBuffer>): Promise<void> {
  const response = await fetchApp('/api/v0/scores', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'be-music-client': 'be-music-web/0.5.0 (engine 0.8.0; build test)',
      cookie,
    },
    body,
  });
  if (!response.ok) throw new Error(`submit failed: ${response.status} ${await response.text()}`);
}

async function runMigration(): Promise<void> {
  const text = await readFile(join(import.meta.dirname, '..', 'migrations', '0012_lr2_bp_and_death_lamp.sql'), 'utf8');
  for (const statement of text.split('--> statement-breakpoint')) {
    const sql = statement.replace(/^\s*--.*$/gmu, '').trim();
    if (sql.length > 0) await env.DB.prepare(sql).run();
  }
}

describe('migration 0012: LR2 BP and DEATH lamp', () => {
  test('rewrites stored LR2 results and re-picks the LR2 bests', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const chart = makeChart(['#00111:01010101', '#00211:01010101', '#00311:0101']);
    await submit(
      cookie,
      submissionBody(makePlaylog(chart, { noteCount: 10, hits: 8 }), chart.playDocument, chart.chartDocument),
    );
    await submit(cookie, submissionBody(makePlaylog(chart, { noteCount: 10, hits: 9 }), chart.playDocument));
    const ids = (
      await env.DB.prepare('SELECT `id` FROM `score` ORDER BY `created_at`, `id`').all<{ id: string }>()
    ).results.map((row) => row.id);
    const [first, second] = ids as [string, string];

    // Put the stored figures back the way the old rules computed them: the second play had 5 empty POORs counted in
    // its BP, and the first was a DEATH clear stored as EX HARD (6), the second a HARD clear (5).
    const db = env.DB;
    await db
      .prepare(
        "UPDATE `score_result` SET `judges` = json_set(`judges`, '$.emptyPoor', 5), `miss_count` = `miss_count` + 5, `gauge_type` = 'HARD', `clear_lamp` = 5 WHERE `score_id` = ? AND `ruleset` = 'lr2'",
      )
      .bind(second)
      .run();
    await db
      .prepare(
        "UPDATE `score_result` SET `gauge_type` = 'DEATH', `clear_lamp` = 6 WHERE `score_id` = ? AND `ruleset` = 'lr2'",
      )
      .bind(first)
      .run();
    await db
      .prepare(
        "UPDATE `best_score` SET `best_lamp` = 6, `best_lamp_score_id` = ?, `min_miss` = 2, `min_miss_score_id` = ? WHERE `ruleset` = 'lr2'",
      )
      .bind(first, first)
      .run();
    const beatorajaBefore = await db.prepare("SELECT * FROM `best_score` WHERE `ruleset` = 'beatoraja'").first();

    await runMigration();

    const results = (
      await db
        .prepare("SELECT `score_id`, `miss_count`, `clear_lamp` FROM `score_result` WHERE `ruleset` = 'lr2'")
        .all<{ score_id: string; miss_count: number; clear_lamp: number }>()
    ).results;
    const of = (id: string) => results.find((row) => row.score_id === id)!;
    expect(of(first)).toMatchObject({ miss_count: 2, clear_lamp: 4 });
    expect(of(second)).toMatchObject({ miss_count: 1, clear_lamp: 5 });
    const best = await db
      .prepare("SELECT * FROM `best_score` WHERE `ruleset` = 'lr2'")
      .first<{ best_lamp: number; best_lamp_score_id: string; min_miss: number; min_miss_score_id: string }>();
    expect(best).toMatchObject({ best_lamp: 5, best_lamp_score_id: second, min_miss: 1, min_miss_score_id: second });
    // Other rulesets are left alone.
    expect(await db.prepare("SELECT * FROM `best_score` WHERE `ruleset` = 'beatoraja'").first()).toEqual(
      beatorajaBefore,
    );
  });
});
