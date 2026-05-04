import * as playerTuiApi from '@be-music/player-tui';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_LANE_CHANNELS = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
const BENCH_KEY = {
  name: 'z',
  sequence: 'z',
  ctrl: false,
  meta: false,
  shift: false,
};

export function registerPlayerTuiExportsCases(define: DefineBenchmarkCase): void {
  define('player-tui.appendFreeZoneInputChannels', {
    run: () => {
      const bindings = playerTuiApi.createLaneBindings(BENCH_LANE_CHANNELS);
      const inputTokenToChannels = playerTuiApi.createInputTokenToChannelsMap(bindings);
      playerTuiApi.appendFreeZoneInputChannels(inputTokenToChannels, bindings, BENCH_LANE_CHANNELS);
    },
  });
  define('player-tui.beginKittyKeyboardProtocolOptIn', {
    run: () => {
      const stop = playerTuiApi.beginKittyKeyboardProtocolOptIn(createNonTtyWriteStream());
      stop();
    },
  });
  define('player-tui.beginStatefulKeyboardProtocolOptIn', {
    run: () => {
      const stop = playerTuiApi.beginStatefulKeyboardProtocolOptIn(createNonTtyWriteStream(), 'linux', {
        TERM: 'xterm-kitty',
      });
      stop();
    },
  });
  define('player-tui.beginWin32InputModeOptIn', {
    run: () => {
      const stop = playerTuiApi.beginWin32InputModeOptIn(createNonTtyWriteStream());
      stop();
    },
  });
  define('player-tui.BgaAnsiRenderer', {
    run: () => {
      createBenchBgaAnsiRenderer();
    },
  });
  define('player-tui.createBgaAnsiRenderer', {
    run: async (fixtures) => {
      await playerTuiApi.createBgaAnsiRenderer(fixtures.emptyBmsJson, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-tui.createInputTokenToChannelsMap', {
    run: () => {
      playerTuiApi.createInputTokenToChannelsMap(playerTuiApi.createLaneBindings(BENCH_LANE_CHANNELS));
    },
  });
  define('player-tui.createLaneBindings', {
    run: () => {
      playerTuiApi.createLaneBindings(BENCH_LANE_CHANNELS);
    },
  });
  define('player-tui.formatMeasureSignature', {
    run: () => {
      playerTuiApi.formatMeasureSignature(0.75);
    },
  });
  define('player-tui.inspectInputTokenEvent', {
    run: () => {
      playerTuiApi.inspectInputTokenEvent('z', BENCH_KEY);
    },
  });
  define('player-tui.loadStageFileAnsiImage', {
    run: async (fixtures) => {
      await playerTuiApi.loadStageFileAnsiImage(fixtures.emptyBmsJson, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-tui.loadStageFileAnsiLines', {
    run: async (fixtures) => {
      await playerTuiApi.loadStageFileAnsiLines(fixtures.emptyBmsJson, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-tui.loadTerminalAnsiImage', {
    run: async (fixtures) => {
      await playerTuiApi.loadTerminalAnsiImage(fixtures.tmpDir, 'missing.bmp', { width: 8, height: 4 });
    },
  });
  define('player-tui.PlayerTui', {
    run: () => {
      new playerTuiApi.PlayerTui({
        mode: 'AUTO',
        laneDisplayMode: '5 KEY SP',
        title: 'Bench',
        lanes: [],
        speed: 1,
        highSpeed: 1,
        judgeWindowMs: 80,
        stdinIsTTY: false,
        stdoutIsTTY: false,
      });
    },
  });
  define('player-tui.resolveAnimatedHighSpeedValue', {
    run: () => {
      playerTuiApi.resolveAnimatedHighSpeedValue(1, 4, 120, 180);
    },
  });
  define('player-tui.resolveVisibleBeatsForTuiGrid', {
    run: () => {
      playerTuiApi.resolveVisibleBeatsForTuiGrid(24, 2);
    },
  });
  define('player-tui.resolveLaneDisplayMode', {
    run: () => {
      playerTuiApi.resolveLaneDisplayMode(BENCH_LANE_CHANNELS);
    },
  });
  define('player-tui.resolveInputTokenEvent', {
    run: () => {
      playerTuiApi.resolveInputTokenEvent('z', BENCH_KEY);
    },
  });
}

function createNonTtyWriteStream(): NodeJS.WriteStream {
  return {
    isTTY: false,
    write: () => true,
  } as NodeJS.WriteStream;
}

function createBenchBgaAnsiRenderer(): playerTuiApi.BgaAnsiRenderer {
  const frame = {
    width: 1,
    height: 1,
    rgb: new Uint8Array([0, 0, 0]),
    opaqueMask: new Uint8Array([1]),
  };
  return new playerTuiApi.BgaAnsiRenderer({
    baseTimeline: [],
    poorTimeline: [],
    layerTimeline: [],
    layer2Timeline: [],
    baseSourceFramesByKey: new Map(),
    poorSourceFramesByKey: new Map(),
    layerSourceFramesByKey: new Map(),
    layer2SourceFramesByKey: new Map(),
    missingBaseSourceFrame: frame,
    missingPoorSourceFrame: frame,
    missingLayerSourceFrame: frame,
    poorFallbackUntilSeconds: 0,
    playbackEndSeconds: 0,
    width: 1,
    height: 1,
    resizeAlgorithm: 'nearest',
  });
}
