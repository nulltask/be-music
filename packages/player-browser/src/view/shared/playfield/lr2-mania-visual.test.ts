import { expect, test } from 'vite-plus/test';
import {
  placeLR2ManiaNote,
  resolveLR2Earthquake,
  resolveLR2ManiaNoteIndexes,
  resolveLR2ManiaVisual,
  resolveLR2Nabeatsu,
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

test('SUPERLOOP turns a note about its landing point and carries a long note with it', () => {
  // 100 gives a 1000 ms turn; a quarter turn puts a note above the line beside it.
  const turned = placeLR2ManiaNote(visual({ superLoop: 100 }), note({ nowMs: 250, tailDistance: 300 }));
  expect(turned.distance).toBeCloseTo(0);
  expect(turned.xOffset).toBeCloseTo(200);
  expect(turned.tailDistance).toBeCloseTo(100);
  const whole = placeLR2ManiaNote(visual({ superLoop: 100 }), note({ nowMs: 1000 }));
  expect(whole.distance).toBeCloseTo(200);
  expect(whole.xOffset).toBeCloseTo(0);
});

test('CHAR triples the distance of every n-th note by lane and index', () => {
  // 100: every 2nd; 50: every 12th.
  expect(placeLR2ManiaNote(visual({ char: 100 }), note({ lane: 1, index: 1, tailDistance: 250 }))).toMatchObject({
    distance: 600,
    tailDistance: 750,
  });
  expect(placeLR2ManiaNote(visual({ char: 100 }), note({ lane: 1, index: 0 })).distance).toBeCloseTo(200);
  expect(placeLR2ManiaNote(visual({ char: 50 }), note({ lane: 2, index: 10 })).distance).toBeCloseTo(600);
  expect(placeLR2ManiaNote(visual({ char: 50 }), note({ lane: 2, index: 9 })).distance).toBeCloseTo(200);
});

test('HEARTBEAT pulses the size, twice as much in width as in height', () => {
  // Lane 0, index 0 at a quarter of the 500 ms period: sin = 1.
  const beat = placeLR2ManiaNote(visual({ heartbeat: 30 }), note({ lane: 0, nowMs: 125 }));
  expect(beat.widthDelta).toBeCloseTo(60);
  expect(beat.heightDelta).toBeCloseTo(30);
  expect(beat.distance).toBeCloseTo(200);
  const shrunk = placeLR2ManiaNote(visual({ heartbeat: 30 }), note({ lane: 0, nowMs: 375 }));
  expect(shrunk.widthDelta).toBeCloseTo(-60);
});

test('NABEATSU sways only in the seconds that are multiples of 3, and never in the first second', () => {
  const low = visual({ nabeatsu: 40 });
  expect(resolveLR2Nabeatsu(undefined, 3200, 1)).toEqual({ x: 0, y: 0 });
  expect(resolveLR2Nabeatsu(low, 200, 1)).toEqual({ x: 0, y: 0 });
  expect(resolveLR2Nabeatsu(low, 4200, 1)).toEqual({ x: 0, y: 0 });
  expect(resolveLR2Nabeatsu(low, 13200, 1)).toEqual({ x: 0, y: 0 });
  const swaying = resolveLR2Nabeatsu(low, 3200, 1);
  expect(swaying.x).not.toBe(0);
  expect(Math.abs(swaying.x)).toBeLessThanOrEqual(40);
  expect(Math.abs(swaying.y)).toBeLessThanOrEqual(30);
});

test('NABEATSU from 50 up also sways in seconds 30–39 and seconds ending in 3', () => {
  const high = visual({ nabeatsu: 50 });
  expect(resolveLR2Nabeatsu(high, 13200, 1).x).not.toBe(0);
  expect(resolveLR2Nabeatsu(high, 31200, 1).x).not.toBe(0);
  expect(resolveLR2Nabeatsu(high, 14200, 1)).toEqual({ x: 0, y: 0 });
});

test('NABEATSU sways a note with the note layer, and the later effects act on the swayed note', () => {
  const sway = { x: 12, y: 30 };
  // The layer carries the sway, so a note that nothing else moves keeps its place in it.
  const plain = placeLR2ManiaNote(visual({ nabeatsu: 40 }), note({ sway }));
  expect(plain.distance).toBeCloseTo(200);
  expect(plain.xOffset).toBeCloseTo(0);
  // CHAR triples the swayed offset: (-200 + 30) × 3, less the layer's 30.
  const tripled = placeLR2ManiaNote(visual({ nabeatsu: 40, char: 100 }), note({ lane: 1, index: 1, sway }));
  expect(tripled.distance).toBeCloseTo(540);
  // TORNADO sets the sideways place outright, dropping the sway.
  const tornado = placeLR2ManiaNote(visual({ nabeatsu: 40, tornado: 100 }), note({ lane: 0, nowMs: 0, sway }));
  expect(tornado.xOffset).toBeCloseTo(-12);
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
