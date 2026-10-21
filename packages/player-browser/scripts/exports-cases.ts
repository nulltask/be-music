import * as playerWebCoreAPI from '@be-music/player-browser';
import type {
  BeatorajaDestinationGroup,
  BeatorajaPlaySkinMap,
  BeatorajaSkin,
  BeatorajaSkinEntry,
  BeatorajaSkinFileEntry,
  BeatorajaSkinHeader,
  BeatorajaSourceBundle,
} from '@be-music/skin-beatoraja';
import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import type { LR2Skin } from '@be-music/skin-lr2';
import { parseBeatorajaCourseData, parseBeatorajaRandomCourseData } from '@be-music/player-engine/course';
import type { LibraryChart, PlayResult } from '@be-music/player-scene-model';
import { Container } from 'pixi.js';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

/** Minimal stand-in for an `AudioContext` (Node has none) — enough for `masterOutput` to create and wire its gain. */
const BENCH_AUDIO_CONTEXT = {
  state: 'running',
  destination: {},
  createGain: () => ({ gain: { value: 1 }, connect: () => undefined }),
  addEventListener: () => undefined,
} as unknown as BaseAudioContext;

/** One stand-in system context shared by every run, so `masterOutput` keeps one gain for it. */
const BENCH_SYSTEM_AUDIO_CONTEXT = createFakeSystemAudioContext();
const BENCH_AUDIO_OWNER = {};

/** Stand-in for `navigator` with an audio session (Node has none), so the session helpers take their applying path. */
const BENCH_AUDIO_SESSION_HOST: playerWebCoreAPI.SystemAudioSessionHost = { audioSession: { type: 'auto' } };

/** A host whose ticker only records callbacks, and a session and view that do nothing, for `SessionScene`. */
const BENCH_SCENE_HOST = {
  app: { ticker: { add: () => undefined, remove: () => undefined } },
} as unknown as playerWebCoreAPI.PixiSceneHost;
/** A host a family view can draw on: the ticker, a canvas for its pointer listeners, the screen and the renderer. */
const BENCH_VIEW_HOST = {
  app: {
    ticker: { add: () => undefined, remove: () => undefined },
    canvas: { addEventListener: () => undefined, removeEventListener: () => undefined },
    screen: { width: 1280, height: 720 },
    renderer: { resolution: 1 },
  },
  setStageOrientation: () => undefined,
} as unknown as playerWebCoreAPI.PixiSceneHost;
/** An LR2 decide skin with nothing to draw, for the LR2 decide scene. */
const BENCH_LR2_DECIDE_SKIN = {
  width: 640,
  height: 480,
  timing: { startInput: 300 },
  images: [],
  numbers: [],
  texts: [],
  lr2FontPaths: [],
  systemFontSizes: [],
  files: new Map(),
} as unknown as LR2Skin;
/** An LR2 result skin with nothing to draw, for the LR2 result scene. */
const BENCH_LR2_RESULT_SKIN = {
  width: 640,
  height: 480,
  timing: { startInput: 300 },
  images: [],
  numbers: [],
  texts: [],
  bargraphs: [],
  sliders: [],
  gaugeCharts: [],
  scoreCharts: [],
  lr2FontPaths: [],
  systemFontSizes: [],
  files: new Map(),
} as unknown as LR2Skin;
/** No keys reach a benchmarked scene. */
const BENCH_KEY_TARGET: playerWebCoreAPI.SessionKeyTarget = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
const BENCH_SCENE_SESSION: playerWebCoreAPI.SceneSession<number, never> = {
  kind: 'select',
  enter: () => undefined,
  exit: () => undefined,
  dispose: () => undefined,
  handleKey: () => false,
  dispatch: () => undefined,
  frame: (nowMs) => nowMs,
};
const BENCH_FAMILY_VIEW: playerWebCoreAPI.FamilyView<number, never> = {
  family: 'built-in',
  root: new Container(),
  attach: () => undefined,
  draw: () => undefined,
  detach: () => undefined,
  dispose: () => undefined,
};

