import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

/** Build and serve the actual Worker for browser regressions, with an isolated migrated database. */
export async function startBrowserWorker() {
  const packageDir = resolve(import.meta.dirname, '../..');
  execFileSync('pnpm', ['run', 'build:worker'], { cwd: packageDir, stdio: 'pipe' });
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await readFile(join(packageDir, 'dist/worker.js'), 'utf8'),
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      d1Databases: ['DB'],
      r2Buckets: ['BLOBS'],
      bindings: { BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth' },
    }),
  );
  try {
    const database = await worker.getD1Database('DB');
    const migrationsDir = join(packageDir, 'migrations');
    for (const name of (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = await readFile(join(migrationsDir, name), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) {
        if (statement.trim()) await database.prepare(statement).run();
      }
    }
    return worker;
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}
