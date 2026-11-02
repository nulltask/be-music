import { expect, test } from 'vite-plus/test';
import {
  CHART_PLAYFIELD_IDENTITY,
  hasChartPlayfieldVisual,
  resolveChartCrazyClones,
  resolveChartCrazyField,
  resolveChartCrazyRotation,
  resolveChartCrazyTint,
  resolveChartCrazyWaveScale,
  resolveChartCrazyYProgress,
  resolveChartLineLift,
  resolveChartPlayfieldVisual,
} from './chart-option-crazy.ts';
import { isChartVisualOptionValue, parseChartVisualOption, resolveChartNoteVisual } from './chart-option-visual.ts';

const note = (seconds: number, beat = 8, channel = '11') => ({ channel, beat, seconds });

test('version 3 parses every remaining visual CRAZY option into its own subfamily', () => {
  expect(parseChartVisualOption('774:CRAZY_STAR')).toEqual({ set: { crazyColor: 'STAR' }, clear: [] });
  expect(parseChartVisualOption('774:CRAZY_SPIN')).toEqual({ set: { crazySpin: 'SPIN' }, clear: [] });
  expect(parseChartVisualOption('774:CRAZY_S-CLONE')).toEqual({ set: { crazyClone: 'S-CLONE' }, clear: [] });
  expect(parseChartVisualOption('774:CRAZY_LINEMOVE2')).toEqual({ set: { crazyLine: 'LINEMOVE2' }, clear: [] });
  expect(parseChartVisualOption('774:CRAZY_HIDJUDGE')).toEqual({ set: { crazyJudge: 'HIDJUDGE' }, clear: [] });
  expect(parseChartVisualOption('774:CRAZY_DARK2')).toEqual({ set: { crazyDark: 'DARK2' }, clear: [] });
  expect(parseChartVisualOption('774:CRAZY_REVERSE')).toEqual({ set: { crazyReverse: 'REVERSE' }, clear: [] });
  for (const wave of ['YWAVE', 'YWAVE2', 'XYWAVE', 'XYWAVE2', '3DWAVE', '3DWAVE2'])
    expect(parseChartVisualOption(`774:CRAZY_${wave}`)).toEqual({ set: { crazyWave: wave }, clear: [] });
  expect(parseChartVisualOption('774:HIDDEN_M-SUDDEN')).toEqual({ set: { hidden: 'M-SUDDEN' }, clear: [] });
  expect(resolveChartCrazyField('GOOD2BAD')).toBeUndefined();
});

test('a version-2 recording can never carry a version-3 value or field', () => {
  expect(isChartVisualOptionValue('hidden', 'M-SUDDEN', 2)).toBe(false);
  expect(isChartVisualOptionValue('hidden', 'M-SUDDEN', 3)).toBe(true);
  expect(isChartVisualOptionValue('crazyWave', 'XWAVE', 2)).toBe(true);
  expect(isChartVisualOptionValue('crazyWave', 'YWAVE', 2)).toBe(false);
  expect(isChartVisualOptionValue('crazySpin', 'SPIN', 2)).toBe(false);
  expect(isChartVisualOptionValue('crazySpin', 'SPIN')).toBe(true);
  expect(isChartVisualOptionValue('crazyDark', 'DARK3')).toBe(false);
});

test('the Y wave stops and goes without moving back, fixed on the line and at the lane top', () => {
  for (const wave of ['YWAVE', 'YWAVE2', 'XYWAVE', 'XYWAVE2']) {
    expect(resolveChartCrazyYProgress(wave, 0)).toBe(0);
    expect(resolveChartCrazyYProgress(wave, 1)).toBeCloseTo(1);
    let previous = -Infinity;
    for (let step = 0; step <= 200; step += 1) {
      const value = resolveChartCrazyYProgress(wave, step / 100);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = value;
    }
  }
  // YWAVE2 comes to a full stop at each fifth of the lane: the slope there is 0.
  const at = 0.2;
  expect(resolveChartCrazyYProgress('YWAVE2', at + 1e-4) - resolveChartCrazyYProgress('YWAVE2', at)).toBeLessThan(1e-6);
  expect(resolveChartCrazyYProgress('XWAVE', 0.3)).toBe(0.3);
  expect(resolveChartCrazyYProgress(undefined, -0.2)).toBe(-0.2);
});

test('the 3D wave grows and shrinks a note and lands at its own size', () => {
  expect(resolveChartCrazyWaveScale('3DWAVE', 0)).toBe(1);
  expect(resolveChartCrazyWaveScale('3DWAVE', 0.125)).toBeCloseTo(1.3);
  expect(resolveChartCrazyWaveScale('3DWAVE2', 1 / 12)).toBeCloseTo(1.5);
  expect(resolveChartCrazyWaveScale('XYWAVE', 0.4)).toBe(1);
});

