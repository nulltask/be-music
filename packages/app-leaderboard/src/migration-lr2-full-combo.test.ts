import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import {
  makeChart,
  makeReplay,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  submissionBody,
} from './test-support/support.ts';
import { createApp } from './app.ts';
import type { Env } from './env.ts';

let env: Env;
let dispose: () => Promise<void>;
let clock = Date.UTC(2026, 9, 23);
const app = createApp({ now: () => (clock += 1000), chartsetLookup: async () => undefined });
const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));
beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});
afterAll(async () => {
  await dispose();
});

async function migrate(): Promise<void> {
  const text = await readFile(
    join(import.meta.dirname, '..', 'migrations', '0016_lr2_full_combo_precedence.sql'),
    'utf8',
  );
  for (const statement of text.split('--> statement-breakpoint')) await env.DB.prepare(statement).run();
}

test('repairs LR2 full-combo lamps and shown best references without changing other rulesets or score and BP bests', async () => {
  const cookie = await signInAnonymously(fetchApp);
  const chart = makeChart(['#00111:01010101', '#00211:01010101', '#00311:0101']);
  for (let index = 0; index < 4; index++) {
    const replay = makeReplay(chart, { noteCount: 10, hits: index === 1 ? 9 : 10 });
    // Distinct inputs keep these separate accepted plays, while staying within PGREAT.
    replay.inputs[0]!.timeUs += index * 1000;
    const response = await fetchApp('/api/v0/scores', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'be-music-client': 'be-music-web/0.5.0 (engine 0.8.0; build test)',
        cookie,
      },
      body: submissionBody(replay, chart.playDocument, chart.chartDocument),
    });
    expect(response.status, await response.text()).toBe(201);
  }
  const db = env.DB;
  const ids = (
    await db.prepare('SELECT `id` FROM `score` ORDER BY `created_at`, `id`').all<{ id: string }>()
  ).results.map((row) => row.id);
  expect(ids).toHaveLength(4);
  const [hidden, ordinary, firstFull, laterFull] = ids as [string, string, string, string];
  await db.prepare('UPDATE `score` SET `hidden` = 1 WHERE `id` = ?').bind(hidden).run();
  // Reproduce the old cache: a full combo whose later empty POORs left the physical gauge below its border.
  await db
    .prepare(
      "UPDATE `score_result` SET `clear_lamp` = 1, `gauge_final` = 20, `judges` = json_set(`judges`, '$.emptyPoor', 40), `miss_count` = 40 WHERE `ruleset` = 'lr2' AND `score_id` <> ?",
    )
    .bind(ordinary)
    .run();
  await db
    .prepare("UPDATE `best_score` SET `best_lamp` = 3, `best_lamp_score_id` = ? WHERE `ruleset` = 'lr2'")
    .bind(ordinary)
    .run();
  const other = await db.prepare("SELECT * FROM `best_score` WHERE `ruleset` = 'beatoraja'").first();
  const bestBefore = await db
    .prepare("SELECT * FROM `best_score` WHERE `ruleset` = 'lr2'")
    .first<Record<string, unknown>>();
  const ordinaryBefore = await db
    .prepare("SELECT * FROM `score_result` WHERE `ruleset` = 'lr2' AND `score_id` = ?")
    .bind(ordinary)
    .first();
  await migrate();
  const rows = (
    await db
      .prepare(
        "SELECT `score_id`, `clear_lamp`, `miss_count`, `gauge_final` FROM `score_result` WHERE `ruleset` = 'lr2'",
      )
      .all<{ score_id: string; clear_lamp: number; miss_count: number; gauge_final: number }>()
  ).results;
  for (const id of [hidden, firstFull, laterFull])
    expect(rows.find((row) => row.score_id === id)).toMatchObject({ clear_lamp: 7, miss_count: 40, gauge_final: 20 });
  const bestAfter = await db
    .prepare("SELECT * FROM `best_score` WHERE `ruleset` = 'lr2'")
    .first<Record<string, unknown>>();
  expect(bestAfter).toEqual({ ...bestBefore, best_lamp: 7, best_lamp_score_id: firstFull });
  expect(
    await db.prepare("SELECT * FROM `score_result` WHERE `ruleset` = 'lr2' AND `score_id` = ?").bind(ordinary).first(),
  ).toEqual(ordinaryBefore);
  expect(await db.prepare("SELECT * FROM `best_score` WHERE `ruleset` = 'beatoraja'").first()).toEqual(other);
  await migrate();
  expect(await db.prepare("SELECT * FROM `best_score` WHERE `ruleset` = 'lr2'").first()).toEqual(bestAfter);
});
