import { createHash } from 'node:crypto';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

/**
 * Builds the tiny BMS library and `.lr2crs` course files the course browser checklist runs on
 * (`docs/course-checklist.md`): short charts with sine keysounds and a continuous BGM tone (so fades show), courses of
 * every LR2 kind, a GRADE course with a dense stage that empties the gauge, a course with a stage missing from the
 * library, and a seven-stage file for the five-stage warning. It also writes two minimal skins made for the checklist
 * (`skins/`, no third-party assets): an LR2 theme with its sound set and a beatoraja JSON skin, each with the
 * course scenes, PLAY / AUTO buttons and solid-colour images. The end-to-end suite (`packages/app-play/e2e`)
 * writes the same files with {@link writeChecklistFixtures}.
 *
 * Usage: `node scripts/course-checklist/fixtures.ts <out-dir>` writes `<out-dir>/songs/…`,
 * `<out-dir>/seven-stages.lr2crs` and `<out-dir>/skins/{lr2,beatoraja}/…`.
 */

const SAMPLE_RATE = 22050;

/** A mono 16-bit PCM WAV of a sine tone; `decay` fades it to silence over its length. */
export function sineWAV(frequency: number, seconds: number, amplitude: number, decay: boolean): Uint8Array {
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

/**
 * A PNG of horizontal bands of solid colour, `bandHeight` rows each, top to bottom: what the fixture skins cut their
 * images from.
 */
export function bandsPNG(
  width: number,
  bandHeight: number,
  colours: ReadonlyArray<readonly [number, number, number]>,
): Uint8Array {
  const height = bandHeight * colours.length;
  const stride = width * 4 + 1;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const [r, g, b] = colours[Math.floor(y / bandHeight)]!;
    // Each scanline starts with its filter type, 0 (none).
    for (let x = 0; x < width; x += 1) pixels.set([r, g, b, 255], y * stride + 1 + x * 4);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  // Bit depth 8, colour type 6 (RGBA), default compression, filter and no interlace.
  header.set([8, 6, 0, 0, 0], 8);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const body = new Uint8Array(4 + data.length);
    body.set(new TextEncoder().encode(type));
    body.set(data, 4);
    const out = new Uint8Array(8 + data.length + 4);
    const chunkView = new DataView(out.buffer);
    chunkView.setUint32(0, data.length);
    out.set(body, 4);
    chunkView.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** The fixture skins' image: grey, blue, orange and green bands of 64 pixels. */
const SKIN_IMAGE_BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [40, 40, 48],
  [48, 96, 200],
  [224, 128, 32],
  [64, 176, 96],
];

/**
 * The files of the fixture skins that are not text: each skin's image and the sounds of its sound set, a short tone
 * of its own pitch each. The skins' text files are kept in `scripts/course-checklist/skins/`.
 */
const SKIN_BINARIES: ReadonlyArray<{ path: string; tone?: number }> = [
  { path: 'lr2/LR2files/Theme/E2E/parts.png' },
  { path: 'lr2/LR2files/BGM/e2e/select.wav', tone: 330 },
  { path: 'lr2/LR2files/BGM/e2e/decide.wav', tone: 392 },
  ...['f-open', 'f-close', 'o-open', 'o-close', 'o-change', 'scratch'].map((name, index) => ({
    path: `lr2/LR2files/Sound/e2e/${name}.wav`,
    tone: 1000 + index * 100,
  })),
  { path: 'lr2/LR2files/Sound/e2e/clear.wav', tone: 523 },
  { path: 'lr2/LR2files/Sound/e2e/fail.wav', tone: 262 },
  { path: 'lr2/LR2files/Sound/e2e/course_clear.wav', tone: 659 },
  { path: 'lr2/LR2files/Sound/e2e/course_fail.wav', tone: 196 },
  { path: 'beatoraja/skin/E2E/parts.png' },
  { path: 'beatoraja/skin/E2E/sound/decide.wav', tone: 392 },
  { path: 'beatoraja/skin/E2E/sound/clear.wav', tone: 523 },
  { path: 'beatoraja/skin/E2E/sound/fail.wav', tone: 262 },
  { path: 'beatoraja/skin/E2E/sound/course_clear.wav', tone: 659 },
  { path: 'beatoraja/skin/E2E/sound/course_fail.wav', tone: 196 },
];

/** Writes the fixture skins to `<outDir>/skins`: the text files kept here, then their images and sounds. */
export async function writeFixtureSkins(outDir: string): Promise<void> {
  const skins = join(outDir, 'skins');
  await cp(fileURLToPath(new URL('./skins', import.meta.url)), skins, { recursive: true });
  for (const { path, tone } of SKIN_BINARIES) {
    const file = join(skins, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, tone === undefined ? bandsPNG(256, 64, SKIN_IMAGE_BANDS) : sineWAV(tone, 0.3, 6000, true));
  }
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
export function fixtureBMS(chart: FixtureChart): string {
  const lines = [
    '#PLAYER 1',
    '#GENRE FIXTURE',
    `#TITLE ${chart.title}`,
    '#ARTIST Be-Music Dev Team',
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

/** The MD5 a course lists for a stage no chart of the library has (`FIX MISSING STAGE`). */
export const MISSING_STAGE_MD5 = '0123456789abcdef0123456789abcdef';

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

/**
 * Writes the checklist library to `<outDir>/songs`, the seven-stage course file to `<outDir>` and the fixture skins
 * to `<outDir>/skins`.
 */
export async function writeChecklistFixtures(outDir: string): Promise<void> {
  await writeFixtureSkins(outDir);
  const chartEntries = join(outDir, 'songs');
  const md5 = new Map<string, string>();
  for (const [id, { folder, chart }] of Object.entries(FIXTURE_CHARTS)) {
    const dir = join(chartEntries, folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'k1.wav'), sineWAV(660, 0.12, 9000, true));
    await writeFile(join(dir, 'k2.wav'), sineWAV(880, 0.12, 9000, true));
    await writeFile(
      join(dir, 'bgm.wav'),
      sineWAV(220, (chart.measures * 4 * 60) / (chart.bpm ?? 150) + 1, 3000, false),
    );
    const bms = fixtureBMS(chart);
    await writeFile(join(dir, `${folder}.bms`), bms);
    md5.set(id, createHash('md5').update(bms).digest('hex'));
  }
  const stages = (ids: string) => ids.split('').map((id) => md5.get(id)!);
  await mkdir(join(chartEntries, 'courses'), { recursive: true });
  await writeFile(
    join(chartEntries, 'courses', 'fixture-courses.lr2crs'),
    lr2CourseList([
      { title: 'FIX GRADE', type: 2, md5s: stages('ABC') },
      { title: 'FIX EXPERT', type: 0, md5s: stages('ABC') },
      { title: 'FIX NONSTOP', type: 1, md5s: stages('ABG') },
      { title: 'FIX GRADE FAIL', type: 2, md5s: stages('ADB') },
      { title: 'FIX MISSING STAGE', type: 0, md5s: [md5.get('A')!, MISSING_STAGE_MD5] },
    ]),
  );
  // Kept outside `songs/` so it is dropped on its own, for the five-stage warning.
  await writeFile(
    join(outDir, 'seven-stages.lr2crs'),
    lr2CourseList([{ title: 'FIX SEVEN STAGES', type: 0, md5s: stages('ABCEFGA') }]),
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2];
  if (outDir === undefined) {
    console.error('usage: node scripts/course-checklist/fixtures.ts <out-dir>');
    process.exit(1);
  }
  await writeChecklistFixtures(resolve(outDir));
  console.log(`fixtures written to ${resolve(outDir)}`);
}