test('STAR cycles each note through the rainbow from its own phase, deterministically', () => {
  expect(resolveChartCrazyTint(undefined, note(0))).toBeUndefined();
  const tint = resolveChartCrazyTint('STAR', note(0.3));
  expect(tint).toBe(resolveChartCrazyTint('STAR', note(0.3)));
  expect(tint).toBe(resolveChartCrazyTint('STAR', note(1.8)));
  expect(tint).not.toBe(resolveChartCrazyTint('STAR', note(1.05)));
  expect(tint).toBeGreaterThanOrEqual(0);
  expect(tint).toBeLessThanOrEqual(0xffffff);
});

test('SPIN turns each note once a second from its own phase', () => {
  expect(resolveChartCrazyRotation(undefined, note(0.4))).toBe(0);
  const start = resolveChartCrazyRotation('SPIN', note(0));
  expect(resolveChartCrazyRotation('SPIN', note(1))).toBeCloseTo(start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(start).toBeLessThan(2 * Math.PI);
});

test('CLONE afterimages trail, flank and (S-CLONE) cross the note, all landing on it at the line', () => {
  expect(resolveChartCrazyClones(undefined, 0.5)).toEqual([]);
  expect(resolveChartCrazyClones('CLONE', 0.5)).toEqual([{ progress: 0.58, xOffset: 0, alpha: 0.4 }]);
  expect(resolveChartCrazyClones('CLONE2', 0.5).map((clone) => clone.xOffset)).toEqual([0, -1, 1]);
  const sClone = resolveChartCrazyClones('S-CLONE', 0.25);
  expect(sClone).toHaveLength(6);
  expect(sClone[3]).toEqual({ progress: 0.75, xOffset: 0, alpha: 0.25 });
  expect(sClone[4]!.xOffset).toBeCloseTo(0.375);
  for (const clone of resolveChartCrazyClones('S-CLONE', 0).slice(1)) {
    if (clone.progress === 0) expect(Math.abs(clone.xOffset) === 1 || clone.xOffset === 0).toBe(true);
  }
});

test('LINEMOVE raises the line by A(1 − cos(2πt/T))/2', () => {
  expect(resolveChartLineLift(undefined, 3)).toBe(0);
  expect(resolveChartLineLift('LINEMOVE', 0)).toBe(0);
  expect(resolveChartLineLift('LINEMOVE', 2)).toBeCloseTo(0.15);
  expect(resolveChartLineLift('LINEMOVE2', 1.5)).toBeCloseTo(0.35);
  expect(resolveChartLineLift('LINEMOVE', 4)).toBeCloseTo(0);
});

test('the playfield-level effects follow their fields', () => {
  expect(resolveChartPlayfieldVisual(undefined, 0)).toBe(CHART_PLAYFIELD_IDENTITY);
  expect(hasChartPlayfieldVisual({ crazySpin: 'SPIN' })).toBe(false);
  expect(hasChartPlayfieldVisual({ hidden: 'M-SUDDEN' })).toBe(true);
  expect(
    resolveChartPlayfieldVisual(
      { crazyReverse: 'REVERSE', crazyJudge: 'HIDJUDGE', crazyDark: 'DARK', hidden: 'M-SUDDEN', crazyLine: 'LINEMOVE' },
      2,
    ),
  ).toEqual({
    lineLift: expect.closeTo(0.15),
    reverse: true,
    hideJudge: true,
    hideBGA: true,
    hideBombs: false,
    manualSudden: true,
  });
  expect(resolveChartPlayfieldVisual({ crazyDark: 'DARK2' }, 0)).toMatchObject({ hideBGA: true, hideBombs: true });
});

test('resolveChartNoteVisual composes the version-3 per-note families', () => {
  const input = { progress: 0.5, channel: '12', beat: 4, seconds: 0.7 };
  const visual = resolveChartNoteVisual(
    { crazyWave: 'XYWAVE2', crazyColor: 'STAR', crazySpin: 'SPIN', crazyClone: 'CLONE' },
    input,
  );
  expect(visual.progress).toBeCloseTo(resolveChartCrazyYProgress('XYWAVE2', 0.5));
  expect(visual.tint).toBe(resolveChartCrazyTint('STAR', input));
  expect(visual.rotation).toBe(resolveChartCrazyRotation('SPIN', input));
  expect(visual.clones).toEqual(resolveChartCrazyClones('CLONE', visual.progress));
  // M-SUDDEN is the player's cover, not a per-note fade.
  expect(resolveChartNoteVisual({ hidden: 'M-SUDDEN' }, input)).toEqual({
    progress: 0.5,
    alpha: 1,
    scale: 1,
    xOffset: 0,
    rotation: 0,
    clones: [],
  });
});
