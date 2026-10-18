import {
  BEATORAJA_OP,
  TIMER_FADEOUT,
  TIMER_PLAY,
  TIMER_STARTINPUT,
  type BeatorajaSkin,
} from '@be-music/beatoraja-skin';
import { createEmptyJson } from '@be-music/json';
import { parseChart } from '@be-music/parser';
import { resolveResultPresentation, type PlayResult } from '@be-music/scene-model';
import type { Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { BeatorajaPlaySkinView } from '../../scene/beatoraja/skin-view.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { BeatorajaRenderContext } from '../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type { ResultFrame } from '../types.ts';
import { BeatorajaResultView, readBeatorajaResult } from './result-view.ts';

const RESULT: PlayResult = {
  score: { total: 10, perfect: 10, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 20, score: 20 },
  maxCombo: 10,
  gauge: 76.4,
  gaugeType: 'NORMAL',
  gaugeBorder: 80,
  cleared: false,
  playSeconds: 30,
  lamp: 'FAILED',
  song: {
    id: 'chart',
    sourceId: 'source',
    sourceLabel: 'Source',
    sourceKind: 'directory',
    chartPath: 'song/chart.bms',
    directoryLabel: 'song',
    fileLabel: 'chart.bms',
    title: 'Chart',
    totalNotes: 10,
    chart: createEmptyJson('bms'),
  },
  gaugeHistory: [
    { progress: 0, value: 20 },
    { progress: 1, value: 76.4 },
  ],
  scoreHistory: [],
  judgeTimings: [{ atMs: 0, deltaMs: -12, judge: 'PERFECT' }],
};

const HOST = { app: { screen: { width: 1280, height: 720 } } } as unknown as PixiSceneHost;

function createView() {
  const skin: BeatorajaSkin = { type: 7, w: 1280, h: 720, image: [], destination: [] };
  const empty = new Map<number | string, Texture>();
  const textures: BeatorajaTextureCache = {
    get: (id) => empty.get(id),
    values: () => empty.values(),
    pathOf: () => undefined,
  };
  return new BeatorajaResultView({ family: 'beatoraja', kit: { skin, textures, files: new Map() } });
}

function frame(overrides: Partial<ResultFrame> = {}): ResultFrame {
  return {
    clock: { nowMs: 1250, enteredAtMs: 1000 },
    result: RESULT,
    presentation: resolveResultPresentation('single'),
    inputOpenAtMs: 1500,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BeatorajaResultView', () => {
  it("draws the run's ops, the gauge with its border and beatoraja's timers on the screen's own clock", async () => {
    const update = vi.spyOn(BeatorajaPlaySkinView.prototype, 'update').mockImplementation(() => undefined);
    const view = createView();
    await view.attach(HOST);
    view.draw(frame());
    const context = update.mock.calls[0]![0] as BeatorajaRenderContext;
    expect(context.nowMs).toBe(250);
    expect(context.activeOps.has(BEATORAJA_OP.RESULT_FAIL)).toBe(true);
    expect(context.getTimerStart(TIMER_STARTINPUT)).toBe(500);
    expect(context.getTimerStart(TIMER_PLAY)).toBe(0);
    expect(context.getTimerStart(TIMER_FADEOUT)).toBeUndefined();
    expect(context.resolveGaugeState?.()).toMatchObject({ value: 76.4, max: 100, border: 80 });
    view.draw(frame({ clock: { nowMs: 1700, enteredAtMs: 1000 }, leaving: { to: 'continue', atMs: 1600 } }));
    const leaving = update.mock.calls[1]![0] as BeatorajaRenderContext;
    expect(leaving.activeOps).toBe(context.activeOps);
    expect(leaving.getTimerStart(TIMER_FADEOUT)).toBe(600);
    view.dispose();
  });
});

describe('readBeatorajaResult', () => {
  const SKIN = { name: 'Skin', author: 'Author' };

  it("reads the result, the chart's #TOTAL and note kinds as played, and the timings for the distribution graph", () => {
    const playChart = parseChart(['#TOTAL 300', '#BPM 150', '#00111:0101', '#00156:01', '#00116:01'].join('\n'), 'bms');
    const reading = readBeatorajaResult(RESULT, playChart, SKIN);
    expect(reading.input.result).toBe(RESULT);
    expect(reading.input.chartTotal).toBe(300);
    expect(reading.input.breakdown).toMatchObject({ normal: 2, scratch: 1 });
    expect(reading.input.song).toMatchObject({ title: 'Chart', directory: 'song' });
    expect(reading.input.skin).toEqual(SKIN);
    expect(reading.ops).toContain(BEATORAJA_OP.RESULT_FAIL);
    expect(reading.bpmCurve.length).toBeGreaterThan(0);
    expect(reading.timings).toEqual([{ deltaMs: -12, kind: 'PERFECT' }]);
  });

  it('reads nothing of the chart without the chart as played', () => {
    const reading = readBeatorajaResult(RESULT, undefined, SKIN);
    expect(reading.input).not.toHaveProperty('chartTotal');
    expect(reading.input.breakdown).toBeUndefined();
    expect(reading.bpmCurve).toEqual([]);
  });
});
