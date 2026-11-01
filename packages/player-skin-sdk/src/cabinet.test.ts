import { describe, expect, it } from 'vite-plus/test';
import {
  cabinetStage,
  formatScoreDiff,
  resolveCabinetBGARect,
  resolveCabinetLayout,
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

  it('keeps the top-right corner free for a host’s menu tab', () => {
    expect(cabinet.stage.x + cabinet.stage.w).toBeLessThanOrEqual(cabinetStage.width - 52);
  });

  it('places the BGA square the stage hands the player', () => {
    expect(layout.bga).toEqual(cabinet.bga);
    expect(cabinet.bga).toEqual({ x: 483, y: 90, w: 260, h: 260 });
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

  it('keeps the graph clear of the menu tab’s corner, with a band for controls beside the corner', () => {
    const controls = cabinet.controls!;
    expect(cabinet.graph!.header.y).toBeGreaterThanOrEqual(controls.y + controls.h);
    expect(controls.x).toBeGreaterThan(layout.playfield.right);
    expect(controls.x + controls.w).toBeLessThanOrEqual(cabinetStage.width - 52);
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

  it('leaves the keyboard modes at the margin, in the single-play arrangement', () => {
    const keys = Array.from({ length: 50 }, (_, index) => `${index < 25 ? '1' : '2'}${index.toString(36)}`);
    const keyboard = resolveGameplayLayout({ laneChannels: keys, playVariant: '48' }, cabinetStage);
    expect(keyboard.playfield.left).toBeLessThan(40);
    expect(resolveCabinetLayout(keyboard).doublePlay).toBe(false);
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
