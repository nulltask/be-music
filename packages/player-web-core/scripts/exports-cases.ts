import * as playerWebCoreApi from '@be-music/player-web-core';
import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_BYTES = new Uint8Array([35, 84, 73, 84, 76, 69, 32, 66, 101, 110, 99, 104, 10]);
const BENCH_BMS_FILE = makeBenchFile('Songs/Bench/main.bms', '#TITLE Bench\n#BPM 130\n#00111:0100\n');
const BENCH_WAV_FILE = makeBenchFile('Songs/Bench/kick.wav', 'RIFF');
const BENCH_LR2_SKIN_FILE = makeBenchFile('LR2files/Theme/LR2/Play/play_7.lr2skin', '#INFORMATION,bench\n');
const BENCH_SELECT_BGM_FILE = makeBenchFile('LR2files/Bgm/LR2/select.wav', 'RIFF');
const BENCH_SYSTEM_SOUND_FILE = makeBenchFile('LR2files/Sound/lr2/scratch.wav', 'RIFF');
const BENCH_SOURCE = makeBenchSource();
const BENCH_SONG = makeBenchSong();
const BENCH_COLLECTION = {
  sources: [BENCH_SOURCE],
  songs: [BENCH_SONG],
  errors: [],
} satisfies playerWebCoreApi.BrowserSongCollection;
const BENCH_SCORE = {
  total: 100,
  perfect: 60,
  great: 30,
  good: 5,
  bad: 3,
  poor: 2,
  exScore: 150,
  score: 75_000,
};

