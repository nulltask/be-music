import { parseBMSKeyBoundBGA, type KeyBoundBGACue } from '@be-music/chart-model';
import { expect, test } from 'vite-plus/test';
import { buildAutoKeyBoundBGAInputs, KeyBoundBGAController, type KeyBoundBGAInput } from './key-bound-bga.ts';

const cue = (raw = '100:400:16:0:255,255,255,255 00010203', seconds = 1, definitionId = '01'): KeyBoundBGACue => ({
  seconds,
  definitionId,
  definition: parseBMSKeyBoundBGA(raw)!,
});
const input = (seconds: number, action: KeyBoundBGAInput['action'], ...channels: string[]): KeyBoundBGAInput => ({
  seconds,
  action,
  channels,
});

test('A5 arms input without starting playback; only a fresh press on its bound lane starts the sequence', () => {
  const state = new KeyBoundBGAController([cue()]);
  state.addInput(input(0.5, 'down', '16'));
  expect(state.read(1)).toBeUndefined();
  state.addInput(input(1.1, 'down', '11'));
  state.addInput(input(1.2, 'down', '16'));
  expect(state.read(1.2)).toBeUndefined(); // A held key and OS repeats do not manufacture a new edge.
  state.addInput(input(1.3, 'up', '16'));
  state.addInput(input(1.4, 'down', '16'));
  expect(state.read(1.4)).toMatchObject({ bmpKey: '00', definitionId: '01', startedSeconds: 1.4 });
  expect(state.read(1.5)).toMatchObject({ bmpKey: '01', frameStartSeconds: 1.5 });
  state.addInput(input(1.55, 'up', '16'));
  expect(state.read(1.6)?.bmpKey).toBe('02'); // Finite duration outlives release.
  expect(state.read(1.8)).toBeUndefined();
});

test('duration-zero animation loops while held and disappears at release without restoring an older animation', () => {
  const state = new KeyBoundBGAController(
    [cue('100:1000:16:0:255,255,255,255 01'), cue('50:0:11:1:0,1,2,3 0203', 1.1, '02')],
    { inputs: [input(1, 'down', '16'), input(1.2, 'down', '11'), input(1.25, 'up', '16'), input(1.45, 'up', '11')] },
  );
  expect(state.read(1)?.bmpKey).toBe('01');
  expect(state.read(1.2)?.bmpKey).toBe('02');
  expect(state.read(1.25)?.bmpKey).toBe('03');
  expect(state.read(1.4)).toMatchObject({ bmpKey: '02', argb: { a: 0, r: 1, g: 2, b: 3 } });
  expect(state.read(1.45)).toBeUndefined();
  expect(state.read(1.1)?.bmpKey).toBe('01');
});

test('latest matching input wins, release followed by a same-time press retriggers, and unrelated input does not cancel', () => {
  const state = new KeyBoundBGAController([cue()], { inputs: [input(1, 'down', '16')] });
  expect(state.read(1.2)?.bmpKey).toBe('02');
  state.addInput(input(1.2, 'up', '16'));
  state.addInput(input(1.2, 'down', '11', '16'));
  state.addInput(input(1.25, 'down', '12'));
  expect(state.read(1.3)).toMatchObject({ bmpKey: '01', startedSeconds: 1.2 });
  expect(state.read(1.6)).toBeUndefined();
});

test('replay reads are independent of frame spacing, late insertion rebuilds state, and reset retains only preloaded inputs', () => {
  const source = [input(1, 'down', '16'), input(1.05, 'up', '16'), input(2, 'down', '16')];
  const state = new KeyBoundBGAController([cue()], { inputs: source });
  const baseline = new KeyBoundBGAController([cue()], { inputs: source });
  for (const time of [0, 1, 1.1, 1.2, 1.3, 1.4, 2, 2.2, 3]) state.read(time);
  expect(state.read(2.2)).toEqual(baseline.read(2.2));
  state.addInput(input(2.05, 'up', '16'));
  state.addInput(input(2.1, 'down', '16'));
  expect(state.read(2.2)?.startedSeconds).toBe(2.1);
  state.reset();
  expect(state.read(2.2)).toEqual(baseline.read(2.2));
  expect(state.read(NaN)).toBeUndefined();
});

