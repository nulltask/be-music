import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the tiny BMS library and `.lr2crs` course files the course browser checklist runs on
 * (`docs/course-checklist.md`): short charts with sine keysounds and a continuous BGM tone (so fades show), courses of
 * every LR2 kind, a GRADE course with a dense stage that empties the gauge, and a seven-stage file for the five-stage
 * warning.
 *
 * Usage: `node scripts/course-checklist/fixtures.ts <out-dir>` writes `<out-dir>/songs/…` and
 * `<out-dir>/seven-stages.lr2crs`.
 */

const SAMPLE_RATE = 22050;

/** A mono 16-bit PCM WAV of a sine tone; `decay` fades it to silence over its length. */
export function sineWav(frequency: number, seconds: number, amplitude: number, decay: boolean): Uint8Array {
  const frames = Math.floor(SAMPLE_RATE * seconds);
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let index = 0; index < frames; index += 1) {
    const envelope = decay ? 1 - index / frames : 1;
    const sample = Math.trunc(amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * envelope);
    view.setInt16(44 + index * 2, sample, true);
  }
  return bytes;
}

export interface FixtureChart {
  title: string;
  /** Measures of notes after the one-measure lead-in. */
  measures: number;
  /** Notes per measure, spread over `lanes` in turn. */
  perMeasure: number;
  lanes: readonly string[];
  playLevel: number;
  difficulty: number;
  bpm?: number;
}

/** The BMS text of a fixture chart: keysounds `k1` / `k2` alternate, `bgm` starts at measure 1. CRLF line ends. */
export function fixtureBms(chart: FixtureChart): string {
  const lines = [
    '#PLAYER 1',
    '#GENRE FIXTURE',
    `#TITLE ${chart.title}`,
    '#ARTIST be-music checklist',
    `#BPM ${chart.bpm ?? 150}`,
    `#PLAYLEVEL ${chart.playLevel}`,
    `#DIFFICULTY ${chart.difficulty}`,
    '#RANK 2',
    '#TOTAL 200',
    '#WAV01 k1.wav',
    '#WAV02 k2.wav',
    '#WAV03 bgm.wav',
    '',
    '#00101:03',
  ];
  for (let measure = 1; measure <= chart.measures; measure += 1) {
    const cells = new Map(chart.lanes.map((lane) => [lane, Array<string>(chart.perMeasure).fill('00')]));
    for (let index = 0; index < chart.perMeasure; index += 1) {
      const lane = chart.lanes[(measure * chart.perMeasure + index) % chart.lanes.length]!;
      cells.get(lane)![index] = index % 2 === 0 ? '01' : '02';
    }
    for (const [lane, row] of cells) {
      if (row.some((cell) => cell !== '00')) lines.push(`#${String(measure).padStart(3, '0')}${lane}:${row.join('')}`);
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** An LR2 `.lr2crs` course list: each course's `hash` is its 32-character header and its stages' MD5s. */
export function lr2CourseList(
  courses: ReadonlyArray<{ title: string; type: 0 | 1 | 2; md5s: readonly string[] }>,
): string {
  const body = courses.flatMap((course) => {
    const header = `${'0'.repeat(10)}${course.type}${'0'.repeat(21)}`;
    return [
      '  <course>',
      `    <title>${course.title}</title>`,
      '    <line>7</line>',
      `    <type>${course.type}</type>`,
      `    <hash>${header}${course.md5s.join('')}</hash>`,
      '  </course>',
    ];
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<courselist>', ...body, '</courselist>', ''].join('\n');
}

const K7 = ['11', '12', '13', '14', '15', '18', '19', '16'];
const K5 = ['11', '12', '13', '14', '15', '16'];

/** The checklist library: id → folder and chart. `D` is dense enough to empty the gauge of a no-input run. */
export const FIXTURE_CHARTS: Readonly<Record<string, { folder: string; chart: FixtureChart }>> = {
  A: {
    folder: 'fixA',
    chart: { title: 'Fixture A', measures: 3, perMeasure: 4, lanes: K7, playLevel: 1, difficulty: 1 },
  },
  B: {
    folder: 'fixB',
    chart: { title: 'Fixture B', measures: 3, perMeasure: 4, lanes: K7, playLevel: 2, difficulty: 2 },
  },
  C: {
    folder: 'fixC',
    chart: { title: 'Fixture C', measures: 3, perMeasure: 4, lanes: K7, playLevel: 3, difficulty: 3 },
  },
  D: {
    folder: 'fixD',
    chart: { title: 'Fixture D dense', measures: 12, perMeasure: 16, lanes: K7, playLevel: 12, difficulty: 4 },
  },
  E: {
    folder: 'fixE',
    chart: { title: 'Fixture E', measures: 3, perMeasure: 4, lanes: K7, playLevel: 4, difficulty: 2 },
  },
  F: {
    folder: 'fixF',
    chart: { title: 'Fixture F', measures: 3, perMeasure: 4, lanes: K7, playLevel: 5, difficulty: 2 },
  },
  G: {
    folder: 'fixG',
    chart: { title: 'Fixture G', measures: 3, perMeasure: 8, lanes: K7, playLevel: 6, difficulty: 3, bpm: 120 },
  },
  P5: {
    folder: 'fix5k',
    chart: { title: 'Fixture 5KEY', measures: 3, perMeasure: 4, lanes: K5, playLevel: 2, difficulty: 2 },
  },
};

async function main(outDir: string): Promise<void> {
  const songs = join(outDir, 'songs');
  const md5 = new Map<string, string>();
  for (const [id, { folder, chart }] of Object.entries(FIXTURE_CHARTS)) {
    const dir = join(songs, folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'k1.wav'), sineWav(660, 0.12, 9000, true));
    await writeFile(join(dir, 'k2.wav'), sineWav(880, 0.12, 9000, true));
    await writeFile(
      join(dir, 'bgm.wav'),
      sineWav(220, (chart.measures * 4 * 60) / (chart.bpm ?? 150) + 1, 3000, false),
    );
    const bms = fixtureBms(chart);
    await writeFile(join(dir, `${folder}.bms`), bms);
    md5.set(id, createHash('md5').update(bms).digest('hex'));
  }
  const stages = (ids: string) => ids.split('').map((id) => md5.get(id)!);
  await mkdir(join(songs, 'courses'), { recursive: true });
  await writeFile(
    join(songs, 'courses', 'fixture-courses.lr2crs'),
    lr2CourseList([
      { title: 'FIX GRADE', type: 2, md5s: stages('ABC') },
      { title: 'FIX EXPERT', type: 0, md5s: stages('ABC') },
      { title: 'FIX NONSTOP', type: 1, md5s: stages('ABG') },
      { title: 'FIX GRADE FAIL', type: 2, md5s: stages('ADB') },
    ]),
  );
  // Kept outside `songs/` so it is dropped on its own, for the five-stage warning.
  await writeFile(
    join(outDir, 'seven-stages.lr2crs'),
    lr2CourseList([{ title: 'FIX SEVEN STAGES', type: 0, md5s: stages('ABCEFGA') }]),
  );
  console.log(`fixtures written to ${outDir}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2];
  if (outDir === undefined) {
    console.error('usage: node scripts/course-checklist/fixtures.ts <out-dir>');
    process.exit(1);
  }
  await main(resolve(outDir));
}