const BENCH_BYTES = new Uint8Array([35, 84, 73, 84, 76, 69, 32, 66, 101, 110, 99, 104, 10]);
const BENCH_BMS_FILE = makeBenchFile('Songs/Bench/main.bms', '#TITLE Bench\n#BPM 130\n#00111:0100\n');
const BENCH_APPEND_BMS_FILE = makeBenchFile('Songs/BenchExtra/main.bms', '#TITLE Bench Extra\n#BPM 130\n#00111:0100\n');
const BENCH_WAV_FILE = makeBenchFile('Songs/Bench/kick.wav', 'RIFF');
const BENCH_DROPPED_ENTRY = {
  name: 'kick.wav',
  file: (resolve: (file: File) => void) => resolve(BENCH_WAV_FILE),
};
const BENCH_SOURCE = makeBenchSource();
const BENCH_SONG = makeBenchSong();
const BENCH_PLAY_RESULT: PlayResult = {
  score: { total: 1, perfect: 1, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 2, score: 2 },
  maxCombo: 1,
  gauge: 100,
  cleared: true,
  playSeconds: 1,
  chart: BENCH_SONG,
  gaugeHistory: [],
  scoreHistory: [],
};
const BENCH_COLLECTION = {
  sources: [BENCH_SOURCE],
  charts: [BENCH_SONG],
  errors: [],
} satisfies playerWebCoreAPI.BrowserChartCollection;
const BENCH_SONG_MD5 = '0123456789abcdef0123456789abcdef';
const BENCH_COURSE_DEFINITION = parseBeatorajaCourseData({
  name: 'Bench Dan',
  hash: [{ md5: BENCH_SONG_MD5 }],
  constraint: ['MIRROR', 'GAUGE_LR2', 'NO_SPEED', 'HCN'],
})!;
const BENCH_COURSE_GROUPS = [{ label: 'Bench', courses: [BENCH_COURSE_DEFINITION] }];
const BENCH_HASHED_SONGS = [{ chart: BENCH_SONG, md5: BENCH_SONG_MD5 }];
const BENCH_COURSE_LOOKUP = playerWebCoreAPI.createChartHashLookup(BENCH_HASHED_SONGS);
const BENCH_RANDOM_COURSE = parseBeatorajaRandomCourseData({
  name: 'Bench Random',
  stage: [{ sql: 'level >= 0' }],
  constraint: ['GAUGE_LR2'],
})!;
const BENCH_RANDOM_ENTRY = playerWebCoreAPI.createRandomCourseEntry('Bench#r0', BENCH_RANDOM_COURSE);
const BENCH_LR2CRS_BYTES = new TextEncoder().encode(
  `<?xml version="1.0"?><courselist><course><title>Bench</title><line>7</line><type>2</type><hash>${'0'.repeat(32)}${BENCH_SONG_MD5}</hash></course></courselist>`,
);
const BENCH_BEATORAJA_FILES = new Map<string, BeatorajaSkinFileEntry>([
  ['sound/cursor.wav', BENCH_BYTES],
  ['sound/decide.wav', BENCH_BYTES],
  ['sound/cancel.wav', BENCH_BYTES],
  ['BGM/select.ogg', BENCH_BYTES],
]);
const BENCH_BEATORAJA_SKIN_ENTRY = {
  entryPath: 'skin/bench/play7.json',
  header: { type: 0, name: 'Bench', w: 1280, h: 720 },
} satisfies BeatorajaSkinEntry;
const BENCH_BEATORAJA_PLAY_SKINS = {
  '7': BENCH_BEATORAJA_SKIN_ENTRY,
} satisfies BeatorajaPlaySkinMap;
const BENCH_BEATORAJA_THEME_BUNDLE = {
  files: BENCH_BEATORAJA_FILES,
  theme: { playSkins: BENCH_BEATORAJA_PLAY_SKINS, entries: [BENCH_BEATORAJA_SKIN_ENTRY] },
  warnings: [],
};
/** A theme with one JSON select skin and no sources or fonts, so loading it as a scene kit decodes nothing. */
const BENCH_BEATORAJA_KIT_ENTRY_PATH = 'skin/bench/select.json';
const BENCH_BEATORAJA_KIT_HEADER = {
  type: 5,
  name: 'Bench Select',
  w: 1280,
  h: 720,
  property: [
    {
      name: 'Bench Option',
      def: 'On',
      item: [
        { name: 'Off', op: 900 },
        { name: 'On', op: 901 },
      ],
    },
  ],
} satisfies BeatorajaSkinHeader;
const BENCH_BEATORAJA_KIT_FILES = new Map<string, BeatorajaSkinFileEntry>([
  [BENCH_BEATORAJA_KIT_ENTRY_PATH, new TextEncoder().encode(JSON.stringify(BENCH_BEATORAJA_KIT_HEADER))],
]);
const BENCH_BEATORAJA_SOURCE_BUNDLE = {
  assets: [],
  byId: new Map(),
  unresolved: [],
} satisfies BeatorajaSourceBundle;
const BENCH_BEATORAJA_DESTINATION = {
  id: 'bench',
  timer: 0,
  loop: 0,
  offset: 0,
  op: [],
  blend: 2,
  filter: 0,
  center: 0,
  offsets: [],
  ifCodes: [],
  dst: [{ time: 0, x: 10, y: 20, w: 100, h: 50, r: 255, g: 255, b: 255, a: 255, angle: 0, acc: 0 }],
  acc: 0,
  stretch: 0,
  mouseRect: undefined,
  relative: false,
  declarationOrder: 0,
} satisfies BeatorajaDestinationGroup;

