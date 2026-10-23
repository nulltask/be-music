import * as ui from '@be-music/player-ui';
import * as react from '@be-music/player-ui-react';
import * as vue from '@be-music/player-ui-vue';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

// Registration is normally repeated by wrappers. Measure the idempotent path without allocating a browser.
const definitions = new Map<string, CustomElementConstructor>();
const registry = {
  get: (name: string) => definitions.get(name),
  define: (name: string, constructor: CustomElementConstructor) => definitions.set(name, constructor),
} as unknown as CustomElementRegistry;
// A double-play frame with a screen's worth of notes, the busiest playfield a frame hands over.
const lanes = Array.from({ length: 16 }, (_, index) => ({
  channel: `${index < 8 ? 1 : 2}${(index % 8) + 1}`,
  kind: 'white' as const,
  x: 20 + index * 30 + (index < 8 ? 0 : 60),
  w: 30,
  top: 8,
  bottom: 464,
  beam: index % 3 === 0 ? 0.5 : 0,
}));
const playfieldFrame: Parameters<typeof ui.resolvePlayfieldParts>[0] = {
  layout: {
    stage: { width: 854, height: 480 },
    lanes: lanes.map((lane, index) => ({ ...lane, side: index < 8 ? ('1P' as const) : ('2P' as const) })),
    playfield: {
      left: 20,
      right: 560,
      centerX: 290,
      top: 8,
      judgementY: 464,
      sides: { '1P': { left: 20, right: 260 }, '2P': { left: 320, right: 560 } },
    },
    bga: undefined,
  },
  lanes,
  notes: Array.from({ length: 200 }, (_, index) => ({ ...lanes[index % 16]!, y: (index * 37) % 456 })),
  longNotes: [],
  mines: [],
  measureLines: [],
  bombs: lanes.map((lane, index) => ({ ...lane, y: 464, elapsedMs: index * 10, seed: index })),
  bga: undefined,
  nowMs: 0,
  runtime: {
    judgeSides: [{ side: '1P', judge: 'PERFECT' }],
    laneCovers: [{ side: '1P', sudden: 0.2, hidden: 0, lift: 0 }],
  },
};
const playfieldParts = ui.resolvePlayfieldParts(playfieldFrame);
const gameplayFrame = {
  layout: { ...playfieldFrame.layout },
  settings: {},
  effects: 'full',
  chart: undefined,
  state: {
    totalSeconds: 120,
    gauge: 80,
    cleared: false,
    exScore: 420,
    combo: 96,
    maxCombo: 140,
    gaugeHistory: [],
    scoreHistory: [],
    judgeTimings: [],
    earlyLate: {},
    view: {},
  },
  runtime: { totalNotes: 400, perfect: 180, great: 60, good: 4, bad: 1, poor: 2, fast: 20, slow: 30 },
  playOptions: {},
  emptyPoor: 1,
  seconds: 64,
  bpm: 150,
  progress: undefined,
  stage: 'playing',
  autoPlay: true,
  replay: false,
  seekable: true,
} as unknown as Parameters<typeof ui.resolveGameplayPanels>[0];
const noopContext = new Proxy({}, { get: () => () => {}, set: () => true }) as ui.BeMusicPlayfieldPaintContext;
const NON_ELEMENT_EXPORTS = new Set([
  'defineBeMusicElements',
  'resolvePlayfieldParts',
  'paintPlayfieldParts',
  'formatPlaybackTime',
  'resolveSeekTarget',
  'resolveGameplayPanels',
  'previewContentBottom',
  'resolvePreviewBGARect',
  'resolvePreviewInfoBox',
  'resolvePreviewPortrait',
]);
export const playerUIBenchmarkPackage: BenchmarkPackageDefinition = {
  module: ui,
  registerCases(define) {
    define('player-ui.defineBeMusicElements', { run: () => ui.defineBeMusicElements(registry) });
    define('player-ui.resolvePlayfieldParts', {
      run: () => {
        ui.resolvePlayfieldParts(playfieldFrame);
      },
    });
    define('player-ui.paintPlayfieldParts', { run: () => ui.paintPlayfieldParts(noopContext, playfieldParts) });
    define('player-ui.formatPlaybackTime', {
      run: () => {
        ui.formatPlaybackTime(3725.4);
      },
    });
    define('player-ui.resolveSeekTarget', {
      run: () => {
        ui.resolveSeekTarget(118, 5, 120);
      },
    });
    define('player-ui.resolveGameplayPanels', {
      run: () => {
        ui.resolveGameplayPanels(gameplayFrame);
      },
    });
    const previewStage = { width: 854, height: 480 };
    define('player-ui.previewContentBottom', {
      run: () => {
        ui.previewContentBottom(previewStage.height);
      },
    });
    define('player-ui.resolvePreviewBGARect', {
      run: () => {
        ui.resolvePreviewBGARect(previewStage, 184);
      },
    });
    define('player-ui.resolvePreviewPortrait', {
      run: () => {
        ui.resolvePreviewPortrait({ width: 480, height: 854 });
      },
    });
    const previewBGA = ui.resolvePreviewBGARect(previewStage, 184);
    define('player-ui.resolvePreviewInfoBox', {
      run: () => {
        ui.resolvePreviewInfoBox({ stage: previewStage, bga: previewBGA, playfield: { right: 184 } });
      },
    });
    for (const [name, value] of Object.entries(ui)) {
      if (NON_ELEMENT_EXPORTS.has(name) || typeof value !== 'function') continue;
      define(`player-ui.${name}`, {
        interactive: true,
        run: () => {
          ui.defineBeMusicElements();
          const element = new (value as CustomElementConstructor)();
          document.body.append(element);
          element.remove();
        },
      });
    }
  },
};
// React forwardRef components and Vue definitions are objects; the function-export inventory has no callable cases.
export const playerUIReactBenchmarkPackage: BenchmarkPackageDefinition = { module: react, registerCases: () => {} };
export const playerUIVueBenchmarkPackage: BenchmarkPackageDefinition = { module: vue, registerCases: () => {} };