test('copies caller-owned definitions, input lists and returned ARGB snapshots', () => {
  const definition = cue();
  const edge = input(1, 'down', '16');
  const state = new KeyBoundBGAController([definition], { inputs: [edge] });
  definition.definition.frames[0] = 'ZZ';
  edge.channels = [];
  const frame = state.read(1)!;
  expect(frame.bmpKey).toBe('00');
  frame.argb.a = 0;
  expect(state.read(1)!.argb.a).toBe(255);
});

test('freezes A5 selections at reversal while allowing already-selected animations and later presses to run', () => {
  const state = new KeyBoundBGAController([cue(), cue('50:0:11:1:0,0,0,0 99', 2, '02')], {
    freezeSeconds: 1.5,
    inputs: [input(3, 'down', '16')],
  });
  expect(state.read(3.2)).toMatchObject({ definitionId: '01', bmpKey: '02' });
  expect(state.read(3.4)).toBeUndefined();
});

test('AUTO edges keep LN tails, deduplicate layered heads and release before rapid repeated heads', () => {
  const notes = [
    { channel: '16', seconds: 2, endSeconds: 3 },
    { channel: '16', seconds: 1 },
    { channel: '16', seconds: 1 },
    { channel: '16', seconds: 1.05 },
    { channel: '11', seconds: 1 },
  ];
  const original = structuredClone(notes);
  const edges = buildAutoKeyBoundBGAInputs(notes);
  expect(edges.filter((edge) => edge.channels[0] === '16')).toEqual([
    input(1, 'down', '16'),
    input(1.05, 'up', '16'),
    input(1.05, 'down', '16'),
    input(1.05 + 0.1, 'up', '16'),
    input(2, 'down', '16'),
    input(3, 'up', '16'),
  ]);
  const state = new KeyBoundBGAController([cue('50:0:16:1:0,0,0,0 0102', 0)], { inputs: edges });
  expect(state.read(1.05)?.startedSeconds).toBe(1.05);
  expect(state.read(2.5)?.bmpKey).toBe('01');
  expect(state.read(3)).toBeUndefined();
  expect(notes).toEqual(original);
});

test('AUTO preserves short LN tails, merges equal-time held layers and ignores invalid times', () => {
  const edges = buildAutoKeyBoundBGAInputs([
    { channel: '11', seconds: 1, endSeconds: 1.02 },
    { channel: '12', seconds: 2, endSeconds: 2.1 },
    { channel: '12', seconds: 2, endSeconds: 3 },
    { channel: '13', seconds: NaN },
    { channel: '14', seconds: 4, endSeconds: NaN },
  ]);
  expect(edges).toEqual([
    input(1, 'down', '11'),
    input(1.02, 'up', '11'),
    input(2, 'down', '12'),
    input(3, 'up', '12'),
    input(4, 'down', '14'),
    input(4.1, 'up', '14'),
  ]);
});

test.each([0, 20000])(
  'stage window ends selection and active animation even while a key stays held (duration=%s)',
  (duration) => {
    const first = { ...cue(`100:${duration}:16:1:0,0,0,0 0001`, 0), endSeconds: 2 };
    const second = { ...cue('100:0:16:1:0,0,0,0 0203', 3, '02'), endSeconds: 4 };
    const state = new KeyBoundBGAController([first, second], {
      inputs: [
        input(1.5, 'down', '16'),
        input(2.1, 'up', '16'),
        input(2.2, 'down', '16'),
        input(3.1, 'down', '16'),
        input(3.2, 'up', '16'),
        input(3.3, 'down', '16'),
      ],
    });
    expect(state.read(1.9)?.definitionId).toBe('01');
    expect(state.read(2)).toBeUndefined();
    expect(state.read(2.2)).toBeUndefined();
    expect(state.read(3.1)).toBeUndefined(); // Held across the next selection needs another fresh press.
    expect(state.read(3.3)?.definitionId).toBe('02');
    expect(state.read(4)).toBeUndefined();
    expect(state.read(1.9)?.definitionId).toBe('01');
  },
);