export function registerPlayerWebCoreExportsCases(define: DefineBenchmarkCase): void {
  define('player-browser.defaultBrowserWorkerCount', {
    run: () => {
      playerWebCoreAPI.defaultBrowserWorkerCount(8);
    },
  });
  define('player-browser.normalizeBrowserWorkerCount', {
    run: () => {
      playerWebCoreAPI.normalizeBrowserWorkerCount(3, 8);
    },
  });
  define('player-browser.getBrowserWorkerCount', {
    run: () => {
      playerWebCoreAPI.getBrowserWorkerCount();
    },
  });
  define('player-browser.setBrowserWorkerCount', {
    run: () => {
      playerWebCoreAPI.setBrowserWorkerCount(2);
    },
  });
  define('player-browser.runBrowserTask', {
    run: async () => {
      await playerWebCoreAPI.runBrowserTask('benchmark', 0, () => 0);
    },
  });
  define('player-browser.executeBrowserTask', {
    run: () => {
      playerWebCoreAPI.executeBrowserTask('parse-chart', {
        path: 'a.bms',
        bytes: new TextEncoder().encode('#TITLE Bench\n#00111:01'),
      });
    },
  });
  define('player-browser.configureBrowserWorkers', {
    interactive: true,
    run: () => {
      playerWebCoreAPI.configureBrowserWorkers(() => {
        throw new Error('No browser worker');
      });
    },
  });
  define('player-browser.disposeBrowserWorkers', {
    interactive: true,
    run: () => {
      playerWebCoreAPI.disposeBrowserWorkers();
    },
  });

  define('player-browser.applyBeatorajaStretchRect', {
    run: () => {
      playerWebCoreAPI.applyBeatorajaStretchRect(
        { x: 0, y: 0, width: 320, height: 180 },
        { width: 128, height: 256 },
        2,
      );
    },
  });
  define('player-browser.asLoadedBytes', {
    run: () => {
      playerWebCoreAPI.asLoadedBytes(BENCH_BYTES);
    },
  });
  define('player-browser.buildAudioBus', {
    run: () => {
      const bus = playerWebCoreAPI.buildAudioBus(createFakeAudioContext(), 'split');
      bus.setStageEnabled('master', false);
      bus.setMode('legacy');
      bus.dispose();
    },
  });
  define('player-browser.blendCodeToPixi', {
    run: () => {
      playerWebCoreAPI.blendCodeToPixi(3);
      playerWebCoreAPI.blendCodeToPixi(9);
    },
  });
  define('player-browser.BrowserChartCollectionStore', {
    run: async () => {
      const store = new playerWebCoreAPI.BrowserChartCollectionStore();
      await store.loadFromFiles([BENCH_BMS_FILE]);
      await store.appendFromFiles([BENCH_APPEND_BMS_FILE]);
    },
  });
  define('player-browser.ChartPreviewEngine', {
    run: () => {
      const node = createFakeAudioNode();
      const engine = new playerWebCoreAPI.ChartPreviewEngine(createFakeAudioContext(), node, { focusDelayMs: 1 });
      engine.stop();
      engine.dispose();
    },
  });
  define('player-browser.checkBrowserCompat', {
    run: () => {
      playerWebCoreAPI.checkBrowserCompat();
    },
  });
  define('player-browser.computeChartFileSHA256', {
    run: async () => {
      await playerWebCoreAPI.computeChartFileSHA256(BENCH_SOURCE, 'Songs/Bench/main.bms');
    },
  });
  define('player-browser.computeChartFileHashes', {
    run: async () => {
      await playerWebCoreAPI.computeChartFileHashes(BENCH_SOURCE, 'Songs/Bench/main.bms');
    },
  });
  define('player-browser.md5HexOfBytes', {
    run: () => {
      playerWebCoreAPI.md5HexOfBytes(BENCH_BYTES);
    },
  });
  define('player-browser.computeSHA256Hex', {
    run: async () => {
      await playerWebCoreAPI.computeSHA256Hex(BENCH_BYTES);
    },
  });
  define('player-browser.createAudioService', {
    run: async () => {
      const service = playerWebCoreAPI.createAudioService({ createContext: () => BENCH_SYSTEM_AUDIO_CONTEXT });
      service.setTheme({ sounds: { cursor: { bytes: BENCH_BYTES } } });
      await service.playCue('cursor', { owner: BENCH_AUDIO_OWNER });
      service.stopOwned(BENCH_AUDIO_OWNER);
      service.dispose();
    },
  });
  define('player-browser.createDecideScene', {
    run: async () => {
      const kits: playerWebCoreAPI.DecideSceneKit[] = [
        { family: 'built-in', skin: playerWebCoreAPI.phantomSkin },
        { family: 'lr2', skin: BENCH_LR2_DECIDE_SKIN },
        {
          family: 'beatoraja',
          kit: { skin: makeBenchBeatorajaSkin(), textures: makeEmptyBeatorajaTextureCache(), files: new Map() },
        },
      ];
      for (const kit of kits) {
        const scene = playerWebCoreAPI.createDecideScene(kit, {
          chart: BENCH_SONG,
          sounds: { decideBGM: { bytes: BENCH_BYTES } },
          audio: playerWebCoreAPI.createAudioService({ createContext: () => undefined }),
          on: { continue: () => undefined, cancel: () => undefined },
          keyTarget: BENCH_KEY_TARGET,
          now: () => 0,
        });
        await scene.enter(BENCH_VIEW_HOST);
        scene.exit();
        scene.dispose();
      }
    },
  });
  define('player-browser.createResultScene', {
    run: () => {
      const kits: playerWebCoreAPI.ResultSceneKit[] = [
        { family: 'built-in', skin: playerWebCoreAPI.phantomSkin },
        { family: 'lr2', skin: BENCH_LR2_RESULT_SKIN },
        {
          family: 'beatoraja',
          kit: { skin: makeBenchBeatorajaSkin(), textures: makeEmptyBeatorajaTextureCache(), files: new Map() },
        },
      ];
      for (const kit of kits) {
        const scene = playerWebCoreAPI.createResultScene(kit, {
          result: BENCH_PLAY_RESULT,
          sounds: { clear: { bytes: BENCH_BYTES } },
          audio: playerWebCoreAPI.createAudioService({ createContext: () => undefined }),
          on: { continue: () => undefined, retry: () => undefined },
          keyTarget: BENCH_KEY_TARGET,
          now: () => 0,
        });
        scene.exit();
        scene.dispose();
      }
    },
  });
  define('player-browser.createPlayScene', {
    run: () => {
      const scene = playerWebCoreAPI.createPlayScene(
        { family: 'built-in', skin: playerWebCoreAPI.phantomSkin },
        {
          chart: BENCH_SONG,
          settings: { autoPlay: true },
          audio: playerWebCoreAPI.createAudioService({ createContext: () => undefined }),
          on: { finish: () => undefined, exit: () => undefined, restart: () => undefined },
          keyTarget: BENCH_KEY_TARGET,
          now: () => 0,
        },
      );
      scene.getHiSpeed();
      scene.dispose();
    },
  });
  define('player-browser.createSelectScene', {
    run: () => {
      const scene = playerWebCoreAPI.createSelectScene(
        { family: 'built-in', skin: playerWebCoreAPI.phantomSkin },
        {
          library: { sources: [], charts: [BENCH_SONG], errors: [] },
          sounds: { selectBGM: { bytes: BENCH_BYTES } },
          audio: playerWebCoreAPI.createAudioService({ createContext: () => undefined }),
          on: { start: () => undefined },
          keyTarget: BENCH_KEY_TARGET,
          now: () => 0,
        },
      );
      scene.snapshot();
      scene.dispose();
    },
  });
  define('player-browser.createSkinFamilyRegistry', {
    run: () => {
      const registry = playerWebCoreAPI.createSkinFamilyRegistry([
        { id: 'default', label: 'Default' },
        { id: 'lr2', label: 'LR2', matchesThemeFile: (path) => path.endsWith('.lr2skin') },
        { id: 'beatoraja', label: 'beatoraja', matchesThemeFile: (path) => path.endsWith('.luaskin') },
      ]);
      registry.byId('lr2');
      registry.detectThemeFile('Theme/play_7.lr2skin');
      registry.detectThemeFamilies(['Theme/play_7.lr2skin', 'Skin/play7.luaskin']);
    },
  });
  define('player-browser.createEagerDropPathPredicate', {
    run: () => {
      const isEager = playerWebCoreAPI.createEagerDropPathPredicate([
        'Songs/Example/main.bms',
        'Songs/Example/kick.wav',
        'Theme/play_7.lr2skin',
      ]);
      isEager('Songs/Example/kick.wav');
      isEager('Theme/play_7.lr2skin');
    },
  });
  define('player-browser.createBeMusicSkinRegistry', {
    run: () => {
      const registry = playerWebCoreAPI.createBeMusicSkinRegistry([playerWebCoreAPI.phantomSkin]);
      registry.resolve('phantom');
      registry.resolve('missing');
    },
  });
  define('player-browser.resolveSelectListWindow', {
    run: () => {
      playerWebCoreAPI.resolveSelectListWindow(playerWebCoreAPI.phantomSkin.select.layout, 480, 50, 100);
    },
  });
  define('player-browser.createCroppedBeatorajaTexture', {
    run: () => {
      playerWebCoreAPI.createCroppedBeatorajaTexture(undefined, { x: 0, y: 0, w: 16, h: 16 });
    },
  });
  define('player-browser.destinationToSpriteProps', {
    run: () => {
      playerWebCoreAPI.destinationToSpriteProps(
        BENCH_BEATORAJA_DESTINATION,
        { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 },
        720,
      );
    },
  });
  define('player-browser.DeferredDroppedFile', {
    run: async () => {
      const file = new playerWebCoreAPI.DeferredDroppedFile(BENCH_DROPPED_ENTRY, 'Songs/Bench/kick.wav');
      await file.arrayBuffer();
    },
  });
  define('player-browser.describeChartCollection', {
    run: () => {
      playerWebCoreAPI.describeChartCollection(BENCH_COLLECTION);
    },
  });
  define('player-browser.downloadBlob', {
    run: () => {
      playerWebCoreAPI.downloadBlob(new Blob([BENCH_BYTES]), 'bench.webm');
    },
    interactive: true,
  });
  define('player-browser.GameplayRecorder', {
    run: () => {
      const recorder = new playerWebCoreAPI.GameplayRecorder({
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
  define('player-browser.createNonstopAssets', {
    run: () => {
      const assets = playerWebCoreAPI.createNonstopAssets([
        { chart: BENCH_SONG.chart, source: BENCH_SOURCE, chartPath: BENCH_SONG.chartPath },
        { chart: BENCH_SONG.chart, source: BENCH_SOURCE, chartPath: BENCH_SONG.chartPath },
      ]);
      assets.assetPath(0, 'wav', 'kick.wav');
      assets.assetPath(1, 'bmp', 'banner.png');
    },
  });
  define('player-browser.isCourseFilePath', {
    run: () => {
      playerWebCoreAPI.isCourseFilePath('Songs/dan.lr2crs');
      playerWebCoreAPI.isCourseFilePath('beatoraja/course/dan.json');
      playerWebCoreAPI.isCourseFilePath('beatoraja/folder/default.json');
      playerWebCoreAPI.isCourseFilePath('Songs/Bench/info.json');
    },
  });
  define('player-browser.readCourseFile', {
    run: () => {
      playerWebCoreAPI.readCourseFile('Songs/dan.lr2crs', BENCH_LR2CRS_BYTES);
    },
  });
  define('player-browser.createChartHashLookup', {
    run: () => {
      playerWebCoreAPI.createChartHashLookup(BENCH_HASHED_SONGS);
    },
  });
  define('player-browser.resolveCourseFolders', {
    run: () => {
      playerWebCoreAPI.resolveCourseFolders(BENCH_COURSE_GROUPS, BENCH_COURSE_LOOKUP);
    },
  });
  define('player-browser.createRandomCourseEntry', {
    run: () => {
      playerWebCoreAPI.createRandomCourseEntry('Bench#r0', BENCH_RANDOM_COURSE);
    },
  });
  define('player-browser.createCourseChartRecord', {
    run: () => {
      const record = playerWebCoreAPI.createCourseChartRecord(BENCH_SONG, { md5: BENCH_SONG_MD5 });
      void record.level;
    },
  });
  define('player-browser.drawBrowserRandomCourse', {
    run: () => {
      playerWebCoreAPI.drawBrowserRandomCourse(BENCH_RANDOM_ENTRY, BENCH_HASHED_SONGS, () => 0);
    },
  });
  define('player-browser.resolveCourseEntry', {
    run: () => {
      playerWebCoreAPI.resolveCourseEntry('Bench#0', BENCH_COURSE_DEFINITION, BENCH_COURSE_LOOKUP);
    },
  });
  define('player-browser.createNewCourseEntry', {
    run: () => {
      playerWebCoreAPI.createNewCourseEntry('nonstop');
    },
  });
  define('player-browser.CourseMaker', {
    run: () => {
      const maker = new playerWebCoreAPI.CourseMaker({ md5Of: async () => undefined });
      maker.start('expert');
      maker.finish();
    },
  });
  define('player-browser.resolveCourseMakerFolders', {
    run: () => {
      playerWebCoreAPI.resolveCourseMakerFolders([BENCH_COURSE_DEFINITION], BENCH_COURSE_LOOKUP);
    },
  });
  define('player-browser.findBeatorajaThemeBGM', {
    run: async () => {
      await playerWebCoreAPI.findBeatorajaThemeBGM(BENCH_BEATORAJA_THEME_BUNDLE);
    },
  });
  define('player-browser.flipRectToPixi', {
    run: () => {
      playerWebCoreAPI.flipRectToPixi({ x: 10, y: 20, w: 100, h: 50 }, 720);
    },
  });
  define('player-browser.isBeatorajaLuaSkinFilePath', {
    run: () => {
      playerWebCoreAPI.isBeatorajaLuaSkinFilePath('skin/bench/play7.luaskin');
    },
  });
  define('player-browser.isBeatorajaSkinIndicator', {
    run: () => {
      playerWebCoreAPI.isBeatorajaSkinIndicator('skin/bench/play7.json');
    },
  });
  define('player-browser.isChartFilePath', {
    run: () => {
      playerWebCoreAPI.isChartFilePath('Songs/Bench/main.bms');
    },
  });
  define('player-browser.isLR2SkinFilePath', {
    run: () => {
      playerWebCoreAPI.isLR2SkinFilePath('theme/play_7.lr2skin');
    },
  });
  define('player-browser.loadAssetBytes', {
    run: async () => {
      await playerWebCoreAPI.loadAssetBytes(BENCH_BYTES);
    },
  });
  define('player-browser.loadBeatorajaChartImages', {
    run: async () => {
      // The bench chart has no images, so the source is walked without decoding anything.
      await playerWebCoreAPI.loadBeatorajaChartImages(BENCH_SONG, BENCH_SOURCE);
    },
  });
  define('player-browser.resolveBeatorajaChartImage', {
    run: () => {
      playerWebCoreAPI.resolveBeatorajaChartImage({}, -100);
      playerWebCoreAPI.resolveBeatorajaChartImage(undefined, -102);
    },
  });
  define('player-browser.loadBeatorajaFonts', {
    run: async () => {
      const cache = await playerWebCoreAPI.loadBeatorajaFonts({
        files: BENCH_BEATORAJA_FILES,
        entryPath: 'skin/bench/play7.json',
        fonts: [],
      });
      cache.dispose();
    },
  });
  define('player-browser.loadBeatorajaTexturesFromBundle', {
    run: async () => {
      await playerWebCoreAPI.loadBeatorajaTexturesFromBundle(BENCH_BEATORAJA_SOURCE_BUNDLE);
    },
  });
  define('player-browser.loadBeatorajaThemeFromFiles', {
    run: async () => {
      await playerWebCoreAPI.loadBeatorajaThemeFromFiles([]);
    },
  });
  define('player-browser.createBeatorajaSceneKitCaches', {
    run: () => {
      playerWebCoreAPI.createBeatorajaSceneKitCaches();
    },
  });
  define('player-browser.defaultBeatorajaSkinConfig', {
    run: () => {
      playerWebCoreAPI.defaultBeatorajaSkinConfig(
        BENCH_BEATORAJA_KIT_HEADER,
        BENCH_BEATORAJA_KIT_FILES,
        BENCH_BEATORAJA_KIT_ENTRY_PATH,
      );
    },
  });
  define('player-browser.resolveBeatorajaSkinConfig', {
    run: () => {
      const caches = playerWebCoreAPI.createBeatorajaSceneKitCaches();
      playerWebCoreAPI.resolveBeatorajaSkinConfig(
        caches,
        BENCH_BEATORAJA_KIT_ENTRY_PATH,
        BENCH_BEATORAJA_KIT_HEADER,
        BENCH_BEATORAJA_KIT_FILES,
      );
      playerWebCoreAPI.resolveBeatorajaSkinConfig(
        caches,
        BENCH_BEATORAJA_KIT_ENTRY_PATH,
        BENCH_BEATORAJA_KIT_HEADER,
        BENCH_BEATORAJA_KIT_FILES,
      );
    },
  });
  define('player-browser.createBeatorajaSkinLoadContext', {
    run: () => {
      const context = playerWebCoreAPI.createBeatorajaSkinLoadContext({
        difficulty: 4,
        skinConfig: { option: { 'Bench Option': 901 } },
      });
      context.option?.(901);
    },
  });
  define('player-browser.loadBeatorajaSceneKit', {
    run: async () => {
      const caches = playerWebCoreAPI.createBeatorajaSceneKitCaches();
      await playerWebCoreAPI.loadBeatorajaSceneKit({
        files: BENCH_BEATORAJA_KIT_FILES,
        entryPath: BENCH_BEATORAJA_KIT_ENTRY_PATH,
        caches,
      });
      playerWebCoreAPI.releaseBeatorajaSceneKitAssets(caches);
    },
  });
  define('player-browser.releaseBeatorajaSceneKitAssets', {
    run: () => {
      playerWebCoreAPI.releaseBeatorajaSceneKitAssets(playerWebCoreAPI.createBeatorajaSceneKitCaches());
    },
  });
  define('player-browser.logger', {
    run: () => {
      playerWebCoreAPI.logger('bench');
    },
  });
  define('player-browser.loadChartCollectionFromDrop', {
    run: async () => {
      await playerWebCoreAPI.loadChartCollectionFromDrop({
        files: [BENCH_BMS_FILE, BENCH_WAV_FILE],
      } as unknown as DataTransfer);
    },
  });
  define('player-browser.loadChartCollectionFromFiles', {
    run: async () => {
      await playerWebCoreAPI.loadChartCollectionFromFiles([BENCH_BMS_FILE, BENCH_WAV_FILE]);
    },
  });
  define('player-browser.loadTextureFromBytes', {
    run: async () => {
      await playerWebCoreAPI.loadTextureFromBytes('bench.png', BENCH_BYTES);
    },
    interactive: true,
  });
  define('player-browser.makeWebMSeekable', {
    run: async () => {
      await playerWebCoreAPI.makeWebMSeekable(new Blob([BENCH_BYTES]));
    },
    interactive: true,
  });
  define('player-browser.materializeDroppedFiles', {
    run: async () => {
      await playerWebCoreAPI.materializeDroppedFiles([
        BENCH_BMS_FILE,
        new playerWebCoreAPI.DeferredDroppedFile(BENCH_DROPPED_ENTRY, 'Songs/Bench/kick.wav'),
      ]);
    },
  });
  define('player-browser.parseCompressorMode', {
    run: () => {
      playerWebCoreAPI.parseCompressorMode('split');
    },
  });
  define('player-browser.sanitizeBusVolume', {
    run: () => {
      playerWebCoreAPI.sanitizeBusVolume(0.75);
    },
  });
  define('player-browser.mergeCompressorParams', {
    run: () => {
      playerWebCoreAPI.mergeCompressorParams(playerWebCoreAPI.KEY_BUS_COMPRESSOR_PARAMS, {
        threshold: -12,
        attack: 0.02,
      });
    },
  });
  define('player-browser.shouldCaptureFrame', {
    run: () => {
      playerWebCoreAPI.shouldCaptureFrame(1033.3, 1000, 30);
    },
  });
  define('player-browser.resolveCaptureSize', {
    run: () => {
      playerWebCoreAPI.resolveCaptureSize(2944, 2108, { width: 1920, height: 1080 });
    },
  });
  define('player-browser.alignAudioChunk', {
    run: () => {
      playerWebCoreAPI.alignAudioChunk(47_000, 4096, 48_000, 48_000);
    },
  });
  define('player-browser.resolveFrameTimestamp', {
    run: () => {
      playerWebCoreAPI.resolveFrameTimestamp(12.5, 10, 2.48);
    },
  });
  define('player-browser.supportsWebCodecsRecording', {
    run: () => {
      playerWebCoreAPI.supportsWebCodecsRecording({} as BaseAudioContext);
    },
  });
  define('player-browser.sanitizeMasterVolume', {
    run: () => {
      playerWebCoreAPI.sanitizeMasterVolume(1.5);
    },
  });
  define('player-browser.setMasterVolume', {
    run: () => {
      playerWebCoreAPI.setMasterVolume(1);
    },
  });
  define('player-browser.getMasterVolume', {
    run: () => {
      playerWebCoreAPI.getMasterVolume();
    },
  });
  define('player-browser.masterOutput', {
    run: () => {
      playerWebCoreAPI.masterOutput(BENCH_AUDIO_CONTEXT);
    },
  });
  define('player-browser.getSystemAudioSession', {
    run: () => {
      playerWebCoreAPI.getSystemAudioSession(BENCH_AUDIO_SESSION_HOST);
    },
  });
  define('player-browser.supportsSystemAudioSession', {
    run: () => {
      playerWebCoreAPI.supportsSystemAudioSession(BENCH_AUDIO_SESSION_HOST);
    },
  });
  define('player-browser.applySystemAudioSessionType', {
    run: () => {
      playerWebCoreAPI.applySystemAudioSessionType('ambient', BENCH_AUDIO_SESSION_HOST);
      playerWebCoreAPI.applySystemAudioSessionType('auto', BENCH_AUDIO_SESSION_HOST);
    },
  });
  define('player-browser.resolveSilentModeAudioSessionType', {
    run: () => {
      playerWebCoreAPI.resolveSilentModeAudioSessionType(true);
      playerWebCoreAPI.resolveSilentModeAudioSessionType(false);
    },
  });
  define('player-browser.applySilentModePlayback', {
    run: () => {
      playerWebCoreAPI.applySilentModePlayback(true, BENCH_AUDIO_SESSION_HOST);
      playerWebCoreAPI.applySilentModePlayback(false, BENCH_AUDIO_SESSION_HOST);
    },
  });
  define('player-browser.pickRecorderMIMEType', {
    run: () => {
      playerWebCoreAPI.pickRecorderMIMEType((type) => type === 'video/webm');
    },
  });
  define('player-browser.recorderMIMECandidates', {
    run: () => {
      playerWebCoreAPI.recorderMIMECandidates({ container: 'mp4', videoCodec: 'avc' });
    },
  });
  define('player-browser.recordingVideoCodecs', {
    run: () => {
      playerWebCoreAPI.recordingVideoCodecs({ container: 'webm', videoCodec: 'vp8' });
    },
  });
  define('player-browser.recordingAudioCodecs', {
    run: () => {
      playerWebCoreAPI.recordingAudioCodecs('mp4');
    },
  });
  define('player-browser.describeRecordingFormat', {
    run: () => {
      playerWebCoreAPI.describeRecordingFormat({ container: 'mp4', videoCodec: 'hevc' });
    },
  });
  define('player-browser.recordingFileExtension', {
    run: () => {
      playerWebCoreAPI.recordingFileExtension('video/mp4;codecs=avc1,mp4a.40.2');
    },
  });
  define('player-browser.chartPlayVariantForBeatorajaVariant', {
    run: () => {
      playerWebCoreAPI.chartPlayVariantForBeatorajaVariant('7');
      playerWebCoreAPI.chartPlayVariantForBeatorajaVariant('24d');
    },
  });
  define('player-browser.pickBeatorajaPlayableSkinVariant', {
    run: () => {
      playerWebCoreAPI.pickBeatorajaPlayableSkinVariant(BENCH_BEATORAJA_PLAY_SKINS, '7');
    },
  });
  define('player-browser.pickBeatorajaPlayableVariant', {
    run: () => {
      playerWebCoreAPI.pickBeatorajaPlayableVariant({ keys: 7, isDouble: false, isPMS: false });
      playerWebCoreAPI.pickBeatorajaPlayableVariant({ keys: 9, isDouble: false, isPMS: true });
    },
  });
  define('player-browser.PixiSceneHost', {
    run: () => {
      new playerWebCoreAPI.PixiSceneHost();
    },
    interactive: true,
  });
  define('player-browser.SessionScene', {
    run: async () => {
      const scene = new playerWebCoreAPI.SessionScene(BENCH_SCENE_SESSION, BENCH_FAMILY_VIEW, { now: () => 0 });
      await scene.enter(BENCH_SCENE_HOST);
      scene.exit();
      scene.dispose();
    },
  });
  define('player-browser.readDroppedFiles', {
    run: async () => {
      await playerWebCoreAPI.readDroppedFiles({ files: [BENCH_BMS_FILE] } as unknown as DataTransfer);
    },
  });
  define('player-browser.readFilesIntoBytesMap', {
    ioBound: true,
    run: async () => {
      await playerWebCoreAPI.readFilesIntoBytesMap([BENCH_BMS_FILE], { deferAudio: false });
    },
  });
  define('player-browser.resolveChartAsset', {
    run: () => {
      playerWebCoreAPI.resolveChartAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'kick.wav');
    },
  });
  define('player-browser.resolveChartAudioAsset', {
    run: () => {
      playerWebCoreAPI.resolveChartAudioAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'kick.wav');
    },
  });
  define('player-browser.resolveChartBGAAsset', {
    run: () => {
      playerWebCoreAPI.resolveChartBGAAsset(BENCH_SOURCE, BENCH_SONG.chartPath, '_bga.mpg');
    },
  });
  define('player-browser.resolveChartImageAsset', {
    run: () => {
      playerWebCoreAPI.resolveChartImageAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'banner.bmp');
    },
  });
  define('player-browser.resolveDropFilePath', {
    run: () => {
      playerWebCoreAPI.resolveDropFilePath(BENCH_BMS_FILE);
    },
  });
  define('player-browser.resolveRendererPreference', {
    run: () => {
      playerWebCoreAPI.resolveRendererPreference('?renderer=webgl');
    },
  });
  define('player-browser.resolveRenderResolution', {
    run: () => {
      playerWebCoreAPI.resolveRenderResolution(2, '?resolution=1.5');
    },
  });
  define('player-browser.Rectangle', {
    run: () => {
      new playerWebCoreAPI.Rectangle(0, 0, 320, 180);
    },
  });
  define('player-browser.resolveChartSource', {
    run: () => {
      playerWebCoreAPI.resolveChartSource(BENCH_COLLECTION, BENCH_SONG);
    },
  });
  define('player-browser.splitDroppedChartAndThemeFiles', {
    run: () => {
      playerWebCoreAPI.splitDroppedChartAndThemeFiles([
        { name: 'main.bms', webkitRelativePath: 'Songs/Example/main.bms' },
        { name: 'kick.wav', webkitRelativePath: 'Songs/Example/kick.wav' },
        { name: 'play_7.lr2skin', webkitRelativePath: 'Theme/play_7.lr2skin' },
      ]);
    },
  });
  define('player-browser.summarizeBrowserCompat', {
    run: () => {
      playerWebCoreAPI.summarizeBrowserCompat({
        ok: false,
        items: [
          {
            id: 'webgl2',
            label: 'WebGL2',
            supported: false,
            required: true,
            note: 'benchmark',
          },
        ],
      });
    },
  });
  define('player-browser.summarizeBeatorajaPlaySkins', {
    run: () => {
      playerWebCoreAPI.summarizeBeatorajaPlaySkins(BENCH_BEATORAJA_PLAY_SKINS);
    },
  });
}

function makeBenchFile(path: string, body: string | Uint8Array<ArrayBuffer>): File {
  const name = path.split('/').at(-1) ?? path;
  const file = new File([body], name);
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    enumerable: true,
    value: path,
  });
  return file;
}