export function registerPlayerWebCoreExportsCases(define: DefineBenchmarkCase): void {
  define('player-web-core.asLoadedBytes', {
    run: () => {
      playerWebCoreApi.asLoadedBytes(BENCH_BYTES);
    },
  });
  define('player-web-core.basename', {
    run: () => {
      playerWebCoreApi.basename('Songs/Bench/main.bms');
    },
  });
  define('player-web-core.buildAudioBus', {
    run: () => {
      const bus = playerWebCoreApi.buildAudioBus(createFakeAudioContext(), 'split');
      bus.setStageEnabled('master', false);
      bus.setMode('legacy');
      bus.dispose();
    },
  });
  define('player-web-core.BrowserSongLibrary', {
    run: () => {
      new playerWebCoreApi.BrowserSongLibrary();
    },
  });
  define('player-web-core.ChartPreviewEngine', {
    run: () => {
      const node = createFakeAudioNode();
      const engine = new playerWebCoreApi.ChartPreviewEngine(createFakeAudioContext(), node, { focusDelayMs: 1 });
      engine.stop();
      engine.dispose();
    },
  });
  define('player-web-core.collectChartPreviewTriggers', {
    run: (fixtures) => {
      playerWebCoreApi.collectChartPreviewTriggers(fixtures.sampleBmsJson, 3);
    },
  });
  define('player-web-core.computeResultOps', {
    run: () => {
      playerWebCoreApi.computeResultOps(makeResultData(), makeLr2Skin());
    },
  });
  define('player-web-core.describeSongCollection', {
    run: () => {
      playerWebCoreApi.describeSongCollection(BENCH_COLLECTION);
    },
  });
  define('player-web-core.dirname', {
    run: () => {
      playerWebCoreApi.dirname('Songs/Bench/main.bms');
    },
  });
  define('player-web-core.downloadBlob', {
    run: () => {
      playerWebCoreApi.downloadBlob(new Blob([BENCH_BYTES]), 'bench.webm');
    },
    interactive: true,
  });
  define('player-web-core.findFirstAudibleOffsetSeconds', {
    run: () => {
      playerWebCoreApi.findFirstAudibleOffsetSeconds(makeAudioBufferLike());
    },
  });
  define('player-web-core.GameplayRecorder', {
    run: () => {
      const recorder = new playerWebCoreApi.GameplayRecorder({
        canvas: { captureStream: () => ({ getVideoTracks: () => [] }) } as unknown as HTMLCanvasElement,
        audioContext: {
          createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [] } }),
        } as unknown as AudioContext,
        audioOutput: createFakeAudioNode(),
      });
      recorder.isActive();
      recorder.dispose();
    },
  });
  define('player-web-core.groupSongsByFolder', {
    run: () => {
      playerWebCoreApi.groupSongsByFolder([BENCH_SONG]);
    },
  });
  define('player-web-core.isChartFilePath', {
    run: () => {
      playerWebCoreApi.isChartFilePath('Songs/Bench/main.bms');
    },
  });
  define('player-web-core.isLr2SpecialGraphic', {
    run: () => {
      playerWebCoreApi.isLr2SpecialGraphic('playbg');
    },
  });
  define('player-web-core.loadAssetBytes', {
    run: async () => {
      await playerWebCoreApi.loadAssetBytes(BENCH_BYTES);
    },
  });
  define('player-web-core.loadLr2SkinFromFiles', {
    run: async () => {
      await playerWebCoreApi.loadLr2SkinFromFiles([BENCH_LR2_SKIN_FILE]);
    },
  });
  define('player-web-core.loadLr2SkinFromSourceFiles', {
    run: () => {
      playerWebCoreApi.loadLr2SkinFromSourceFiles(new Map([['LR2files/Theme/LR2/Play/play_7.lr2skin', BENCH_BYTES]]));
    },
  });
  define('player-web-core.loadLr2SystemSound', {
    run: async () => {
      await playerWebCoreApi.loadLr2SystemSound([BENCH_SYSTEM_SOUND_FILE], 'scratch');
    },
  });
  define('player-web-core.loadLr2ThemeBgm', {
    run: async () => {
      await playerWebCoreApi.loadLr2ThemeBgm([BENCH_SELECT_BGM_FILE], 'select');
    },
  });
  define('player-web-core.loadLr2ThemeSkinsFromFiles', {
    run: async () => {
      await playerWebCoreApi.loadLr2ThemeSkinsFromFiles([BENCH_LR2_SKIN_FILE]);
    },
  });
  define('player-web-core.loadSongCollectionFromDrop', {
    run: async () => {
      await playerWebCoreApi.loadSongCollectionFromDrop({
        files: [BENCH_BMS_FILE, BENCH_WAV_FILE],
      } as unknown as DataTransfer);
    },
  });
  define('player-web-core.loadSongCollectionFromFiles', {
    run: async () => {
      await playerWebCoreApi.loadSongCollectionFromFiles([BENCH_BMS_FILE, BENCH_WAV_FILE]);
    },
  });
  define('player-web-core.makeWebmSeekable', {
    run: async () => {
      await playerWebCoreApi.makeWebmSeekable(new Blob([BENCH_BYTES]));
    },
    interactive: true,
  });
  define('player-web-core.matchesSearchQuery', {
    run: () => {
      playerWebCoreApi.matchesSearchQuery({ kind: 'song', song: BENCH_SONG }, 'bench');
    },
  });
  define('player-web-core.normalizePath', {
    run: () => {
      playerWebCoreApi.normalizePath(String.raw`Songs\\Bench/../Bench/main.bms`);
    },
  });
  define('player-web-core.parseCompressorMode', {
    run: () => {
      playerWebCoreApi.parseCompressorMode('split');
    },
  });
  define('player-web-core.pickLr2PlaySkin', {
    run: () => {
      playerWebCoreApi.pickLr2PlaySkin({ '7': makeLr2Skin() }, BENCH_SONG);
    },
  });
  define('player-web-core.pickLr2SystemSoundFile', {
    run: () => {
      playerWebCoreApi.pickLr2SystemSoundFile([BENCH_SYSTEM_SOUND_FILE], 'scratch');
    },
  });
  define('player-web-core.pickLr2ThemeBgmFile', {
    run: () => {
      playerWebCoreApi.pickLr2ThemeBgmFile([BENCH_SELECT_BGM_FILE], 'select');
    },
  });
  define('player-web-core.pickRecorderMimeType', {
    run: () => {
      playerWebCoreApi.pickRecorderMimeType((type) => type === 'video/webm');
    },
  });
  define('player-web-core.PixiDecideView', {
    run: () => {
      new playerWebCoreApi.PixiDecideView();
    },
    interactive: true,
  });
  define('player-web-core.PixiGameplayView', {
    run: () => {
      new playerWebCoreApi.PixiGameplayView();
    },
    interactive: true,
  });
  define('player-web-core.PixiResultView', {
    run: () => {
      new playerWebCoreApi.PixiResultView();
    },
    interactive: true,
  });
  define('player-web-core.PixiSceneHost', {
    run: () => {
      new playerWebCoreApi.PixiSceneHost();
    },
    interactive: true,
  });
  define('player-web-core.PixiSongSelectView', {
    run: () => {
      new playerWebCoreApi.PixiSongSelectView();
    },
    interactive: true,
  });
  define('player-web-core.readDroppedFiles', {
    run: async () => {
      await playerWebCoreApi.readDroppedFiles({ files: [BENCH_BMS_FILE] } as unknown as DataTransfer);
    },
  });
  define('player-web-core.readFilesIntoBytesMap', {
    run: async () => {
      await playerWebCoreApi.readFilesIntoBytesMap([BENCH_BMS_FILE], { deferAudio: false });
    },
  });
  define('player-web-core.resolveChartAsset', {
    run: () => {
      playerWebCoreApi.resolveChartAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'kick.wav');
    },
  });
  define('player-web-core.resolveChartAudioAsset', {
    run: () => {
      playerWebCoreApi.resolveChartAudioAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'kick.wav');
    },
  });
  define('player-web-core.resolveChartImageAsset', {
    run: () => {
      playerWebCoreApi.resolveChartImageAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'banner.bmp');
    },
  });
  define('player-web-core.resolveChartPlayVariant', {
    run: () => {
      playerWebCoreApi.resolveChartPlayVariant(BENCH_SONG);
    },
  });
  define('player-web-core.resolveChartPreviewPath', {
    run: (fixtures) => {
      playerWebCoreApi.resolveChartPreviewPath(fixtures.sampleBmsJson);
    },
  });
  define('player-web-core.resolveDropFilePath', {
    run: () => {
      playerWebCoreApi.resolveDropFilePath(BENCH_BMS_FILE);
    },
  });
  define('player-web-core.resolveLr2AssetBytes', {
    run: () => {
      playerWebCoreApi.resolveLr2AssetBytes(makeLr2Skin(), 'parts.tga');
    },
  });
  define('player-web-core.resolveRendererPreference', {
    run: () => {
      playerWebCoreApi.resolveRendererPreference('?renderer=webgl');
    },
  });
  define('player-web-core.resolveSongSource', {
    run: () => {
      playerWebCoreApi.resolveSongSource(BENCH_COLLECTION, BENCH_SONG);
    },
  });
  define('player-web-core.splitDroppedSongAndThemeFiles', {
    run: () => {
      playerWebCoreApi.splitDroppedSongAndThemeFiles([
        { name: 'main.bms', webkitRelativePath: 'Songs/Example/main.bms' },
        { name: 'kick.wav', webkitRelativePath: 'Songs/Example/kick.wav' },
        { name: 'play_7.lr2skin', webkitRelativePath: 'Theme/play_7.lr2skin' },
      ]);
    },
  });
  define('player-web-core.summarizeLr2PlaySkins', {
    run: () => {
      playerWebCoreApi.summarizeLr2PlaySkins({ '7': { name: 'play_7' } as playerWebCoreApi.Lr2Skin });
    },
  });
  define('player-web-core.wrappedCursorDelta', {
    run: () => {
      playerWebCoreApi.wrappedCursorDelta(-9, 10);
    },
  });
}

