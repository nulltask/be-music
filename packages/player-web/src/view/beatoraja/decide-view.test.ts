import { BEATORAJA_OP, TIMER_FADEOUT, TIMER_STARTINPUT, type BeatorajaSkin } from '@be-music/beatoraja-skin';
import { createEmptyJson } from '@be-music/json';
import { DEFAULT_PLAY_OPTIONS, type LibraryChart } from '@be-music/scene-model';
import type { Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { BeatorajaPlaySkinView } from '../../scene/beatoraja/skin-view.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { BeatorajaRenderContext } from '../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type { DecideFrame } from '../types.ts';
import { BeatorajaDecideView } from './decide-view.ts';

const chart = createEmptyJson('bms');
chart.metadata.difficulty = 3;

const CHART: LibraryChart = {
  id: 'chart',
  sourceId: 'source',
  sourceLabel: 'Source',
  sourceKind: 'directory',
  chartPath: 'song/chart.bms',
  directoryLabel: 'song',
  fileLabel: 'chart.bms',
  title: 'Chart',
  totalNotes: 0,
  chart,
};

const HOST = {
  app: { screen: { width: 1280, height: 720 } },
} as unknown as PixiSceneHost;

function createView(skinSounds?: { play: () => boolean; loop: () => boolean; stop: () => boolean }) {
  const skin: BeatorajaSkin = { type: 6, w: 1280, h: 720, image: [], destination: [] };
  const empty = new Map<number | string, Texture>();
  const textures: BeatorajaTextureCache = {
    get: (id) => empty.get(id),
    values: () => empty.values(),
    pathOf: () => undefined,
  };
  return new BeatorajaDecideView(
    { family: 'beatoraja', kit: { skin, textures, files: new Map(), skinConfig: { option: { 900: 901 } } } },
    { chart: CHART, ...(skinSounds !== undefined ? { skinSounds } : {}) },
  );
}

function frame(overrides: Partial<DecideFrame> = {}): DecideFrame {
  return {
    clock: { nowMs: 1250, enteredAtMs: 1000 },
    chart: CHART,
    playChart: chart,
    playOptions: DEFAULT_PLAY_OPTIONS,
    inputOpenAtMs: 1500,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BeatorajaDecideView', () => {
  it("draws the chart's difficulty, the loading state and the skin's options on the screen's own clock", async () => {
    const update = vi.spyOn(BeatorajaPlaySkinView.prototype, 'update').mockImplementation(() => undefined);
    const view = createView();
    await view.attach(HOST);
    view.draw(frame({ progress: 0.5 }));
    const context = update.mock.calls[0]![0] as BeatorajaRenderContext;
    expect(context.nowMs).toBe(250);
    expect([...context.activeOps]).toEqual(
      expect.arrayContaining([901, BEATORAJA_OP.LEVEL_HYPER, BEATORAJA_OP.DIFFICULTY_HYPER, BEATORAJA_OP.NOW_LOADING]),
    );
    expect(context.getTimerStart(TIMER_STARTINPUT)).toBe(500);
    expect(context.getTimerStart(TIMER_FADEOUT)).toBeUndefined();
    view.draw(frame({ clock: { nowMs: 1600, enteredAtMs: 1000 }, leaving: { to: 'play', atMs: 1550 } }));
    const leaving = update.mock.calls[1]![0] as BeatorajaRenderContext;
    // Without the host's progress or an auto advance the play is ready.
    expect(leaving.activeOps.has(BEATORAJA_OP.LOADED)).toBe(true);
    expect(leaving.activeOps.has(BEATORAJA_OP.NOW_LOADING)).toBe(false);
    expect(leaving.getTimerStart(TIMER_FADEOUT)).toBe(550);
    view.dispose();
  });

  it("hands the skin's Lua sounds to the sound sink it was given", async () => {
    const update = vi.spyOn(BeatorajaPlaySkinView.prototype, 'update').mockImplementation(() => undefined);
    const skinSounds = { play: vi.fn(() => true), loop: vi.fn(() => true), stop: vi.fn(() => true) };
    const view = createView(skinSounds);
    await view.attach(HOST);
    view.draw(frame());
    const context = update.mock.calls[0]![0] as BeatorajaRenderContext;
    context.audioPlay?.('se/open.wav', 0.5);
    context.audioLoop?.('se/loop.wav', 1);
    context.audioStop?.('se/loop.wav');
    expect(skinSounds.play).toHaveBeenCalledWith('se/open.wav', 0.5);
    expect(skinSounds.loop).toHaveBeenCalledWith('se/loop.wav', 1);
    expect(skinSounds.stop).toHaveBeenCalledWith('se/loop.wav');
    view.dispose();
  });

  it('draws nothing while detached or once disposed', async () => {
    const update = vi.spyOn(BeatorajaPlaySkinView.prototype, 'update').mockImplementation(() => undefined);
    const view = createView();
    view.draw(frame());
    await view.attach(HOST);
    view.detach();
    view.draw(frame());
    view.dispose();
    await view.attach(HOST);
    view.draw(frame());
    expect(update).not.toHaveBeenCalled();
  });
});
