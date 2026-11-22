import { Canvas, createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import type { CourseCardData } from '../src/pages/course-card-data.ts';
import type { ScoreCardData } from '../src/pages/score-card-data.ts';
import { drawCourseCard } from './course-card.ts';
import { drawScoreCard } from './score-card.ts';

const playedOn = '2026-11-10';
const result = {
  playerName: 'Mina Vale',
  handle: 'mina',
  avatarUrl: '',
  rulesetLabel: 'LR2 rules',
  lamp: { label: 'HARD CLEAR', color: '#e45740' },
  exScore: 881,
  maxExScore: 990,
  rate: '88.99%',
  djRank: 'AAA',
  bp: 5,
  maxCombo: 396,
  judges: { pgreat: 412, great: 57, good: 21, bad: 3, poor: 2 },
  gauge: 'HARD 81.0%',
  playedAt: Date.UTC(2026, 10, 10),
} satisfies Omit<ScoreCardData, 'genre' | 'title' | 'subtitle' | 'artist'>;

const chart = {
  ...result,
  genre: 'TECHNO',
  title: 'Afterimage',
  subtitle: 'Late Mix',
  artist: 'Signal Garden',
} satisfies ScoreCardData;

beforeEach(() => vi.stubGlobal('OffscreenCanvas', Canvas));
afterEach(() => vi.unstubAllGlobals());

function cardCanvas() {
  const context = createCanvas(1200, 630).getContext('2d');
  const text = vi.spyOn(context, 'fillText');
  return {
    // The test canvas supplies the standard 2D drawing calls used by the renderer.
    context: context as unknown as CanvasRenderingContext2D,
    pixelsAt: (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data],
    printed: () => text.mock.calls.map(([value]) => value),
    textX: (value: string) => text.mock.calls.find(([word]) => word === value)?.[1],
  };
}

test('a score share card draws the actual chart notes, result and player', () => {
  const card = cardCanvas();
  const avatar = createCanvas(20, 20);
  const image = avatar.getContext('2d');
  image.fillStyle = '#1bb34a';
  image.fillRect(0, 0, 20, 20);
  drawScoreCard(
    card.context,
    {
      ...chart,
      excerpt: {
        beats: 8,
        widths: 'shared',
        lanes: [
          { tone: 'blue', side: '1P' },
          { tone: 'white', side: '1P' },
        ],
        bars: [0, 4, 8],
        notes: [{ lane: 0, beat: 4, end: 6 }],
      },
    },
    avatar as unknown as CanvasImageSource,
    playedOn,
  );

  expect(card.printed()).toEqual(
    expect.arrayContaining([
      'TECHNO',
      'Afterimage',
      'Late Mix  ·  Signal Garden',
      'AAA',
      '881',
      '/ 990',
      '88.99%',
      'HARD CLEAR',
      'LR2 rules',
      'HARD 81.0%',
      'Mina Vale',
      '@mina  ·  2026-11-10',
    ]),
  );
  // A label and its count must share a column, even when the glyphs have different left bearings.
  for (const [label, value] of [
    ['PGREAT', '412'],
    ['GREAT', '57'],
    ['GOOD', '21'],
    ['BAD', '3'],
    ['POOR', '2'],
    ['BP', '5'],
    ['COMBO', '396'],
  ] as const) {
    expect(Math.abs((card.textX(label) ?? Infinity) - (card.textX(value) ?? Infinity)), label).toBeLessThan(8);
  }
  // The held blue key sits in the left lane: beat 4's head, the hold body, then beat 6's tail.
  expect(card.pixelsAt(920, 276)).toEqual([78, 201, 255, 255]);
  expect(card.pixelsAt(920, 227)).toEqual([44, 127, 168, 255]);
  expect(card.pixelsAt(920, 192)).toEqual([78, 201, 255, 255]);
  expect(card.pixelsAt(1140, 276)).not.toEqual([78, 201, 255, 255]);
  expect(card.pixelsAt(1000, 455)).toEqual([228, 87, 64, 255]);
  expect(card.pixelsAt(1100, 574)).toEqual([27, 179, 74, 255]);
  expect(card.pixelsAt(1074, 548)).not.toEqual([27, 179, 74, 255]);
});

test('a score card without a chart document or avatar shows decorative notes and the player’s initial', () => {
  const card = cardCanvas();
  drawScoreCard(card.context, { ...chart, genre: null, subtitle: null, artist: 'Signal Garden' }, null, playedOn);

  expect(card.printed()).toEqual(expect.arrayContaining(['Afterimage', 'Signal Garden', 'M', 'Mina Vale']));
  expect(card.pixelsAt(1055, 113)).toEqual([255, 255, 255, 255]);
  expect(card.pixelsAt(1100, 555)).toEqual([51, 65, 85, 255]);
});

test('a course share card distinguishes the failed stage from the cleared and unreached stages', () => {
  const card = cardCanvas();
  const course: CourseCardData = {
    ...result,
    lamp: { label: 'FAILED', color: '#d34552' },
    courseName: 'Winter Trial',
    kindLabel: 'GRADE COURSE',
    stagesPlayed: 2,
    trophy: null,
    stages: [
      { title: 'North', state: 'cleared', rate: '97.12%' },
      { title: 'South', state: 'failed', rate: '71.23%' },
      { title: 'East', state: 'unreached', rate: null },
    ],
  };
  drawCourseCard(card.context, course, null, playedOn);

  const stageText = card.printed().slice(card.printed().indexOf('STAGE 1'));
  expect(stageText.slice(0, 8)).toEqual([
    'STAGE 1',
    '97.12%',
    'North',
    'STAGE 2',
    '71.23%',
    'South',
    'STAGE 3',
    'East',
  ]);
  expect(card.printed()).toEqual(expect.arrayContaining(['GRADE COURSE', 'Winter Trial', '2 / 3 stages', 'FAILED']));
  expect(card.pixelsAt(844, 134)).toEqual([199, 205, 224, 255]);
  expect(card.pixelsAt(844, 210)).toEqual([255, 77, 94, 255]);
  expect(card.pixelsAt(844, 286)).toEqual([46, 54, 87, 255]);
});

test('a long course share card counts the hidden stages instead of drawing past the panel', () => {
  const card = cardCanvas();
  const course: CourseCardData = {
    ...result,
    courseName: 'Eight Bars',
    kindLabel: 'EXPERT COURSE',
    stagesPlayed: 8,
    trophy: 'Gold',
    stages: Array.from({ length: 8 }, (_, index) => ({
      title: `Chart ${index + 1}`,
      rate: null,
      state: 'played',
    })),
  };
  drawCourseCard(card.context, course, null, playedOn);

  expect(card.printed().filter((text) => /^STAGE |^\+\d+ MORE$/.test(text))).toEqual([
    'STAGE 1',
    'STAGE 2',
    'STAGE 3',
    'STAGE 4',
    '+4 MORE',
  ]);
  expect(card.printed()).toContain('8 / 8 stages  ·  Gold');
  expect(card.printed()).not.toContain('Chart 5');
});