function makeBenchSource(): playerWebCoreAPI.BrowserAssetSource {
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

function makeBenchSong(): LibraryChart {
  const chart: BeMusicJSON = createEmptyJSON('bms');
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

function makeBenchBeatorajaSkin(): BeatorajaSkin {
  return {
    type: 0,
    name: 'bench',
    w: 1280,
    h: 720,
    destination: [],
  };
}

function makeEmptyBeatorajaTextureCache(): playerWebCoreAPI.BeatorajaTextureCache {
  const textures = new Map<never, NonNullable<ReturnType<playerWebCoreAPI.BeatorajaTextureCache['get']>>>();
  return {
    get: () => undefined,
    values: () => textures.values(),
    pathOf: () => undefined,
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
  } as unknown as AudioBuffer;
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

/** A stand-in for the audio service's system context: gains, an analyser, buffer sources and a decode. */
function createFakeSystemAudioContext(): AudioContext {
  const buffer = makeAudioBufferLike();
  return {
    state: 'running',
    sampleRate: 48_000,
    currentTime: 0,
    destination: createFakeAudioNode('destination'),
    addEventListener: () => undefined,
    createGain: () => createFakeAudioNode('gain'),
    createAnalyser: () => ({
      connect: () => undefined,
      disconnect: () => undefined,
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteFrequencyData: () => undefined,
      getFloatTimeDomainData: () => undefined,
    }),
    createBufferSource: () => ({
      connect: () => undefined,
      disconnect: () => undefined,
      buffer: null,
      loop: false,
      onended: null,
      start: () => undefined,
      stop: () => undefined,
    }),
    decodeAudioData: async () => buffer,
    resume: async () => undefined,
    close: async () => undefined,
  } as unknown as AudioContext;
}
