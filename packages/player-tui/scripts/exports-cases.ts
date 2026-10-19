import * as playerTuiAPI from '@be-music/player-tui';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_LANE_CHANNELS = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
const BENCH_KEY = {
  name: 'z',
  sequence: 'z',
  ctrl: false,
  meta: false,
  shift: false,
};

export function registerPlayerTUIExportsCases(define: DefineBenchmarkCase): void {
  define('player-tui.appendFreeZoneInputChannels', {
    run: () => {
      const bindings = playerTuiAPI.createLaneBindings(BENCH_LANE_CHANNELS);
      const inputTokenToChannels = playerTuiAPI.createInputTokenToChannelsMap(bindings);
      playerTuiAPI.appendFreeZoneInputChannels(inputTokenToChannels, bindings, BENCH_LANE_CHANNELS);
    },
  });
  define('player-tui.beginKittyKeyboardProtocolOptIn', {
    run: () => {
      const stop = playerTuiAPI.beginKittyKeyboardProtocolOptIn(createNonTTYWriteStream());
      stop();
    },
  });
  define('player-tui.beginStatefulKeyboardProtocolOptIn', {
    run: () => {
      const stop = playerTuiAPI.beginStatefulKeyboardProtocolOptIn(createNonTTYWriteStream(), 'linux', {
        TERM: 'xterm-kitty',
      });
      stop();
    },
  });
  define('player-tui.beginWin32InputModeOptIn', {
    run: () => {
      const stop = playerTuiAPI.beginWin32InputModeOptIn(createNonTTYWriteStream());
      stop();
    },
  });
  define('player-tui.BgaANSIRenderer', {
    run: () => {
      createBenchBgaANSIRenderer();
    },
  });
  define('player-tui.createBgaANSIRenderer', {
    ioBound: true,
    run: async (fixtures) => {
      await playerTuiAPI.createBgaANSIRenderer(fixtures.emptyBmsJSON, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-tui.createInputTokenToChannelsMap', {
    run: () => {
      playerTuiAPI.createInputTokenToChannelsMap(playerTuiAPI.createLaneBindings(BENCH_LANE_CHANNELS));
    },
  });
  define('player-tui.createLaneBindings', {
    run: () => {
      playerTuiAPI.createLaneBindings(BENCH_LANE_CHANNELS);
    },
  });
  define('player-tui.formatMeasureSignature', {
    run: () => {
      playerTuiAPI.formatMeasureSignature(0.75);
    },
  });
  define('player-tui.formatJudgeComboDisplay', {
    run: () => {
      playerTuiAPI.formatJudgeComboDisplay('GREAT', 123, 1000, false);
      playerTuiAPI.formatJudgeComboDisplay('POOR', 123, 1000, false);
    },
  });
  define('player-tui.inspectInputTokenEvent', {
    run: () => {
      playerTuiAPI.inspectInputTokenEvent('z', BENCH_KEY);
    },
  });
  define('player-tui.loadStageFileANSIImage', {
    ioBound: true,
    run: async (fixtures) => {
      await playerTuiAPI.loadStageFileANSIImage(fixtures.emptyBmsJSON, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-tui.loadStageFileANSILines', {
    ioBound: true,
    run: async (fixtures) => {
      await playerTuiAPI.loadStageFileANSILines(fixtures.emptyBmsJSON, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-tui.loadTerminalANSIImage', {
    ioBound: true,
    run: async (fixtures) => {
      await playerTuiAPI.loadTerminalANSIImage(fixtures.tmpDir, 'missing.bmp', { width: 8, height: 4 });
    },
  });
  define('player-tui.PlayerTUI', {
    run: () => {
      new playerTuiAPI.PlayerTUI({
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
      playerTuiAPI.resolveAnimatedHighSpeedValue(1, 4, 120, 180);
    },
  });
  define('player-tui.resolveVisibleBeatsForTUIGrid', {
    run: () => {
      playerTuiAPI.resolveVisibleBeatsForTUIGrid(24, 2);
    },
  });
  define('player-tui.resolveLaneDisplayMode', {
    run: () => {
      playerTuiAPI.resolveLaneDisplayMode(BENCH_LANE_CHANNELS);
    },
  });
  define('player-tui.resolveInputTokenEvent', {
    run: () => {
      playerTuiAPI.resolveInputTokenEvent('z', BENCH_KEY);
    },
  });
}

function createNonTTYWriteStream(): NodeJS.WriteStream {
  return {
    isTTY: false,
    write: () => true,
  } as unknown as NodeJS.WriteStream;
}

function createBenchBgaANSIRenderer(): playerTuiAPI.BgaANSIRenderer {
  const frame = {
    width: 1,
    height: 1,
    rgb: new Uint8Array([0, 0, 0]),
    opaqueMask: new Uint8Array([1]),
  };
  return new playerTuiAPI.BgaANSIRenderer({
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
