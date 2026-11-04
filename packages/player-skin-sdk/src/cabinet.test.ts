import { describe, expect, it } from 'vite-plus/test';
import {
  cabinetStage,
  formatScoreDiff,
  resolveCabinetBGARect,
  resolveCabinetLayout,
  resolveScratchAngle,
  resolveLanePlayLabel,
  resolveDifficultyName,
  resolveScorePace,
  resolveStageLabel,
} from './cabinet.ts';
import { resolveGameplayLayout } from './layout.ts';
import type { BeMusicRect } from './types.ts';

const SP7 = ['16', '11', '12', '13', '14', '15', '18', '19'];
const DP14 = [...SP7, '21', '22', '23', '24', '25', '28', '29', '26'];

function inside(inner: BeMusicRect, outer: { width: number; height: number }): boolean {
  return inner.x >= 0 && inner.y >= 0 && inner.x + inner.w <= outer.width && inner.y + inner.h <= outer.height;
}

function overlaps(a: BeMusicRect, b: BeMusicRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('resolveCabinetLayout', () => {
  const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7' }, cabinetStage);
  const cabinet = resolveCabinetLayout(layout);

  it('puts the keys, gauge, score and hi-speed under the lanes', () => {
    expect(cabinet.keys.y).toBeGreaterThan(layout.playfield.judgementY);
    expect(cabinet.gauge.y).toBeGreaterThan(cabinet.keys.y + cabinet.keys.h);
    expect(cabinet.score.y).toBeGreaterThan(cabinet.gauge.y + cabinet.gauge.h);
    expect(cabinet.hiSpeed.x).toBeGreaterThan(cabinet.score.x + cabinet.score.w);
    // Inside the play area's frame, clear of its edge.
    expect(cabinet.score.x).toBeGreaterThan(cabinet.play.x);
    expect(cabinet.hiSpeed.x + cabinet.hiSpeed.w).toBeLessThan(cabinet.play.x + cabinet.play.w);
    expect(cabinet.score.y + cabinet.score.h).toBeLessThan(cabinet.play.y + cabinet.play.h);
    expect(cabinet.progress!.x + cabinet.progress!.w).toBeLessThanOrEqual(layout.playfield.left);
  });

  it('lays the graph and the right-hand column out clear of the play area and each other', () => {
    const panels = [
      cabinet.graph!.header,
      cabinet.graph!.bars,
      cabinet.graph!.footer,
      cabinet.stage,
      cabinet.players,
      cabinet.bga,
      cabinet.judge,
      cabinet.bpm,
      cabinet.tempo,
    ];
    for (const panel of panels) {
      expect(inside(panel, cabinetStage)).toBe(true);
      expect(overlaps(panel, cabinet.play)).toBe(false);
    }
    for (const [index, a] of panels.entries()) {
      for (const b of panels.slice(index + 1)) expect(overlaps(a, b)).toBe(false);
    }
  });

  it('aligns the stage band with the chart panel', () => {
    expect(cabinet.stage.x).toBe(cabinet.players.x);
    expect(cabinet.stage.x + cabinet.stage.w).toBe(cabinet.players.x + cabinet.players.w);
  });

  it('places the BGA square the stage hands the player', () => {
    expect(layout.bga).toEqual(cabinet.bga);
    expect(cabinet.bga).toEqual({ x: 484, y: 98, w: 254, h: 254 });
  });

  it('keeps eight-pixel gaps through the information and graph columns', () => {
    const graph = cabinet.graph!;
    for (const column of [
      [graph.header, graph.bars, graph.footer],
      [cabinet.stage, cabinet.players, cabinet.bga, cabinet.judge],
    ]) {
      for (let index = 1; index < column.length; index += 1) {
        const previous = column[index - 1]!;
        expect(column[index]!.y - previous.y - previous.h).toBe(8);
      }
    }
    expect(cabinet.tempo.y - cabinet.bpm.y - cabinet.bpm.h).toBe(8);
    expect(cabinet.players.h).toBeGreaterThanOrEqual(52);
  });

  it('hides a BGA that would be a postage stamp', () => {
    expect(resolveCabinetBGARect(720).w).toBe(0);
  });
});

describe('resolveCabinetLayout for double play', () => {
  const layout = resolveGameplayLayout({ laneChannels: DP14, playVariant: '14' }, cabinetStage);
  const cabinet = resolveCabinetLayout(layout);

  it('centres the lanes on the stage', () => {
    expect(cabinet.doublePlay).toBe(true);
    expect((layout.playfield.left + layout.playfield.right) / 2).toBeCloseTo(cabinetStage.width / 2, 0);
    expect(layout.lanes[0]!.x).toBe(layout.playfield.left);
  });

  it('puts the chart, the BGA and the judgement panel left of the lanes, and the graph right of them', () => {
    for (const panel of [cabinet.stage, cabinet.players, cabinet.bga, cabinet.judge]) {
      expect(panel.x + panel.w).toBeLessThan(layout.playfield.left);
    }
    for (const panel of [cabinet.graph!.header, cabinet.graph!.bars, cabinet.graph!.footer, cabinet.tempo]) {
      expect(panel.x).toBeGreaterThan(layout.playfield.right);
      expect(inside(panel, cabinetStage)).toBe(true);
    }
    expect(layout.bga).toEqual(cabinet.bga);
    expect(cabinet.bga.w).toBeGreaterThan(0);
  });

  it('aligns the controls with the graph column', () => {
    const controls = cabinet.controls!;
    expect(cabinet.graph!.header.y).toBeGreaterThanOrEqual(controls.y + controls.h);
    expect(controls.x).toBeGreaterThan(layout.playfield.right);
    expect(controls.x).toBe(cabinet.graph!.header.x);
    expect(controls.x + controls.w).toBe(cabinet.graph!.header.x + cabinet.graph!.header.w);
  });

  it('uses equal gaps between the panels in both side columns', () => {
    const left = [cabinet.stage, cabinet.players, cabinet.bga, cabinet.judge];
    const right = [cabinet.controls!, cabinet.graph!.header, cabinet.graph!.bars, cabinet.graph!.footer, cabinet.tempo];
    for (const column of [left, right]) {
      for (let index = 1; index < column.length; index += 1) {
        const previous = column[index - 1]!;
        expect(column[index]!.y - previous.y - previous.h).toBe(8);
      }
    }
  });

  it('lays the score, the shared gauge, the hi-speed and the BPM under the keys', () => {
    const under = cabinet.keys.y + cabinet.keys.h;
    for (const panel of [cabinet.score, cabinet.gauge, cabinet.hiSpeed, cabinet.bpm]) {
      expect(panel.y).toBeGreaterThan(under);
      expect(inside(panel, cabinetStage)).toBe(true);
    }
    expect(cabinet.score.x + cabinet.score.w).toBeLessThan(cabinet.gauge.x);
    expect(cabinet.gauge.x + cabinet.gauge.w).toBeLessThan(cabinet.hiSpeed.x);
    expect(cabinet.bpm.y).toBeGreaterThan(cabinet.gauge.y + cabinet.gauge.h);
  });

  it('puts the shared gauge’s box between the two banks of keys', () => {
    const { sides } = layout.playfield;
    expect(cabinet.center!.x).toBeGreaterThanOrEqual(sides['1P']!.right);
    expect(cabinet.center!.x + cabinet.center!.w).toBeLessThanOrEqual(sides['2P']!.left);
  });

  it.each([false, true])('leaves keyboard modes at the margin (twoPlayer=%s)', (twoPlayer) => {
    const keys = Array.from({ length: 50 }, (_, index) => `${index < 25 ? '1' : '2'}${index.toString(36)}`);
    const keyboard = resolveGameplayLayout({ laneChannels: keys, playVariant: '48', twoPlayer }, cabinetStage);
    expect(keyboard.playfield.left).toBeLessThan(40);
    expect(resolveCabinetLayout(keyboard).doublePlay).toBe(false);
  });
});

describe('two-player cabinet layout', () => {
  it.each([
    ['14', DP14],
    ['10', ['16', '11', '12', '13', '14', '15', '21', '22', '23', '24', '25', '26']],
  ] as const)('places %s banks on opposite edges with a central monitor', (playVariant, laneChannels) => {
    const layout = resolveGameplayLayout({ laneChannels, playVariant, twoPlayer: true }, cabinetStage);
    const cabinet = resolveCabinetLayout(layout);
    const one = layout.playfield.sides['1P']!;
    const two = layout.playfield.sides['2P']!;
    expect(layout.twoPlayer).toBe(true);
    expect(cabinet.doublePlay).toBe(false);
    expect(one.left).toBe(33);
    expect(two.right).toBe(cabinetStage.width - 33);
    expect(layout.bga).toEqual(cabinet.bga);
    expect(cabinet.bga.x).toBeGreaterThan(one.right);
    expect(cabinet.bga.x + cabinet.bga.w).toBeLessThan(two.left);
    expect(cabinet.bga.x).toBe(cabinet.judge.x);
    expect(cabinet.bga.w).toBe(cabinet.judge.w);
    expect(cabinet.bpm.x).toBe(cabinet.judge.x);
    expect(cabinet.gauge.x).toBe(one.left);
    expect(cabinet.gauge.w).toBe(one.right - one.left);
    expect(cabinet.secondSide!.gauge.x).toBe(two.left);
    expect(cabinet.secondSide!.gauge.w).toBe(two.right - two.left);
    expect(cabinet.gauge.y).toBeGreaterThan(cabinet.keys.y + cabinet.keys.h);
    expect(cabinet.center).toBeUndefined();
    expect(cabinet.graph).toBeDefined();
    expect(cabinet.progress).toBeDefined();
    expect(cabinet).not.toHaveProperty('maxCombo');
    expect(cabinet).not.toHaveProperty('time');
    expect(cabinet.secondSide).not.toHaveProperty('maxCombo');
    expect(cabinet.players.h).toBeGreaterThanOrEqual(46);
    expect(cabinet.judge.h).toBeGreaterThanOrEqual(84);
    const panels = [
      cabinet.controls!,
      cabinet.graph!.header,
      cabinet.graph!.bars,
      cabinet.graph!.footer,
      cabinet.progress!,
      cabinet.stage,
      cabinet.score,
      cabinet.secondSide!.score,
      cabinet.bga,
      cabinet.gauge,
      cabinet.secondSide!.gauge,
      cabinet.hiSpeed,
      cabinet.secondSide!.hiSpeed,
      cabinet.players,
      cabinet.judge,
      cabinet.bpm,
      cabinet.tempo,
    ];
    for (const [index, panel] of panels.entries()) {
      expect(inside(panel, cabinetStage)).toBe(true);
      expect(panel.w).toBeGreaterThan(0);
      expect(panel.h).toBeGreaterThan(0);
      for (const other of panels.slice(index + 1)) expect(overlaps(panel, other)).toBe(false);
    }
    // The scratch stays outside each bank, and keys retain their single-play widths.
    const ordered = [...layout.lanes].sort((a, b) => a.x - b.x);
    expect(ordered[0]!.channel).toBe('16');
    expect(ordered.at(-1)!.channel).toBe('26');
    expect(layout.lanes.find((lane) => lane.channel === '11')!.w).toBe(24);
    const dp = resolveGameplayLayout({ laneChannels, playVariant }, cabinetStage);
    expect(resolveCabinetLayout(dp).doublePlay).toBe(true);
    expect(dp.playfield.right - dp.playfield.left).toBeLessThan(layout.playfield.right - layout.playfield.left);
  });
});

describe('resolveScorePace', () => {
  const half = { exScore: 400, exScoreMax: 1000, totalNotes: 500, perfect: 200, great: 50 };

  it('paces the AAA line by the notes judged when the host names no target', () => {
    expect(resolveScorePace(half)).toEqual({
      exScore: 400,
      max: 1000,
      progress: 0.5,
      target: { label: 'AAA', exScore: 889, pace: 445, diff: -45 },
    });
  });

  it('paces the host target and the best record', () => {
    const pace = resolveScorePace({ ...half, targetEXScore: 700, targetLabel: 'RIVAL', bestEXScore: 760 });
    expect(pace.target).toEqual({ label: 'RIVAL', exScore: 700, pace: 350, diff: 50 });
    expect(pace.best).toEqual({ label: 'MY BEST', exScore: 760, pace: 380, diff: 20 });
  });

  it('takes where the host target stands now in place of the share, when the host knows it', () => {
    const pace = resolveScorePace({ ...half, targetEXScore: 700, targetPaceEXScore: 420, targetLabel: 'GHOST' });
    expect(pace.target).toEqual({ label: 'GHOST', exScore: 700, pace: 420, diff: -20 });
    // Without a target the AAA line paces by share, whatever pace is given.
    expect(resolveScorePace({ ...half, targetPaceEXScore: 420 }).target.pace).toBe(445);
  });

  it('holds everything at zero before the first judgement', () => {
    const pace = resolveScorePace({ exScoreMax: 1000, totalNotes: 500, bestEXScore: 0 });
    expect(pace.progress).toBe(0);
    expect(pace.target.pace).toBe(0);
    expect(pace.best).toBeUndefined();
  });
});

describe('formatScoreDiff', () => {
  it('signs four digits', () => {
    expect(formatScoreDiff(168)).toBe('+0168');
    expect(formatScoreDiff(-3)).toBe('-0003');
    expect(formatScoreDiff(0)).toBe('±0000');
  });
});

describe('resolveStageLabel', () => {
  const stages = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];

  it('names a single chart, a course stage and its last', () => {
    expect(resolveStageLabel(undefined)).toBe('FREE PLAY');
    expect(resolveStageLabel({ kind: 'expert', title: 'Course', stages, stageIndex: 0 })).toBe('1ST STAGE');
    expect(resolveStageLabel({ kind: 'grade', title: 'Dan', stages, stageIndex: 1 })).toBe('2ND STAGE');
    expect(resolveStageLabel({ kind: 'grade', title: 'Dan', stages, stageIndex: 2 })).toBe('FINAL STAGE');
  });

  it('names a NONSTOP run by its course', () => {
    expect(resolveStageLabel({ kind: 'nonstop', title: 'Marathon', stages, stageIndex: 0 })).toBe('Marathon');
  });
});