function makeBenchFile(path: string, body: string | Uint8Array): File {
  const name = path.split('/').at(-1) ?? path;
  const file = new File([body], name);
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    enumerable: true,
    value: path,
  });
  return file;
}

function makeBenchSource(): playerWebCoreApi.BrowserSongAssetSource {
  return {
    id: 'files:bench',
    kind: 'directory',
    label: 'Bench',
    files: new Map([
      ['Songs/Bench/main.bms', BENCH_BYTES],
      ['Songs/Bench/kick.wav', BENCH_BYTES],
      ['Songs/Bench/banner.png', BENCH_BYTES],
    ]),
  };
}

function makeBenchSong(): playerWebCoreApi.BrowserSongEntry {
  const chart: BeMusicJson = createEmptyJson('bms');
  chart.metadata.title = 'Bench Song';
  chart.events = [
    { measure: 0, position: [0, 1], channel: '11', value: '01' },
    { measure: 0, position: [0, 1], channel: '18', value: '01' },
  ];
  chart.resources.wav = { '01': 'kick.wav' };
  chart.resources.bmp = { '01': 'banner.bmp' };
  return {
    id: 'files:bench:Songs/Bench/main.bms',
    sourceId: 'files:bench',
    sourceLabel: 'Bench',
    sourceKind: 'directory',
    chartPath: 'Songs/Bench/main.bms',
    directoryLabel: 'Songs/Bench',
    fileLabel: 'main.bms',
    title: 'Bench Song',
    totalNotes: 2,
    chart,
  };
}

function makeLr2Skin(): playerWebCoreApi.Lr2Skin {
  return {
    name: 'bench',
    scratchFlip: { flipResult: false, flipSide: false, disableFlip: false, reloadBanner: false },
    files: new Map([['parts.tga', BENCH_BYTES]]),
  } as playerWebCoreApi.Lr2Skin;
}

function makeResultData(): playerWebCoreApi.PixiGameplayResultData {
  return {
    cleared: true,
    score: BENCH_SCORE,
    maxCombo: 90,
    gauge: 80,
    playSeconds: 120,
    song: BENCH_SONG,
    gaugeHistory: [],
    scoreHistory: [],
  };
}

function makeAudioBufferLike(): AudioBuffer {
  const left = new Float32Array(128);
  left[32] = 0.5;
  return {
    numberOfChannels: 1,
    sampleRate: 1000,
    length: left.length,
    getChannelData: () => left,
  } as AudioBuffer;
}

interface FakeAudioParam {
  value: number;
}

interface FakeAudioNode {
  gain?: FakeAudioParam;
  threshold?: FakeAudioParam;
  ratio?: FakeAudioParam;
  attack?: FakeAudioParam;
  release?: FakeAudioParam;
  knee?: FakeAudioParam;
  connect(target: unknown): void;
  disconnect(): void;
}

function createFakeAudioNode(kind: 'gain' | 'compressor' | 'destination' = 'gain'): AudioNode {
  const node: FakeAudioNode = {
    connect: () => {},
    disconnect: () => {},
  };
  if (kind === 'gain') node.gain = { value: 1 };
  if (kind === 'compressor') {
    node.threshold = { value: 0 };
    node.ratio = { value: 1 };
    node.attack = { value: 0 };
    node.release = { value: 0 };
    node.knee = { value: 0 };
  }
  return node as AudioNode;
}

function createFakeAudioContext(): AudioContext {
  return {
    destination: createFakeAudioNode('destination'),
    createGain: () => createFakeAudioNode('gain'),
    createDynamicsCompressor: () => createFakeAudioNode('compressor') as DynamicsCompressorNode,
  } as AudioContext;
}
