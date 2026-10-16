import * as playerWebCoreApi from '@be-music/player-web';
import type {
  BeatorajaDestinationGroup,
  BeatorajaPlaySkinMap,
  BeatorajaSkin,
  BeatorajaSkinEntry,
  BeatorajaSkinFileEntry,
  BeatorajaSkinHeader,
  BeatorajaSourceBundle,
} from '@be-music/beatoraja-skin';
import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import type { Lr2Skin } from '@be-music/lr2-skin';
import { parseBeatorajaCourseData, parseBeatorajaRandomCourseData } from '@be-music/player/course';
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
const BENCH_AUDIO_SESSION_HOST: playerWebCoreApi.SystemAudioSessionHost = { audioSession: { type: 'auto' } };

/** A host whose ticker only records callbacks, and a session and view that do nothing, for `SessionScene`. */
const BENCH_SCENE_HOST = {
  app: { ticker: { add: () => undefined, remove: () => undefined } },
} as unknown as playerWebCoreApi.PixiSceneHost;
/** A host a family view can draw on: the ticker, a canvas for its pointer listeners, the screen and the renderer. */
const BENCH_VIEW_HOST = {
  app: {
    ticker: { add: () => undefined, remove: () => undefined },
    canvas: { addEventListener: () => undefined, removeEventListener: () => undefined },
    screen: { width: 1280, height: 720 },
    renderer: { resolution: 1 },
  },
  setStageOrientation: () => undefined,
} as unknown as playerWebCoreApi.PixiSceneHost;
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
} as unknown as Lr2Skin;
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
} as unknown as Lr2Skin;
/** No keys reach a benchmarked scene. */
const BENCH_KEY_TARGET: playerWebCoreApi.SessionKeyTarget = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
const BENCH_SCENE_SESSION: playerWebCoreApi.SceneSession<number, never> = {
  kind: 'select',
  enter: () => undefined,
  exit: () => undefined,
  dispose: () => undefined,
  handleKey: () => false,
  dispatch: () => undefined,
  frame: (nowMs) => nowMs,
};
const BENCH_FAMILY_VIEW: playerWebCoreApi.FamilyView<number, never> = {
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
const BENCH_PLAY_RESULT: playerWebCoreApi.PixiGameplayResultData = {
  score: { total: 1, perfect: 1, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 2, score: 2 },
  maxCombo: 1,
  gauge: 100,
  cleared: true,
  playSeconds: 1,
  song: BENCH_SONG,
  gaugeHistory: [],
  scoreHistory: [],
};
const BENCH_PLAYLOG = makeBenchPlaylog();
const BENCH_PLAYLOG_JSON = JSON.stringify(BENCH_PLAYLOG);
const BENCH_PMS_SONG = makeBenchPmsSong();
const BENCH_COLLECTION = {
  sources: [BENCH_SOURCE],
  songs: [BENCH_SONG],
  errors: [],
} satisfies playerWebCoreApi.BrowserSongCollection;
const BENCH_SONG_MD5 = '0123456789abcdef0123456789abcdef';
const BENCH_COURSE_DEFINITION = parseBeatorajaCourseData({
  name: 'Bench Dan',
  hash: [{ md5: BENCH_SONG_MD5 }],
  constraint: ['MIRROR', 'GAUGE_LR2', 'NO_SPEED', 'HCN'],
})!;
const BENCH_COURSE_GROUPS = [{ label: 'Bench', courses: [BENCH_COURSE_DEFINITION] }];
const BENCH_HASHED_SONGS = [{ song: BENCH_SONG, md5: BENCH_SONG_MD5 }];
const BENCH_COURSE_LOOKUP = playerWebCoreApi.createSongHashLookup(BENCH_HASHED_SONGS);
const BENCH_COURSE_ENTRY = playerWebCoreApi.resolveCourseFolders(BENCH_COURSE_GROUPS, BENCH_COURSE_LOOKUP)[0]!
  .courses![0]!;
const BENCH_RANDOM_COURSE = parseBeatorajaRandomCourseData({
  name: 'Bench Random',
  stage: [{ sql: 'level >= 0' }],
  constraint: ['GAUGE_LR2'],
})!;
const BENCH_RANDOM_ENTRY = playerWebCoreApi.createRandomCourseEntry('Bench#r0', BENCH_RANDOM_COURSE);
const BENCH_LR2CRS_BYTES = new TextEncoder().encode(
  `<?xml version="1.0"?><courselist><course><title>Bench</title><line>7</line><type>2</type><hash>${'0'.repeat(32)}${BENCH_SONG_MD5}</hash></course></courselist>`,
);
const BENCH_BEATORAJA_FILES = new Map<string, BeatorajaSkinFileEntry>([
  ['sound/cursor.wav', BENCH_BYTES],
  ['sound/decide.wav', BENCH_BYTES],
  ['sound/cancel.wav', BENCH_BYTES],
  ['Bgm/select.ogg', BENCH_BYTES],
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
  define('player-web.applyBeatorajaStretchRect', {
    run: () => {
      playerWebCoreApi.applyBeatorajaStretchRect(
        { x: 0, y: 0, width: 320, height: 180 },
        { width: 128, height: 256 },
        2,
      );
    },
  });
  define('player-web.asLoadedBytes', {
    run: () => {
      playerWebCoreApi.asLoadedBytes(BENCH_BYTES);
    },
  });
  define('player-web.basename', {
    run: () => {
      playerWebCoreApi.basename('Songs/Bench/main.bms');
    },
  });
  define('player-web.buildAudioBus', {
    run: () => {
      const bus = playerWebCoreApi.buildAudioBus(createFakeAudioContext(), 'split');
      bus.setStageEnabled('master', false);
      bus.setMode('legacy');
      bus.dispose();
    },
  });
  define('player-web.BeatorajaBgaLayer', {
    run: () => {
      const layer = new playerWebCoreApi.BeatorajaBgaLayer({
        skin: makeBenchBeatorajaSkin(),
        textures: new Map(),
        cues: { base: [], layer: [], poor: [] },
      });
      layer.dispose();
    },
  });
  define('player-web.BeatorajaMarkerLayer', {
    run: () => {
      const layer = new playerWebCoreApi.BeatorajaMarkerLayer({
        group: [],
        bpm: [],
        stop: [],
        time: [],
        images: new Map(),
        textures: makeEmptyBeatorajaTextureCache(),
        canvasHeight: 720,
      });
      layer.dispose();
    },
  });
  define('player-web.BeatorajaNoteLayer', {
    run: () => {
      const layer = new playerWebCoreApi.BeatorajaNoteLayer({
        noteSection: makeBenchBeatorajaNoteSection(),
        variant: '7',
        images: new Map(),
        textures: makeEmptyBeatorajaTextureCache(),
        canvasHeight: 720,
      });
      layer.dispose();
    },
  });
  define('player-web.resolveBeatorajaNoteLane', {
    run: () => {
      playerWebCoreApi.resolveBeatorajaNoteLane('1Q', '24');
      playerWebCoreApi.resolveBeatorajaNoteLane('2P', '48');
      playerWebCoreApi.resolveBeatorajaNoteLane('16', '7');
    },
  });
  define('player-web.beatorajaPixelsPerBeat', {
    run: () => {
      playerWebCoreApi.beatorajaPixelsPerBeat(580, 2.5);
    },
  });
  define('player-web.snapHiSpeed', {
    run: () => {
      playerWebCoreApi.snapHiSpeed(1.3000000000000003);
      playerWebCoreApi.snapHiSpeed(42);
    },
  });
  define('player-web.lr2LastWalkedBeat', {
    run: () => {
      playerWebCoreApi.lr2LastWalkedBeat({ rules: 'lr2', lastBeat: 32 }, 145);
      playerWebCoreApi.lr2LastWalkedBeat({ rules: 'beatoraja', lastBeat: 32 }, 145);
    },
  });
  define('player-web.beatorajaDisplayScrollBeat', {
    run: () => {
      playerWebCoreApi.beatorajaDisplayScrollBeat({ currentBeat: 24, displayBeat: 8 });
      playerWebCoreApi.beatorajaDisplayScrollBeat({ currentBeat: 24 });
    },
  });
  define('player-web.BeatorajaPlaySkinView', {
    run: () => {
      const view = new playerWebCoreApi.BeatorajaPlaySkinView({
        skin: makeBenchBeatorajaSkin(),
        textures: makeEmptyBeatorajaTextureCache(),
      });
      view.update({
        activeOps: new Set(),
        getTimerStart: () => 0,
        nowMs: 0,
      });
      view.dispose();
    },
    interactive: true,
  });
  define('player-web.BeatorajaRuntimeAdapter', {
    run: () => {
      const adapter = new playerWebCoreApi.BeatorajaRuntimeAdapter({
        chartPlayVariant: '7',
        baseOps: new Set(),
        getNowMs: () => 1000,
        chart: BENCH_SONG.chart,
        directoryLabel: BENCH_SONG.directoryLabel,
      });
      adapter.getRenderContext();
      adapter.reset();
    },
  });
  define('player-web.BeatorajaSkinAudioPlayer', {
    run: () => {
      const player = new playerWebCoreApi.BeatorajaSkinAudioPlayer({ files: BENCH_BEATORAJA_FILES });
      player.play('sound/missing.wav', 1);
      player.stop('sound/missing.wav');
      player.dispose();
    },
  });
  define('player-web.blendCodeToPixi', {
    run: () => {
      playerWebCoreApi.blendCodeToPixi(3);
      playerWebCoreApi.blendCodeToPixi(9);
    },
  });
  define('player-web.BrowserSongCollectionStore', {
    run: async () => {
      const store = new playerWebCoreApi.BrowserSongCollectionStore();
      await store.loadFromFiles([BENCH_BMS_FILE]);
      await store.appendFromFiles([BENCH_APPEND_BMS_FILE]);
    },
  });
  define('player-web.ChartPreviewEngine', {
    run: () => {
      const node = createFakeAudioNode();
      const engine = new playerWebCoreApi.ChartPreviewEngine(createFakeAudioContext(), node, { focusDelayMs: 1 });
      engine.stop();
      engine.dispose();
    },
  });
  define('player-web.checkBrowserCompat', {
    run: () => {
      playerWebCoreApi.checkBrowserCompat();
    },
  });
  define('player-web.collectChartPreviewTriggers', {
    run: (fixtures) => {
      playerWebCoreApi.collectChartPreviewTriggers(fixtures.sampleBmsJson, 3);
    },
  });
  define('player-web.computeBeatorajaChartMarkers', {
    run: (fixtures) => {
      playerWebCoreApi.computeBeatorajaChartMarkers(fixtures.sampleBmsJson, {
        timeIntervalSec: 1,
        totalSeconds: 5,
      });
    },
  });
  define('player-web.computeChartFileSha256', {
    run: async () => {
      await playerWebCoreApi.computeChartFileSha256(BENCH_SOURCE, 'Songs/Bench/main.bms');
    },
  });
  define('player-web.computeChartFileHashes', {
    run: async () => {
      await playerWebCoreApi.computeChartFileHashes(BENCH_SOURCE, 'Songs/Bench/main.bms');
    },
  });
  define('player-web.md5HexOfBytes', {
    run: () => {
      playerWebCoreApi.md5HexOfBytes(BENCH_BYTES);
    },
  });
  define('player-web.computeSha256Hex', {
    run: async () => {
      await playerWebCoreApi.computeSha256Hex(BENCH_BYTES);
    },
  });
  define('player-web.createAudioService', {
    run: async () => {
      const service = playerWebCoreApi.createAudioService({ createContext: () => BENCH_SYSTEM_AUDIO_CONTEXT });
      service.setTheme({ sounds: { cursor: { bytes: BENCH_BYTES } } });
      await service.playCue('cursor', { owner: BENCH_AUDIO_OWNER });
      service.stopOwned(BENCH_AUDIO_OWNER);
      service.dispose();
    },
  });
  define('player-web.createDecideScene', {
    run: async () => {
      const kits: playerWebCoreApi.DecideSceneKit[] = [
        { family: 'built-in', skin: playerWebCoreApi.phantomSkin },
        { family: 'lr2', skin: BENCH_LR2_DECIDE_SKIN },
        {
          family: 'beatoraja',
          kit: { skin: makeBenchBeatorajaSkin(), textures: makeEmptyBeatorajaTextureCache(), files: new Map() },
        },
      ];
      for (const kit of kits) {
        const scene = playerWebCoreApi.createDecideScene(kit, {
          chart: BENCH_SONG,
          sounds: { decideBgm: { bytes: BENCH_BYTES } },
          audio: playerWebCoreApi.createAudioService({ createContext: () => undefined }),
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
  define('player-web.createResultScene', {
    run: () => {
      const kits: playerWebCoreApi.ResultSceneKit[] = [
        { family: 'built-in', skin: playerWebCoreApi.phantomSkin },
        { family: 'lr2', skin: BENCH_LR2_RESULT_SKIN },
        {
          family: 'beatoraja',
          kit: { skin: makeBenchBeatorajaSkin(), textures: makeEmptyBeatorajaTextureCache(), files: new Map() },
        },
      ];
      for (const kit of kits) {
        const scene = playerWebCoreApi.createResultScene(kit, {
          result: BENCH_PLAY_RESULT,
          sounds: { clear: { bytes: BENCH_BYTES } },
          audio: playerWebCoreApi.createAudioService({ createContext: () => undefined }),
          on: { continue: () => undefined, retry: () => undefined },
          keyTarget: BENCH_KEY_TARGET,
          now: () => 0,
        });
        scene.exit();
        scene.dispose();
      }
    },
  });
  define('player-web.createPlayScene', {
    run: () => {
      const scene = playerWebCoreApi.createPlayScene(
        { family: 'built-in', skin: playerWebCoreApi.phantomSkin },
        {
          chart: BENCH_SONG,
          settings: { autoPlay: true },
          audio: playerWebCoreApi.createAudioService({ createContext: () => undefined }),
          on: { finish: () => undefined, exit: () => undefined, restart: () => undefined },
          keyTarget: BENCH_KEY_TARGET,
          now: () => 0,
        },
      );
      scene.getHiSpeed();
      scene.dispose();
    },
  });
  define('player-web.createSkinFamilyRegistry', {
    run: () => {
      const registry = playerWebCoreApi.createSkinFamilyRegistry([
        { id: 'default', label: 'Default' },
        { id: 'lr2', label: 'LR2', matchesThemeFile: (path) => path.endsWith('.lr2skin') },
        { id: 'beatoraja', label: 'beatoraja', matchesThemeFile: (path) => path.endsWith('.luaskin') },
      ]);
      registry.byId('lr2');
      registry.detectThemeFile('Theme/play_7.lr2skin');
      registry.detectThemeFamilies(['Theme/play_7.lr2skin', 'Skin/play7.luaskin']);
    },
  });
  define('player-web.createEagerDropPathPredicate', {
    run: () => {
      const isEager = playerWebCoreApi.createEagerDropPathPredicate([
        'Songs/Example/main.bms',
        'Songs/Example/kick.wav',
        'Theme/play_7.lr2skin',
      ]);
      isEager('Songs/Example/kick.wav');
      isEager('Theme/play_7.lr2skin');
    },
  });
  define('player-web.createBeMusicSkinRegistry', {
    run: () => {
      const registry = playerWebCoreApi.createBeMusicSkinRegistry([playerWebCoreApi.phantomSkin]);
      registry.resolve('phantom');
      registry.resolve('missing');
    },
  });
  define('player-web.resolveBeMusicLaneKind', {
    run: () => {
      playerWebCoreApi.resolveBeMusicLaneKind('16', 0, '7');
      playerWebCoreApi.resolveBeMusicLaneKind('12', 2, '7');
      playerWebCoreApi.resolveBeMusicLaneKind('1D', -1, '24');
    },
  });
  define('player-web.resolveBeMusicSkinSettings', {
    run: () => {
      playerWebCoreApi.resolveBeMusicSkinSettings(
        {
          settings: [
            {
              kind: 'choice',
              id: 'theme',
              label: 'Theme',
              options: [{ value: 'dark', label: 'Dark' }],
              default: 'dark',
            },
            { kind: 'number', id: 'offset', label: 'Offset', min: -50, max: 50, step: 1, default: 0, unit: 'px' },
            { kind: 'toggle', id: 'glow', label: 'Glow', default: true },
          ],
        },
        { theme: 'light', offset: 80, glow: false, stale: 1 },
      );
    },
  });
  define('player-web.resolveSelectListWindow', {
    run: () => {
      playerWebCoreApi.resolveSelectListWindow(playerWebCoreApi.phantomSkin.select.layout, 480, 50, 100);
    },
  });
  define('player-web.createCroppedBeatorajaTexture', {
    run: () => {
      playerWebCoreApi.createCroppedBeatorajaTexture(undefined, { x: 0, y: 0, w: 16, h: 16 });
    },
  });
  define('player-web.DefaultPixiSongSelectView', {
    run: () => {
      new playerWebCoreApi.DefaultPixiSongSelectView();
    },
    interactive: true,
  });
  define('player-web.destinationToSpriteProps', {
    run: () => {
      playerWebCoreApi.destinationToSpriteProps(
        BENCH_BEATORAJA_DESTINATION,
        { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 },
        720,
      );
    },
  });
  define('player-web.DeferredDroppedFile', {
    run: async () => {
      const file = new playerWebCoreApi.DeferredDroppedFile(BENCH_DROPPED_ENTRY, 'Songs/Bench/kick.wav');
      await file.arrayBuffer();
    },
  });
  define('player-web.describeSongCollection', {
    run: () => {
      playerWebCoreApi.describeSongCollection(BENCH_COLLECTION);
    },
  });
  define('player-web.dirname', {
    run: () => {
      playerWebCoreApi.dirname('Songs/Bench/main.bms');
    },
  });
  define('player-web.downloadBlob', {
    run: () => {
      playerWebCoreApi.downloadBlob(new Blob([BENCH_BYTES]), 'bench.webm');
    },
    interactive: true,
  });
  define('player-web.findFirstAudibleOffsetSeconds', {
    run: () => {
      playerWebCoreApi.findFirstAudibleOffsetSeconds(makeAudioBufferLike());
    },
  });
  define('player-web.GameplayRecorder', {
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
  define('player-web.createNonstopAssets', {
    run: () => {
      const assets = playerWebCoreApi.createNonstopAssets([
        { chart: BENCH_SONG.chart, source: BENCH_SOURCE, chartPath: BENCH_SONG.chartPath },
        { chart: BENCH_SONG.chart, source: BENCH_SOURCE, chartPath: BENCH_SONG.chartPath },
      ]);
      assets.assetPath(0, 'wav', 'kick.wav');
      assets.assetPath(1, 'bmp', 'banner.png');
    },
  });
  define('player-web.isCourseFilePath', {
    run: () => {
      playerWebCoreApi.isCourseFilePath('Songs/dan.lr2crs');
      playerWebCoreApi.isCourseFilePath('beatoraja/course/dan.json');
      playerWebCoreApi.isCourseFilePath('beatoraja/folder/default.json');
      playerWebCoreApi.isCourseFilePath('Songs/Bench/info.json');
    },
  });
  define('player-web.readCourseFile', {
    run: () => {
      playerWebCoreApi.readCourseFile('Songs/dan.lr2crs', BENCH_LR2CRS_BYTES);
    },
  });
  define('player-web.createSongHashLookup', {
    run: () => {
      playerWebCoreApi.createSongHashLookup(BENCH_HASHED_SONGS);
    },
  });
  define('player-web.resolveCourseFolders', {
    run: () => {
      playerWebCoreApi.resolveCourseFolders(BENCH_COURSE_GROUPS, BENCH_COURSE_LOOKUP);
    },
  });
  define('player-web.createRandomCourseEntry', {
    run: () => {
      playerWebCoreApi.createRandomCourseEntry('Bench#r0', BENCH_RANDOM_COURSE);
    },
  });
  define('player-web.createCourseSongRecord', {
    run: () => {
      const record = playerWebCoreApi.createCourseSongRecord(BENCH_SONG, { md5: BENCH_SONG_MD5 });
      void record.level;
    },
  });
  define('player-web.drawBrowserRandomCourse', {
    run: () => {
      playerWebCoreApi.drawBrowserRandomCourse(BENCH_RANDOM_ENTRY, BENCH_HASHED_SONGS, () => 0);
    },
  });
  define('player-web.resolveSceneCourseInfo', {
    run: () => {
      playerWebCoreApi.resolveSceneCourseInfo(BENCH_COURSE_ENTRY, 0);
    },
  });
  define('player-web.resolveCourseEntry', {
    run: () => {
      playerWebCoreApi.resolveCourseEntry('Bench#0', BENCH_COURSE_DEFINITION, BENCH_COURSE_LOOKUP);
    },
  });
  define('player-web.createNewCourseEntry', {
    run: () => {
      playerWebCoreApi.createNewCourseEntry('nonstop');
    },
  });
  define('player-web.CourseMaker', {
    run: () => {
      const maker = new playerWebCoreApi.CourseMaker({ md5Of: async () => undefined });
      maker.start('expert');
      maker.finish();
    },
  });
  define('player-web.resolveCourseMakerFolders', {
    run: () => {
      playerWebCoreApi.resolveCourseMakerFolders([BENCH_COURSE_DEFINITION], BENCH_COURSE_LOOKUP);
    },
  });
  define('player-web.findBeatorajaThemeBgm', {
    run: async () => {
      await playerWebCoreApi.findBeatorajaThemeBgm(BENCH_BEATORAJA_THEME_BUNDLE);
    },
  });
  define('player-web.flipRectToPixi', {
    run: () => {
      playerWebCoreApi.flipRectToPixi({ x: 10, y: 20, w: 100, h: 50 }, 720);
    },
  });
  define('player-web.groupSongsByFolder', {
    run: () => {
      playerWebCoreApi.groupSongsByFolder([BENCH_SONG]);
    },
  });
  define('player-web.isBeatorajaLuaSkinFilePath', {
    run: () => {
      playerWebCoreApi.isBeatorajaLuaSkinFilePath('skin/bench/play7.luaskin');
    },
  });
  define('player-web.isBeatorajaSkinIndicator', {
    run: () => {
      playerWebCoreApi.isBeatorajaSkinIndicator('skin/bench/play7.json');
    },
  });
  define('player-web.isChartFilePath', {
    run: () => {
      playerWebCoreApi.isChartFilePath('Songs/Bench/main.bms');
    },
  });
  define('player-web.isInsideLr2DefaultSearchBox', {
    run: () => {
      playerWebCoreApi.isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 561 });
      playerWebCoreApi.isInsideLr2DefaultSearchBox({ width: 640, height: 480, x: 460, y: 561 });
    },
  });
  define('player-web.isLr2SkinFilePath', {
    run: () => {
      playerWebCoreApi.isLr2SkinFilePath('theme/play_7.lr2skin');
    },
  });
  define('player-web.loadAssetBytes', {
    run: async () => {
      await playerWebCoreApi.loadAssetBytes(BENCH_BYTES);
    },
  });
  define('player-web.loadBeatorajaChartImages', {
    run: async () => {
      // The bench chart has no images, so the source is walked without decoding anything.
      await playerWebCoreApi.loadBeatorajaChartImages(BENCH_SONG, BENCH_SOURCE);
    },
  });
  define('player-web.resolveBeatorajaChartImage', {
    run: () => {
      playerWebCoreApi.resolveBeatorajaChartImage({}, -100);
      playerWebCoreApi.resolveBeatorajaChartImage(undefined, -102);
    },
  });
  define('player-web.loadBeatorajaFonts', {
    run: async () => {
      const cache = await playerWebCoreApi.loadBeatorajaFonts({
        files: BENCH_BEATORAJA_FILES,
        entryPath: 'skin/bench/play7.json',
        fonts: [],
      });
      cache.dispose();
    },
  });
  define('player-web.loadBeatorajaTexturesFromBundle', {
    run: async () => {
      await playerWebCoreApi.loadBeatorajaTexturesFromBundle(BENCH_BEATORAJA_SOURCE_BUNDLE);
    },
  });
  define('player-web.loadBeatorajaThemeFromFiles', {
    run: async () => {
      await playerWebCoreApi.loadBeatorajaThemeFromFiles([]);
    },
  });
  define('player-web.createBeatorajaSceneKitCaches', {
    run: () => {
      playerWebCoreApi.createBeatorajaSceneKitCaches();
    },
  });
  define('player-web.defaultBeatorajaSkinConfig', {
    run: () => {
      playerWebCoreApi.defaultBeatorajaSkinConfig(
        BENCH_BEATORAJA_KIT_HEADER,
        BENCH_BEATORAJA_KIT_FILES,
        BENCH_BEATORAJA_KIT_ENTRY_PATH,
      );
    },
  });
  define('player-web.resolveBeatorajaSkinConfig', {
    run: () => {
      const caches = playerWebCoreApi.createBeatorajaSceneKitCaches();
      playerWebCoreApi.resolveBeatorajaSkinConfig(
        caches,
        BENCH_BEATORAJA_KIT_ENTRY_PATH,
        BENCH_BEATORAJA_KIT_HEADER,
        BENCH_BEATORAJA_KIT_FILES,
      );
      playerWebCoreApi.resolveBeatorajaSkinConfig(
        caches,
        BENCH_BEATORAJA_KIT_ENTRY_PATH,
        BENCH_BEATORAJA_KIT_HEADER,
        BENCH_BEATORAJA_KIT_FILES,
      );
    },
  });
  define('player-web.createBeatorajaSkinLoadContext', {
    run: () => {
      const context = playerWebCoreApi.createBeatorajaSkinLoadContext({
        difficulty: 4,
        skinConfig: { option: { 'Bench Option': 901 } },
      });
      context.option?.(901);
    },
  });
  define('player-web.loadBeatorajaSceneKit', {
    run: async () => {
      const caches = playerWebCoreApi.createBeatorajaSceneKitCaches();
      await playerWebCoreApi.loadBeatorajaSceneKit({
        files: BENCH_BEATORAJA_KIT_FILES,
        entryPath: BENCH_BEATORAJA_KIT_ENTRY_PATH,
        caches,
      });
      playerWebCoreApi.releaseBeatorajaSceneKitAssets(caches);
    },
  });
  define('player-web.releaseBeatorajaSceneKitAssets', {
    run: () => {
      playerWebCoreApi.releaseBeatorajaSceneKitAssets(playerWebCoreApi.createBeatorajaSceneKitCaches());
    },
  });
  define('player-web.logger', {
    run: () => {
      playerWebCoreApi.logger('bench');
    },
  });
  define('player-web.loadSongCollectionFromDrop', {
    run: async () => {
      await playerWebCoreApi.loadSongCollectionFromDrop({
        files: [BENCH_BMS_FILE, BENCH_WAV_FILE],
      } as unknown as DataTransfer);
    },
  });
  define('player-web.loadSongCollectionFromFiles', {
    run: async () => {
      await playerWebCoreApi.loadSongCollectionFromFiles([BENCH_BMS_FILE, BENCH_WAV_FILE]);
    },
  });
  define('player-web.loadTextureFromBytes', {
    run: async () => {
      await playerWebCoreApi.loadTextureFromBytes('bench.png', BENCH_BYTES);
    },
    interactive: true,
  });
  define('player-web.makeWebmSeekable', {
    run: async () => {
      await playerWebCoreApi.makeWebmSeekable(new Blob([BENCH_BYTES]));
    },
    interactive: true,
  });
  define('player-web.materializeDroppedFiles', {
    run: async () => {
      await playerWebCoreApi.materializeDroppedFiles([
        BENCH_BMS_FILE,
        new playerWebCoreApi.DeferredDroppedFile(BENCH_DROPPED_ENTRY, 'Songs/Bench/kick.wav'),
      ]);
    },
  });
  define('player-web.matchesSearchQuery', {
    run: () => {
      playerWebCoreApi.matchesSearchQuery({ kind: 'song', song: BENCH_SONG }, 'bench');
    },
  });
  define('player-web.normalizePath', {
    run: () => {
      playerWebCoreApi.normalizePath(String.raw`Songs\\Bench/../Bench/main.bms`);
    },
  });
  define('player-web.parseCompressorMode', {
    run: () => {
      playerWebCoreApi.parseCompressorMode('split');
    },
  });
  define('player-web.sanitizeBusVolume', {
    run: () => {
      playerWebCoreApi.sanitizeBusVolume(0.75);
    },
  });
  define('player-web.mergeCompressorParams', {
    run: () => {
      playerWebCoreApi.mergeCompressorParams(playerWebCoreApi.KEY_BUS_COMPRESSOR_PARAMS, {
        threshold: -12,
        attack: 0.02,
      });
    },
  });
  define('player-web.parsePlaylog', {
    run: () => {
      playerWebCoreApi.parsePlaylog(BENCH_PLAYLOG_JSON);
    },
  });
  define('player-web.resolvePlaylogFilename', {
    run: () => {
      playerWebCoreApi.resolvePlaylogFilename(BENCH_PLAYLOG);
    },
  });
  define('player-web.checkPlaylogEligibility', {
    run: () => {
      playerWebCoreApi.checkPlaylogEligibility(BENCH_PLAYLOG);
    },
  });
  define('player-web.serializePlaylog', {
    run: () => {
      playerWebCoreApi.serializePlaylog(BENCH_PLAYLOG);
    },
  });
  define('player-web.shouldCaptureFrame', {
    run: () => {
      playerWebCoreApi.shouldCaptureFrame(1033.3, 1000, 30);
    },
  });
  define('player-web.resolveCaptureSize', {
    run: () => {
      playerWebCoreApi.resolveCaptureSize(2944, 2108, { width: 1920, height: 1080 });
    },
  });
  define('player-web.alignAudioChunk', {
    run: () => {
      playerWebCoreApi.alignAudioChunk(47_000, 4096, 48_000, 48_000);
    },
  });
  define('player-web.resolveFrameTimestamp', {
    run: () => {
      playerWebCoreApi.resolveFrameTimestamp(12.5, 10, 2.48);
    },
  });
  define('player-web.supportsWebCodecsRecording', {
    run: () => {
      playerWebCoreApi.supportsWebCodecsRecording({} as BaseAudioContext);
    },
  });
  define('player-web.sanitizeMasterVolume', {
    run: () => {
      playerWebCoreApi.sanitizeMasterVolume(1.5);
    },
  });
  define('player-web.setMasterVolume', {
    run: () => {
      playerWebCoreApi.setMasterVolume(1);
    },
  });
  define('player-web.getMasterVolume', {
    run: () => {
      playerWebCoreApi.getMasterVolume();
    },
  });
  define('player-web.masterOutput', {
    run: () => {
      playerWebCoreApi.masterOutput(BENCH_AUDIO_CONTEXT);
    },
  });
  define('player-web.getSystemAudioSession', {
    run: () => {
      playerWebCoreApi.getSystemAudioSession(BENCH_AUDIO_SESSION_HOST);
    },
  });
  define('player-web.supportsSystemAudioSession', {
    run: () => {
      playerWebCoreApi.supportsSystemAudioSession(BENCH_AUDIO_SESSION_HOST);
    },
  });
  define('player-web.applySystemAudioSessionType', {
    run: () => {
      playerWebCoreApi.applySystemAudioSessionType('ambient', BENCH_AUDIO_SESSION_HOST);
      playerWebCoreApi.applySystemAudioSessionType('auto', BENCH_AUDIO_SESSION_HOST);
    },
  });
  define('player-web.resolveSilentModeAudioSessionType', {
    run: () => {
      playerWebCoreApi.resolveSilentModeAudioSessionType(true);
      playerWebCoreApi.resolveSilentModeAudioSessionType(false);
    },
  });
  define('player-web.applySilentModePlayback', {
    run: () => {
      playerWebCoreApi.applySilentModePlayback(true, BENCH_AUDIO_SESSION_HOST);
      playerWebCoreApi.applySilentModePlayback(false, BENCH_AUDIO_SESSION_HOST);
    },
  });
  define('player-web.pickRecorderMimeType', {
    run: () => {
      playerWebCoreApi.pickRecorderMimeType((type) => type === 'video/webm');
    },
  });
  define('player-web.recorderMimeCandidates', {
    run: () => {
      playerWebCoreApi.recorderMimeCandidates({ container: 'mp4', videoCodec: 'avc' });
    },
  });
  define('player-web.recordingVideoCodecs', {
    run: () => {
      playerWebCoreApi.recordingVideoCodecs({ container: 'webm', videoCodec: 'vp8' });
    },
  });
  define('player-web.recordingAudioCodecs', {
    run: () => {
      playerWebCoreApi.recordingAudioCodecs('mp4');
    },
  });
  define('player-web.describeRecordingFormat', {
    run: () => {
      playerWebCoreApi.describeRecordingFormat({ container: 'mp4', videoCodec: 'hevc' });
    },
  });
  define('player-web.recordingFileExtension', {
    run: () => {
      playerWebCoreApi.recordingFileExtension('video/mp4;codecs=avc1,mp4a.40.2');
    },
  });
  define('player-web.chartPlayVariantForBeatorajaVariant', {
    run: () => {
      playerWebCoreApi.chartPlayVariantForBeatorajaVariant('7');
      playerWebCoreApi.chartPlayVariantForBeatorajaVariant('24d');
    },
  });
  define('player-web.pickBeatorajaPlayableSkinVariant', {
    run: () => {
      playerWebCoreApi.pickBeatorajaPlayableSkinVariant(BENCH_BEATORAJA_PLAY_SKINS, '7');
    },
  });
  define('player-web.pickBeatorajaPlayableVariant', {
    run: () => {
      playerWebCoreApi.pickBeatorajaPlayableVariant({ keys: 7, isDouble: false, isPms: false });
      playerWebCoreApi.pickBeatorajaPlayableVariant({ keys: 9, isDouble: false, isPms: true });
    },
  });
  define('player-web.PixiBeatorajaGameplayView', {
    run: () => {
      new playerWebCoreApi.PixiBeatorajaGameplayView(
        {} as ConstructorParameters<typeof playerWebCoreApi.PixiBeatorajaGameplayView>[0],
      );
    },
    interactive: true,
  });
  define('player-web.PixiBeatorajaSelectScene', {
    run: () => {
      new playerWebCoreApi.PixiBeatorajaSelectScene(
        {} as ConstructorParameters<typeof playerWebCoreApi.PixiBeatorajaSelectScene>[0],
      );
    },
    interactive: true,
  });
  define('player-web.PixiSceneHost', {
    run: () => {
      new playerWebCoreApi.PixiSceneHost();
    },
    interactive: true,
  });
  define('player-web.SessionScene', {
    run: async () => {
      const scene = new playerWebCoreApi.SessionScene(BENCH_SCENE_SESSION, BENCH_FAMILY_VIEW, { now: () => 0 });
      await scene.enter(BENCH_SCENE_HOST);
      scene.exit();
      scene.dispose();
    },
  });
  define('player-web.PixiSongSelectView', {
    run: () => {
      new playerWebCoreApi.PixiSongSelectView();
    },
    interactive: true,
  });
  define('player-web.prepareBeatorajaGameplayChart', {
    run: async () => {
      await playerWebCoreApi.prepareBeatorajaGameplayChart({
        song: BENCH_SONG,
        source: BENCH_SOURCE,
      });
    },
    interactive: true,
  });
  define('player-web.readDroppedFiles', {
    run: async () => {
      await playerWebCoreApi.readDroppedFiles({ files: [BENCH_BMS_FILE] } as unknown as DataTransfer);
    },
  });
  define('player-web.readFilesIntoBytesMap', {
    ioBound: true,
    run: async () => {
      await playerWebCoreApi.readFilesIntoBytesMap([BENCH_BMS_FILE], { deferAudio: false });
    },
  });
  define('player-web.resolveChartAsset', {
    run: () => {
      playerWebCoreApi.resolveChartAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'kick.wav');
    },
  });
  define('player-web.resolveChartAudioAsset', {
    run: () => {
      playerWebCoreApi.resolveChartAudioAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'kick.wav');
    },
  });
  define('player-web.resolveChartBgaAsset', {
    run: () => {
      playerWebCoreApi.resolveChartBgaAsset(BENCH_SOURCE, BENCH_SONG.chartPath, '_bga.mpg');
    },
  });
  define('player-web.resolveChartImageAsset', {
    run: () => {
      playerWebCoreApi.resolveChartImageAsset(BENCH_SOURCE, BENCH_SONG.chartPath, 'banner.bmp');
    },
  });
  define('player-web.resolveChartPlayVariant', {
    run: () => {
      playerWebCoreApi.resolveChartPlayVariant(BENCH_SONG);
      playerWebCoreApi.resolveChartPlayVariant(BENCH_PMS_SONG);
    },
  });
  define('player-web.resolveChartPreviewPath', {
    run: (fixtures) => {
      playerWebCoreApi.resolveChartPreviewPath(fixtures.sampleBmsJson);
    },
  });
  define('player-web.resolveDropFilePath', {
    run: () => {
      playerWebCoreApi.resolveDropFilePath(BENCH_BMS_FILE);
    },
  });
  define('player-web.resolveRendererPreference', {
    run: () => {
      playerWebCoreApi.resolveRendererPreference('?renderer=webgl');
    },
  });
  define('player-web.resolveRenderResolution', {
    run: () => {
      playerWebCoreApi.resolveRenderResolution(2, '?resolution=1.5');
    },
  });
  // Both `renderDefaultGameplayFrame` (canonical, added in 94d425e) and its backwards-compatibility alias
  // `renderFallbackLr2Frame` ultimately construct Pixi v8 `Text` objects whose layout measurement reaches for
  // `document.createElement('canvas')`. The bench harness runs under raw Node so `document` is undefined and
  // the call throws. Mark both cases `interactive: true` so they're skipped in non-interactive bench runs (the
  // coverage checker still sees a case for each export). Restore once the harness gets a DOM-equipped Pixi
  // shim.
  define('player-web.renderFallbackLr2Frame', {
    run: () => {
      const layer = new Container();
      playerWebCoreApi.renderFallbackLr2Frame(layer, {
        songTitle: 'Bench Song',
        bpm: 130,
        hiSpeed: 2.5,
        score: 75_000,
        exScore: 150,
        exScoreMax: 200,
        combo: 90,
        rank: 'AA',
      });
      layer.destroy({ children: true, context: true });
    },
    interactive: true,
  });
  define('player-web.renderDefaultGameplayFrame', {
    run: () => {
      const layer = new Container();
      playerWebCoreApi.renderDefaultGameplayFrame(layer, {
        songTitle: 'Bench Song',
        bpm: 130,
        hiSpeed: 2.5,
        score: 75_000,
        exScore: 150,
        exScoreMax: 200,
        combo: 90,
        rank: 'AA',
      });
      layer.destroy({ children: true, context: true });
    },
    interactive: true,
  });
  define('player-web.Rectangle', {
    run: () => {
      new playerWebCoreApi.Rectangle(0, 0, 320, 180);
    },
  });
  define('player-web.resolveSongSource', {
    run: () => {
      playerWebCoreApi.resolveSongSource(BENCH_COLLECTION, BENCH_SONG);
    },
  });
  define('player-web.splitDroppedSongAndThemeFiles', {
    run: () => {
      playerWebCoreApi.splitDroppedSongAndThemeFiles([
        { name: 'main.bms', webkitRelativePath: 'Songs/Example/main.bms' },
        { name: 'kick.wav', webkitRelativePath: 'Songs/Example/kick.wav' },
        { name: 'play_7.lr2skin', webkitRelativePath: 'Theme/play_7.lr2skin' },
      ]);
    },
  });
  define('player-web.summarizeBrowserCompat', {
    run: () => {
      playerWebCoreApi.summarizeBrowserCompat({
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
  define('player-web.summarizeBeatorajaPlaySkins', {
    run: () => {
      playerWebCoreApi.summarizeBeatorajaPlaySkins(BENCH_BEATORAJA_PLAY_SKINS);
    },
  });
  define('player-web.wrappedCursorDelta', {
    run: () => {
      playerWebCoreApi.wrappedCursorDelta(-9, 10);
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

function makeBenchPlaylog(): playerWebCoreApi.BeMusicPlaylog {
  return {
    format: 'be-music-playlog',
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      title: 'Bench Song',
      sourceFormat: 'bms',
      laneMode: '7keys',
      total: 300,
      lnMode: 1,
      judgeRank: { percent: 75, sourceRank: 2 },
      noteCount: 32,
      notes: Array.from({ length: 32 }, (_, index) => ({
        id: index,
        channel: `1${(index % 7) + 1}`,
        type: 'normal' as const,
        timeUs: 250_000 * (index + 1),
      })),
    },
    inputs: Array.from({ length: 64 }, (_, index) => ({
      seq: index,
      timeUs: 125_000 * (index + 1),
      action: index % 2 === 0 ? ('down' as const) : ('up' as const),
      channels: [`1${((index >> 1) % 7) + 1}`],
    })),
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
  };
}

function makeBenchPmsSong(): playerWebCoreApi.BrowserSongEntry {
  const chart: BeMusicJson = createEmptyJson('bms');
  chart.metadata.title = 'Bench PMS Song';
  chart.bms.player = 3;
  chart.events = [
    { measure: 0, position: [0, 1], channel: '11', value: '01' },
    { measure: 0, position: [0, 1], channel: '17', value: '01' },
    { measure: 0, position: [0, 1], channel: '19', value: '01' },
  ];
  chart.resources.wav = { '01': 'kick.wav' };
  return {
    id: 'files:bench:Songs/Bench/main.pms',
    sourceId: 'files:bench',
    sourceLabel: 'Bench',
    sourceKind: 'directory',
    chartPath: 'Songs/Bench/main.pms',
    directoryLabel: 'Songs/Bench',
    fileLabel: 'main.pms',
    title: 'Bench PMS Song',
    totalNotes: 3,
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

function makeBenchBeatorajaNoteSection(): ConstructorParameters<
  typeof playerWebCoreApi.BeatorajaNoteLayer
>[0]['noteSection'] {
  return {
    id: 'notes',
    dst: [],
  } as unknown as ConstructorParameters<typeof playerWebCoreApi.BeatorajaNoteLayer>[0]['noteSection'];
}

function makeEmptyBeatorajaTextureCache(): playerWebCoreApi.BeatorajaTextureCache {
  const textures = new Map<never, NonNullable<ReturnType<playerWebCoreApi.BeatorajaTextureCache['get']>>>();
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
