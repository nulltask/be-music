import { expect, test } from 'vite-plus/test';
import {
  placeLR2ManiaNote,
  resolveLR2Earthquake,
  resolveLR2ManiaNoteIndexes,
  resolveLR2ManiaVisual,
  type LR2ManiaNoteInput,
  type LR2ManiaVisual,
} from './lr2-mania-visual.ts';

const OFF = resolveLR2ManiaVisual({ lr2Acceleration: 'ACCELERATION' })!;
/** Every option off but `overrides`. */
function visual(overrides: Partial<LR2ManiaVisual>): LR2ManiaVisual {
  const off = Object.fromEntries(
    Object.entries(OFF).map(([key, value]) => [key, typeof value === 'number' ? 0 : 'OFF']),
  ) as unknown as LR2ManiaVisual;
  return { ...off, ...overrides };
}
/** A note half-way up a 400-pixel lane, on LR2's own 480-pixel stage. */
function note(overrides: Partial<LR2ManiaNoteInput> = {}): LR2ManiaNoteInput {
  return { distance: 200, lineY: 400, lane: 1, index: 0, nowMs: 0, unit: 1, ...overrides };
}

test('resolves nothing while every option is off', () => {
  expect(resolveLR2ManiaVisual(undefined)).toBeUndefined();
  expect(resolveLR2ManiaVisual({})).toBeUndefined();
  expect(resolveLR2ManiaVisual({ lr2Acceleration: 'OFF' })).toBeUndefined();
  expect(resolveLR2ManiaVisual({ lr2Acceleration: 'RANDOM' })).toMatchObject({ acceleration: 'RANDOM' });
});

test('leaves a note alone with no option on', () => {
  expect(placeLR2ManiaNote(visual({}), note({ tailDistance: 300 }))).toEqual({
    distance: 200,
    tailDistance: 300,
    xOffset: 0,
    widthDelta: 0,
    heightDelta: 0,
  });
});

test('holds a note that passed the line on the line', () => {
  expect(placeLR2ManiaNote(visual({}), note({ distance: -20 })).distance).toBeCloseTo(0);
});

test('ACCELERATION and DECELERATION remap the place along the lane and keep both ends', () => {
  const accelerated = placeLR2ManiaNote(visual({ acceleration: 'ACCELERATION' }), note({ tailDistance: 400 }));
  expect(accelerated.distance).toBeCloseTo(Math.sin(Math.PI / 4) * 400);
  expect(accelerated.tailDistance).toBeCloseTo(400);
  const decelerated = placeLR2ManiaNote(visual({ acceleration: 'DECELERATION' }), note());
  expect(decelerated.distance).toBeCloseTo((1 - Math.cos(Math.PI / 4)) * 400);
  for (const acceleration of ['ACCELERATION', 'DECELERATION'] as const) {
    expect(placeLR2ManiaNote(visual({ acceleration }), note({ distance: 0 })).distance).toBeCloseTo(0);
    expect(placeLR2ManiaNote(visual({ acceleration }), note({ distance: 400 })).distance).toBeCloseTo(400);
  }
});

test('RANDOM accelerates the notes whose index and lane sum to an even number and decelerates the others', () => {
  const random = visual({ acceleration: 'RANDOM' });
  expect(placeLR2ManiaNote(random, note({ lane: 1, index: 1 })).distance).toBeCloseTo(Math.sin(Math.PI / 4) * 400);
  expect(placeLR2ManiaNote(random, note({ lane: 1, index: 0 })).distance).toBeCloseTo(
    (1 - Math.cos(Math.PI / 4)) * 400,
  );
});

test('works in LR2 pixels whatever the stage size', () => {
  const small = placeLR2ManiaNote(visual({ acceleration: 'ACCELERATION' }), note());
  const large = placeLR2ManiaNote(
    visual({ acceleration: 'ACCELERATION' }),
    note({ distance: 400, lineY: 800, unit: 2 }),
  );
  expect(large.distance).toBeCloseTo(small.distance * 2);
});

test('EARTHQUAKE sways the screen on 1000 ms and 1234 ms sines', () => {
  expect(resolveLR2Earthquake(undefined, 250, 1)).toEqual({ x: 0, y: 0 });
  expect(resolveLR2Earthquake(visual({ earthquake: 0 }), 250, 1)).toEqual({ x: 0, y: 0 });
  const quake = resolveLR2Earthquake(visual({ earthquake: 40 }), 250, 2);
  expect(quake.x).toBeCloseTo(40 * 2);
  expect(quake.y).toBeCloseTo(Math.sin((250 / 1234) * Math.PI * 2) * 40 * 0.75 * 2);
});

test('TORNADO shifts a note sideways in proportion to its distance', () => {
  const tornado = visual({ tornado: 100 });
  // Lane 0 at a quarter of the period: sin = 1.
  const near = placeLR2ManiaNote(tornado, note({ lane: 0, nowMs: 250, distance: 100 }));
  const far = placeLR2ManiaNote(tornado, note({ lane: 0, nowMs: 250, distance: 200 }));
  expect(near.xOffset).toBeCloseTo(50);
  expect(far.xOffset).toBeCloseTo(100);
  expect(far.distance).toBeCloseTo(200);
  expect(placeLR2ManiaNote(tornado, note({ lane: 0, nowMs: 0 })).xOffset).toBeCloseTo(0);
});

test('indexes notes and mines per lane in time order', () => {
  const notes = [
    { channel: '11', seconds: 1 },
    { channel: '12', seconds: 1 },
    { channel: '11', seconds: 3 },
  ];
  const mines = [{ channel: '11', seconds: 2 }];
  const indexes = resolveLR2ManiaNoteIndexes(notes, mines);
  expect(indexes.get(notes[0]!)).toBe(0);
  expect(indexes.get(mines[0]!)).toBe(1);
  expect(indexes.get(notes[2]!)).toBe(2);
  expect(indexes.get(notes[1]!)).toBe(0);
  expect(resolveLR2ManiaNoteIndexes(notes, mines)).toBe(indexes);
});
