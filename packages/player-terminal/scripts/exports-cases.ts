import * as playerTuiAPI from '@be-music/player-terminal';
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
  define('player-terminal.appendFreeZoneInputChannels', {
    run: () => {
      const bindings = playerTuiAPI.createLaneBindings(BENCH_LANE_CHANNELS);
      const inputTokenToChannels = playerTuiAPI.createInputTokenToChannelsMap(bindings);
      playerTuiAPI.appendFreeZoneInputChannels(inputTokenToChannels, bindings, BENCH_LANE_CHANNELS);
    },
  });
  define('player-terminal.beginKittyKeyboardProtocolOptIn', {
    run: () => {
      const stop = playerTuiAPI.beginKittyKeyboardProtocolOptIn(createNonTTYWriteStream());
      stop();
    },
  });
  define('player-terminal.beginStatefulKeyboardProtocolOptIn', {
    run: () => {
      const stop = playerTuiAPI.beginStatefulKeyboardProtocolOptIn(createNonTTYWriteStream(), 'linux', {
        TERM: 'xterm-kitty',
      });
      stop();
    },
  });
  define('player-terminal.beginWin32InputModeOptIn', {
    run: () => {
      const stop = playerTuiAPI.beginWin32InputModeOptIn(createNonTTYWriteStream());
      stop();
    },
  });
  define('player-terminal.BgaANSIRenderer', {
    run: () => {
      const renderer = createBenchBgaANSIRenderer();
      const frame = {
        definitionId: '61',
        channel: '11',
        bmpKey: '00',
        startedSeconds: 0,
        frameStartSeconds: 0,
        argb: { a: 255, r: 255, g: 255, b: 255 },
      };
      renderer.getANSILines(0, frame);
      renderer.getKittyImage(0, frame);
      renderer.getKittyImage(0.1);
    },
  });
  define('player-terminal.createBgaANSIRenderer', {
    ioBound: true,
    run: async (fixtures) => {
      await playerTuiAPI.createBgaANSIRenderer(fixtures.emptyBmsJSON, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-terminal.createInputTokenToChannelsMap', {
    run: () => {
      playerTuiAPI.createInputTokenToChannelsMap(playerTuiAPI.createLaneBindings(BENCH_LANE_CHANNELS));
    },
  });
  define('player-terminal.createLaneBindings', {
    run: () => {
      playerTuiAPI.createLaneBindings(BENCH_LANE_CHANNELS);
    },
  });
  define('player-terminal.formatMeasureSignature', {
    run: () => {
      playerTuiAPI.formatMeasureSignature(0.75);
    },
  });
  define('player-terminal.formatJudgeComboDisplay', {
    run: () => {
      playerTuiAPI.formatJudgeComboDisplay('GREAT', 123, 1000, false);
      playerTuiAPI.formatJudgeComboDisplay('POOR', 123, 1000, false);
    },
  });
  define('player-terminal.inspectInputTokenEvent', {
    run: () => {
      playerTuiAPI.inspectInputTokenEvent('z', BENCH_KEY);
    },
  });
  define('player-terminal.loadStageFileANSIImage', {
    ioBound: true,
    run: async (fixtures) => {
      await playerTuiAPI.loadStageFileANSIImage(fixtures.emptyBmsJSON, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-terminal.loadStageFileANSILines', {
    ioBound: true,
    run: async (fixtures) => {
      await playerTuiAPI.loadStageFileANSILines(fixtures.emptyBmsJSON, {
        baseDir: fixtures.tmpDir,
        width: 8,
        height: 4,
      });
    },
  });
  define('player-terminal.loadTerminalANSIImage', {
    ioBound: true,
    run: async (fixtures) => {
      await playerTuiAPI.loadTerminalANSIImage(fixtures.tmpDir, 'missing.bmp', { width: 8, height: 4 });
    },
  });
  define('player-terminal.PlayerTUI', {
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
  define('player-terminal.resolveAnimatedHighSpeedValue', {
    run: () => {
      playerTuiAPI.resolveAnimatedHighSpeedValue(1, 4, 120, 180);
    },
  });
  define('player-terminal.resolveVisibleBeatsForTUIGrid', {
    run: () => {
      playerTuiAPI.resolveVisibleBeatsForTUIGrid(24, 2);
    },
  });
  define('player-terminal.resolveLaneDisplayMode', {
    run: () => {
      playerTuiAPI.resolveLaneDisplayMode(BENCH_LANE_CHANNELS);
    },
  });
  define('player-terminal.resolveInputTokenEvent', {
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
    layer2SourceFramesByKey: new Map([[String.fromCharCode(0) + 'swbga:61:00', { kind: 'static', frame }]]),
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