describe('resolveDifficultyName', () => {
  const chart = (difficulty?: number) => ({ chart: { metadata: { difficulty } } }) as never;

  it('names #DIFFICULTY 1 to 5', () => {
    expect(resolveDifficultyName(chart(4))).toBe('ANOTHER');
    expect(resolveDifficultyName(chart(1))).toBe('BEGINNER');
    expect(resolveDifficultyName(chart(6))).toBeUndefined();
    expect(resolveDifficultyName(chart())).toBeUndefined();
  });
});

it('rotates scratches once every four chart beats, wrapping count-in beats', () => {
  for (const [beat, angle] of [
    [0, 0],
    [1, Math.PI / 2],
    [2, Math.PI],
    [3, Math.PI * 1.5],
    [4, 0],
    [8, 0],
    [-1, Math.PI * 1.5],
  ] as const) {
    expect(resolveScratchAngle(beat)).toBeCloseTo(angle);
  }
  expect(resolveScratchAngle(NaN)).toBe(0);
});

it.each([false, true])(
  'keeps the keys close to extended lanes and reserves the gauge label band (twoPlayer=%s)',
  (twoPlayer) => {
    const layout = resolveGameplayLayout(
      { laneChannels: twoPlayer ? DP14 : SP7, laneCount: twoPlayer ? 16 : 8, twoPlayer },
      cabinetStage,
    );
    const cabinet = resolveCabinetLayout(layout);
    expect(layout.playfield.judgementY).toBe(333);
    expect(cabinet.keys.y - layout.playfield.judgementY).toBe(2);
    expect(cabinet.gaugeLabelY).toBe((cabinet.keys.y + cabinet.keys.h + cabinet.gauge.y) / 2);
    expect(cabinet.score.y - cabinet.keys.y - cabinet.keys.h).toBeGreaterThanOrEqual(10);
  },
);

it('labels automated lane banks and distinguishes the ghost from live input', () => {
  expect(resolveLanePlayLabel({}, '1P')).toBeUndefined();
  expect(resolveLanePlayLabel({ autoplay: true }, '1P')).toBe('AUTO PLAY');
  expect(resolveLanePlayLabel({ autoplay: true }, '2P')).toBe('AUTO PLAY');
  expect(resolveLanePlayLabel({ ghostSide: '2P' }, '1P')).toBeUndefined();
  expect(resolveLanePlayLabel({ autoplay: true, ghostSide: '2P' }, '2P')).toBe('GHOST PLAY');
});
