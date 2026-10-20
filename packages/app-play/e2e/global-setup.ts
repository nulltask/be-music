import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeChecklistFixtures } from '../../../scripts/course-checklist/fixtures.ts';

/**
 * Writes the checklist fixtures (charts, course files and the minimal fixture skins) to a temp dir the specs serve
 * their drops from (`E2E_FIXTURES`), and removes it once the run is over.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const dir = await mkdtemp(join(tmpdir(), 'be-music-e2e-'));
  await writeChecklistFixtures(dir);
  process.env.E2E_FIXTURES = dir;
  return () => rm(dir, { recursive: true, force: true });
}
