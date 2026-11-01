import { Container } from 'pixi.js';
import { expect, test, vi } from 'vite-plus/test';
import {
  renderBuiltInChrome,
  resolveSkinlessGameplayChromeRuntime,
  type BuiltInChromeContext,
  type PlayChromeContext,
  type SkinlessGameplayChromeRuntime,
} from './play-chrome.ts';

function chromeContext(playFrame?: PlayChromeContext['playFrame']): PlayChromeContext {
  const play = {
    score: { total: 100, score: 0, exScore: 0, perfect: 0, great: 0, good: 0, bad: 0, poor: 0 },
    playState: { view: { hiSpeed: { player: 2 } }, combo: 0, maxCombo: 0, judgeTimings: [] },
    currentSeconds: () => 0,
    resolveChartDurationSeconds: () => 60,
    chartPlayVariant: '7',
    laneChannels: ['11'],
    judgeSideState: { '1P': { until: -1 } },
    currentBeat: () => 0,
    nowBPM: () => 150,
    displayBPM: () => 150,
    resolveLaneCovers: () => [],
    resolveVisibleMs: () => undefined,
    gaugeState: { current: 20, clearThreshold: 80, type: 'GROOVE' },
    lastJudgeUntil: -1,
    playClock: () => 0,
    resolveJudgeRuleset: () => 'lr2',
    resolveChartMs: () => 0,
    playMoments: {},
    tempo: 1.25,
  };
  return {
    play,
    options: {},
    audioFrame: undefined,
    ...(playFrame !== undefined ? { playFrame } : {}),
  } as unknown as PlayChromeContext;
}

test('hands the frame’s best record, course, player and lane option to the skin', () => {
  const course = { kind: 'grade', title: 'Dan', stages: [{ title: 'a' }], stageIndex: 0 } as const;
  const runtime = resolveSkinlessGameplayChromeRuntime(
    chromeContext({
      scoreTargets: { bestEXScore: 120 },
      course,
      playerName: 'Taro',
      playOptions: { random1P: 'MIRROR' } as never,
    }),
  );
  expect(runtime).toMatchObject({ bestEXScore: 120, course, playerName: 'Taro', random1P: 'MIRROR', tempo: 1.25 });
  expect(runtime.targetEXScore).toBeUndefined();
});

test('leaves out a best record of zero and what a frame does not carry', () => {
  const runtime = resolveSkinlessGameplayChromeRuntime(
    chromeContext({ scoreTargets: { bestEXScore: 0 }, playOptions: { random1P: 'OFF' } as never }),
  );
  expect(runtime.bestEXScore).toBeUndefined();
  expect(runtime.course).toBeUndefined();
  expect(runtime.playerName).toBeUndefined();
  expect(resolveSkinlessGameplayChromeRuntime(chromeContext()).random1P).toBeUndefined();
});

test('forwards a draw-local runtime without resolving or mutating it again', () => {
  const pool = () => ({ begin: vi.fn(), end: vi.fn() });
  const ctx = {
    skinLayer: new Container(),
    overlayLayer: new Container(),
    bgaLayer: new Container(),
    skinLayerPool: pool(),
    overlayLayerPool: pool(),
    get play() {
      throw new Error('must use the supplied snapshot');
    },
  } as unknown as BuiltInChromeContext;
  const first = Object.freeze({ score: 10, judgeSides: Object.freeze([]) }) as unknown as SkinlessGameplayChromeRuntime;
  const next = Object.freeze({ score: 20, judgeSides: Object.freeze([]) }) as unknown as SkinlessGameplayChromeRuntime;
  const retained: SkinlessGameplayChromeRuntime[] = [];
  renderBuiltInChrome(ctx, ({ runtime }) => retained.push(runtime), first);
  renderBuiltInChrome(ctx, ({ runtime }) => retained.push(runtime), next);
  expect(retained).toEqual([first, next]);
  expect(retained[0]).toBe(first);
  expect(retained[0]!.score).toBe(10);
  expect(ctx.skinLayerPool.begin).toHaveBeenCalledTimes(2);
  expect(ctx.skinLayerPool.end).toHaveBeenCalledTimes(2);
  expect(ctx.overlayLayerPool.end).toHaveBeenCalledTimes(2);
  ctx.skinLayer.destroy();
  ctx.overlayLayer.destroy();
  ctx.bgaLayer.destroy();
});
