import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeChecklistFixtures, fixtureBMS } from '../../scripts/course-checklist/fixtures.ts';
export default async function setup() {
  const families = process.env.PERF_FAMILIES?.split(',');
  if ((!families || families.includes('beatoraja')) && !process.env.PERF_MODERN_CHIC)
    throw new Error('Set PERF_MODERN_CHIC to the ModernChic skin directory');
  if ((!families || families.includes('lr2')) && !process.env.PERF_LR2_FILES)
    throw new Error('Set PERF_LR2_FILES to the stock LR2files directory');
  const dir = await mkdtemp(join(tmpdir(), 'be-music-perf-'));
  try {
    await writeChecklistFixtures(dir);
    await mkdir(join(dir, 'real', 'beatoraja', 'skin'), { recursive: true });
    await mkdir(join(dir, 'real', 'lr2', 'LR2files', 'Theme'), { recursive: true });
    if (!families || families.includes('beatoraja')) {
      if (!process.env.PERF_MODERN_CHIC) throw new Error('Set PERF_MODERN_CHIC to the ModernChic skin directory');
      await cp(process.env.PERF_MODERN_CHIC, join(dir, 'real', 'beatoraja', 'skin', 'ModernChic'), { recursive: true });
    }
    if (!families || families.includes('lr2')) {
      if (!process.env.PERF_LR2_FILES) throw new Error('Set PERF_LR2_FILES to the stock LR2files directory');
      await cp(join(process.env.PERF_LR2_FILES, 'Theme', 'LR2'), join(dir, 'real', 'lr2', 'LR2files', 'Theme', 'LR2'), {
        recursive: true,
      });
      await cp(join(process.env.PERF_LR2_FILES, 'Sound'), join(dir, 'real', 'lr2', 'LR2files', 'Sound'), {
        recursive: true,
      });
    }
    const chart = fixtureBMS({
      title: 'Performance chart',
      measures: 64,
      perMeasure: 16,
      lanes: ['11', '12', '13', '14', '15', '18', '19', '16'],
      playLevel: 12,
      difficulty: 4,
    });
    await writeFile(join(dir, 'songs', 'fixD', 'performance.bms'), chart);
    await mkdir(join(dir, 'bulk'), { recursive: true });
    for (let i = 0; i < 300; i++)
      await writeFile(
        join(dir, 'bulk', `chart-${i}.bms`),
        chart.replace('Performance chart', `Bulk ${String(i).padStart(3, '0')}`),
      );
    process.env.E2E_FIXTURES = dir;
    return () => rm(dir, { recursive: true, force: true });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
