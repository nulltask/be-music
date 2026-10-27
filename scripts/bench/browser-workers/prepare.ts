import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, join, extname } from 'node:path';
import { parseBMS, parseBmson, decodeBMSText, decodeUTF8Text } from '@be-music/chart-parser';
import { countScoredNotes } from '@be-music/chart-model';

const dataset = process.argv[2];
if (!dataset)
  throw Error(
    'Usage: node --conditions=source scripts/bench/browser-workers/prepare.ts <BMS directory> [manifest path]',
  );
const root = resolve(dataset),
  output = resolve(process.argv[3] || '/tmp/be-music-browser-manifest.json');
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();
const charts: Array<{ path: string; bytes: number }> = [];
const audio: Array<{ path: string; bytes: number }> = [];
let prepareChart: { path: string; bytes: number; notes: number } | undefined;
for (const file of files) {
  const extension = extname(file).toLowerCase();
  if (['.bms', '.bme', '.bml', '.pms', '.bmson'].includes(extension)) {
    const bytes = new Uint8Array(await readFile(file));
    const path = relative(root, file);
    charts.push({ path, bytes: bytes.length });
    const chart = extension === '.bmson' ? parseBmson(decodeUTF8Text(bytes)) : parseBMS(decodeBMSText(bytes).text);
    const notes = countScoredNotes(chart, { chartPath: path, inferBmsLNTypeWhenMissing: true }).notes;
    if (!prepareChart || notes > prepareChart.notes) prepareChart = { path, bytes: bytes.length, notes };
  } else if (extension === '.wav') {
    const size = (await stat(file)).size;
    if (size >= 44000 && size <= 256000) audio.push({ path: relative(root, file), bytes: size });
  }
}
if (!prepareChart || !audio.length)
  throw Error('Benchmark needs charts and WAV samples between 44,000 and 256,000 bytes');
const count = Math.min(32, audio.length);
const selected = Array.from(
  { length: count },
  (_, i) => audio[count === 1 ? 0 : Math.round((i * (audio.length - 1)) / (count - 1))]!,
);
await writeFile(output, JSON.stringify({ root, charts, audio: selected, prepareChart }, null, 2) + '\n');
process.stdout.write(
  `Manifest: ${output}\nCharts: ${charts.length}; WAV samples: ${selected.length}; largest note count: ${prepareChart.notes}\n`,
);
