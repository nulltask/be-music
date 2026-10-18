import { readFileSync } from 'node:fs';
import * as skinApi from '@be-music/beatoraja-skin';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';
import { registerBeatorajaSkinSceneExportsCases } from './scene-exports-cases.ts';

// The cases measure the main entry: the skin parser, the element normalizers a skin view runs once per skin load, the
// per-frame element helpers (animation frames, digit cells, destinations, offsets, gauge nodes) and the theme loader.
// They run on the beatoraja default theme the unit tests use (`src/__fixtures__`), mounted as a theme folder with a
// placeholder byte string per image and font it names. `scene-exports-cases.ts` measures `/scene`.

type SkinRecord = Readonly<Record<string, unknown>>;

const FIXTURE_DIR = new URL('../src/__fixtures__/', import.meta.url);
const THEME_DIR = 'skin/default';
const PLAY5_PATH = `${THEME_DIR}/play5.json`;
const DECIDE_DIR = `${THEME_DIR}/decide`;
const DECIDE_PATH = `${DECIDE_DIR}/decide.luaskin`;
// Every image and font `play5.json` and the decide skin name, one file per wildcard directory.
const THEME_ASSET_PATHS = [
  'system.png',
  'playbg.png',
  'gauge.png',
  'judge.png',
  'number.png',
  'close.png',
  'scoregraph.png',
  'bomb.png',
  'ready.png',
  'judgedetail.png',
  'VL-Gothic-Regular.ttf',
  'play/background/default.png',
  'play/laser/default.png',
  'play/notes/default.png',
  'play/lanecover/default.png',
];
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Lua closures as a skin authors them: a draw condition, a number and a text property, and the custom events and
// timers a skin view evaluates every frame.
const BENCH_LUA_SOURCE = [
  'local main_state = require("main_state")',
  'return {',
  '  draw = function() return main_state.gauge() >= 80 end,',
  '  value = function() return main_state.number(71) * 2 end,',
  '  text = function() return main_state.text(12) end,',
  '  customEvents = {',
  '    { id = 1000, condition = function() return main_state.gauge() >= 80 end, action = function() end, minInterval = 100 },',
  '    { id = 1001, condition = 920, action = function() end },',
  '  },',
  '  customTimers = { { id = 10000, timer = function() return main_state.time() end } },',
  '}',
].join('\n');
const BENCH_LUA_CONTEXT: skinApi.BeatorajaLuaRuntimeContext = {
  option: (id) => id === 920,
  number: (id) => (id === 71 ? 650 : 0),
  text: () => 'Bench',
  gauge: () => 82,
  time: () => 64_500_000,
};

const BENCH_FLOAT_VALUE_INPUT = [
  {
    id: 'accuracy',
    src: 5,
    x: 0,
    y: 0,
    w: 264,
    h: 24,
    divx: 11,
    digit: 4,
    iketa: 3,
    fketa: 2,
    gain: 0.01,
    isSignvisible: true,
    zeropadding: 1,
    align: 2,
    ref: 102,
  },
];
const BENCH_GAUGE_GRAPH_INPUT = [{ id: 'gaugegraph', color: ['ff8888', '442222', 'ff00ff', '440044'] }];
const BENCH_TIMING_VISUALIZER_INPUT = [
  { id: 'timing', width: 301, judgeWidthMillis: 150, lineWidth: 1, drawDecay: 1, pgColor: '00ffff' },
];
const BENCH_TIMING_DISTRIBUTION_INPUT = [
  { id: 'timing-distribution', width: 301, lineWidth: 1, drawAverage: 1, drawDev: 1, graphColor: 'ffffff' },
];
const BENCH_PM_CHARA_INPUT = [
  { id: 'dstPMchara1P', src: 'srcPMchara1P', color: 1, type: 0, side: 1 },
  { id: 'dstPMchara2P', src: 'srcPMchara2P', color: 1, type: 0, side: 2 },
  { id: 'dstPMchara1PBG', src: 'srcPMchara1P', color: 1, type: 1 },
];
const BENCH_CUSTOM_OFFSET_INPUT = [
  { name: 'Judge position', id: 40, x: true, y: true },
  { name: 'Lane cover', id: 41, y: true, a: 1 },
  { name: 'Score graph', id: 42, x: true, w: true, h: true },
];
const BENCH_OFFSETS = new Map<number, skinApi.BeatorajaSkinOffsetValue>([
  [skinApi.OFFSET_ALL, { x: 4, y: -2, w: 0, h: 0, r: 0, a: 0 }],
  [skinApi.OFFSET_LIFT, { x: 0, y: 72, w: 0, h: 0, r: 0, a: 0 }],
  [skinApi.OFFSET_JUDGE_1P, { x: 0, y: 12, w: 8, h: 4, r: 0, a: -64 }],
]);
const BENCH_OFFSET_IDS = [skinApi.OFFSET_ALL, skinApi.OFFSET_LIFT, skinApi.OFFSET_JUDGE_1P];
const resolveBenchOffset = (id: number): skinApi.BeatorajaSkinOffsetValue | undefined => BENCH_OFFSETS.get(id);
const BENCH_GAUGE_STATE: skinApi.BeatorajaGaugeState = {
  value: 82,
  max: 100,
  border: 80,
  mode: skinApi.BEATORAJA_GAUGE_MODE.NORMAL,
};
const BENCH_ASSET_ENTRY = PNG_SIGNATURE;
const BENCH_LUA_ERROR: skinApi.BeatorajaLuaEvaluationError = {
  message: 'decidemain.lua:42: attempt to index a nil value',
};

interface RootFixtures {
  play5Text: string;
  play5Bytes: Uint8Array;
  play5: SkinRecord;
  play5Header: skinApi.BeatorajaSkinHeader;
  select: SkinRecord;
  files: Map<string, skinApi.BeatorajaSkinFileEntry>;
  inputFiles: skinApi.BeatorajaSkinInputFile[];
  decideEntry: Uint8Array;
  decideModules: skinApi.BeatorajaLuaModuleSource[];
  playSkins: skinApi.BeatorajaPlaySkinMap;
  play5Entry: skinApi.BeatorajaSkinEntry;
  defaultOptions: Record<string, number>;
  defaultFiles: Record<string, string>;
  activeOps: Set<number>;
  image: skinApi.BeatorajaImageElement;
  values: skinApi.BeatorajaValueElement[];
  value: skinApi.BeatorajaValueElement;
  floatValue: skinApi.BeatorajaFloatValueElement;
  judges: skinApi.BeatorajaJudgeElement[];
  gauge: skinApi.BeatorajaGaugeElement;
  note: skinApi.BeatorajaNoteSection;
  destination: skinApi.BeatorajaDestinationGroup;
  luaTable: SkinRecord;
  luaDraw: skinApi.BeatorajaLuaFunctionValue;
  luaValue: skinApi.BeatorajaLuaFunctionValue;
  luaText: skinApi.BeatorajaLuaFunctionValue;
  customEvents: skinApi.BeatorajaCustomEvent[];
  customEventState: skinApi.BeatorajaCustomEventState[];
  customTimers: skinApi.BeatorajaCustomTimer[];
  customTimerState: number[];
}

let rootFixtures: RootFixtures | undefined;

/** Built on first use, so a run that skips this package does not read or parse the theme. */
function fixtures(): RootFixtures {
  rootFixtures ??= createRootFixtures();
  return rootFixtures;
}

function createRootFixtures(): RootFixtures {
  const play5Bytes = readFixture('play5.json');
  const play5Text = new TextDecoder().decode(play5Bytes);
  const selectBytes = readFixture('select.json');
  const decideEntry = readFixture('lua-skin/decide.luaskin');
  const themeBytes: Array<[string, Uint8Array]> = [
    [PLAY5_PATH, play5Bytes],
    [`${THEME_DIR}/select.json`, selectBytes],
    [DECIDE_PATH, decideEntry],
    [`${DECIDE_DIR}/decidemain.lua`, readFixture('lua-skin/decidemain.lua')],
    ...THEME_ASSET_PATHS.map((path): [string, Uint8Array] => [`${THEME_DIR}/${path}`, PNG_SIGNATURE]),
  ];
  const files = new Map<string, skinApi.BeatorajaSkinFileEntry>(themeBytes);
  const inputFiles = themeBytes.map(([path, bytes]) => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    webkitRelativePath: path,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  }));
  const play5 = skinApi.parseBeatorajaSkinJson(play5Text) as unknown as SkinRecord;
  const play5Header = skinApi.parseBeatorajaSkinJsonHeader(play5Text);
  const select = skinApi.parseBeatorajaSkinJson(selectBytes) as unknown as SkinRecord;
  const defaultOptions = skinApi.buildDefaultSkinConfigOptions(play5Header);
  const { theme } = quietly(() => skinApi.discoverBeatorajaTheme(files));
  const play5Entry = theme.playSkins['5'];
  if (play5Entry === undefined) throw new Error('Benchmark fixture: play5.json is not discovered as a play skin.');

  const images = skinApi.normalizeBeatorajaImages(play5.image);
  const values = skinApi.normalizeBeatorajaValues(play5.value);
  const gauge = skinApi.normalizeBeatorajaGauge(play5.gauge);
  const destinations = skinApi.normalizeBeatorajaDestinations(select.destination);
  const lua = quietly(() =>
    skinApi.evaluateBeatorajaLuaSkin({
      entry: new TextEncoder().encode(BENCH_LUA_SOURCE),
      modules: [],
      skinConfig: {},
    }),
  );
  if (!lua.ok) throw new Error(`Benchmark fixture: ${lua.error.message}`);
  const luaTable = lua.value as SkinRecord;
  const { draw, value, text } = luaTable;
  if (
    !skinApi.isBeatorajaLuaFunctionValue(draw) ||
    !skinApi.isBeatorajaLuaFunctionValue(value) ||
    !skinApi.isBeatorajaLuaFunctionValue(text)
  ) {
    throw new Error('Benchmark fixture: the Lua table lost its functions.');
  }

  return {
    play5Text,
    play5Bytes,
    play5,
    play5Header,
    select,
    files,
    inputFiles,
    decideEntry,
    decideModules: skinApi.collectBeatorajaLuaModules(files, DECIDE_DIR),
    playSkins: theme.playSkins,
    play5Entry,
    defaultOptions,
    defaultFiles: skinApi.buildDefaultSkinConfigFiles(play5Header, files, PLAY5_PATH),
    activeOps: skinApi.buildBaseOpSet(defaultOptions),
    // A lane bomb: ten frames over 160 ms.
    image: pick(
      images.find((image) => image.divx * image.divy > 1 && image.cycle > 0),
      'an animated image',
    ),
    values,
    // The combo digits beside the PERFECT judge: two frames cycling every 100 ms.
    value: pick(
      values.find((entry) => entry.cycle > 0),
      'an animated value',
    ),
    floatValue: pick(skinApi.normalizeBeatorajaFloatValues(BENCH_FLOAT_VALUE_INPUT)[0], 'a float value'),
    judges: skinApi.normalizeBeatorajaJudges(play5.judge),
    gauge: pick(gauge, 'a gauge'),
    note: skinApi.normalizeBeatorajaNote(play5.note),
    // A select-screen destination with keyframes, looping from 300 ms.
    destination: pick(
      destinations.find((group) => group.dst.length > 1 && group.loop > 0),
      'an animated destination',
    ),
    luaTable,
    luaDraw: draw,
    luaValue: value,
    luaText: text,
    customEvents: skinApi.normalizeBeatorajaCustomEvents(luaTable.customEvents),
    customEventState: [],
    customTimers: skinApi.normalizeBeatorajaCustomTimers(luaTable.customTimers),
    customTimerState: [],
  };
}

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, FIXTURE_DIR)));
}

function pick<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Benchmark fixture: the default theme has no ${what}.`);
  return value;
}

/**
 * The Lua evaluator logs every `require()` with `console.log`. Muting it keeps the case on the evaluation, not on
 * terminal output, and keeps the bench log readable.
 */
function quietly<T>(run: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = log;
  }
}

export function registerBeatorajaSkinExportsCases(define: DefineBenchmarkCase): void {
  registerBeatorajaSkinSceneExportsCases(define);

  // Theme files
  define('beatoraja-skin.findCaseInsensitivePath', {
    run: () => {
      skinApi.findCaseInsensitivePath(fixtures().files, 'Skin/Default/Play/Notes/DEFAULT.PNG');
    },
  });
  define('beatoraja-skin.lookupBytesCaseInsensitive', {
    run: () => {
      skinApi.lookupBytesCaseInsensitive(fixtures().files, 'SKIN/DEFAULT/SYSTEM.PNG');
    },
  });
  define('beatoraja-skin.loadAssetBytes', {
    run: async () => {
      await skinApi.loadAssetBytes(BENCH_ASSET_ENTRY);
    },
  });
  define('beatoraja-skin.asLoadedBytes', {
    run: () => {
      skinApi.asLoadedBytes(BENCH_ASSET_ENTRY);
    },
  });
  define('beatoraja-skin.readFilesIntoBytesMap', {
    ioBound: true,
    run: async () => {
      await skinApi.readFilesIntoBytesMap(fixtures().inputFiles, { deferAudio: true });
    },
  });

  // Skin types and header
  define('beatoraja-skin.playVariantForSkinType', {
    run: () => {
      skinApi.playVariantForSkinType(skinApi.BEATORAJA_SKIN_TYPE.PLAY_14KEYS);
    },
  });
  define('beatoraja-skin.sceneForSkinType', {
    run: () => {
      skinApi.sceneForSkinType(skinApi.BEATORAJA_SKIN_TYPE.RESULT);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaSkinCustomOffsets', {
    run: () => {
      skinApi.normalizeBeatorajaSkinCustomOffsets(BENCH_CUSTOM_OFFSET_INPUT);
    },
  });
  define('beatoraja-skin.defaultOpForBeatorajaSkinProperty', {
    run: () => {
      const property = fixtures().play5Header.property?.[3];
      if (property) skinApi.defaultOpForBeatorajaSkinProperty(property);
    },
  });
  define('beatoraja-skin.buildDefaultSkinConfigOptions', {
    run: () => {
      skinApi.buildDefaultSkinConfigOptions(fixtures().play5Header);
    },
  });

  // Lua
  define('beatoraja-skin.describeBeatorajaLuaError', {
    run: () => {
      skinApi.describeBeatorajaLuaError(BENCH_LUA_ERROR);
    },
  });
  define('beatoraja-skin.isBeatorajaLuaFunctionValue', {
    run: () => {
      const { luaTable } = fixtures();
      skinApi.isBeatorajaLuaFunctionValue(luaTable.draw);
      skinApi.isBeatorajaLuaFunctionValue(luaTable.customEvents);
    },
  });
  define('beatoraja-skin.evaluateBeatorajaLuaBoolean', {
    run: () => {
      skinApi.evaluateBeatorajaLuaBoolean(fixtures().luaDraw, BENCH_LUA_CONTEXT);
    },
  });
  define('beatoraja-skin.evaluateBeatorajaLuaNumber', {
    run: () => {
      skinApi.evaluateBeatorajaLuaNumber(fixtures().luaValue, BENCH_LUA_CONTEXT);
    },
  });
  define('beatoraja-skin.evaluateBeatorajaLuaString', {
    run: () => {
      skinApi.evaluateBeatorajaLuaString(fixtures().luaText, BENCH_LUA_CONTEXT);
    },
  });
  define('beatoraja-skin.evaluateBeatorajaLuaSkin', {
    run: () => {
      // The header pass of the default decide skin, as theme discovery runs it.
      const { decideEntry, decideModules } = fixtures();
      quietly(() =>
        skinApi.evaluateBeatorajaLuaSkin({ entry: decideEntry, entryName: 'decide.luaskin', modules: decideModules }),
      );
    },
  });

  // Skin loading
  define('beatoraja-skin.detectBeatorajaSkinFormat', {
    run: () => {
      skinApi.detectBeatorajaSkinFormat(DECIDE_PATH);
      skinApi.detectBeatorajaSkinFormat(PLAY5_PATH);
    },
  });
  define('beatoraja-skin.collectBeatorajaLuaModules', {
    run: () => {
      skinApi.collectBeatorajaLuaModules(fixtures().files, DECIDE_DIR);
    },
  });
  define('beatoraja-skin.extractBeatorajaSkinHeader', {
    run: () => {
      skinApi.extractBeatorajaSkinHeader(fixtures().play5);
    },
  });
  define('beatoraja-skin.loadBeatorajaSkin', {
    run: () => {
      // The main pass of the default decide skin, with the user's options.
      const { files } = fixtures();
      quietly(() => skinApi.loadBeatorajaSkin({ entryPath: DECIDE_PATH, files, skinConfig: { option: {} } }));
    },
  });

  // JSON
  define('beatoraja-skin.parseBeatorajaSkinJson', {
    run: () => {
      skinApi.parseBeatorajaSkinJson(fixtures().play5Bytes);
    },
  });
  define('beatoraja-skin.parseBeatorajaSkinJsonHeader', {
    run: () => {
      skinApi.parseBeatorajaSkinJsonHeader(fixtures().play5Text);
    },
  });
  define('beatoraja-skin.relaxBeatorajaJson', {
    run: () => {
      skinApi.relaxBeatorajaJson(fixtures().play5Text);
    },
  });

  // Elements: shared
  define('beatoraja-skin.flattenBeatorajaElements', {
    run: () => {
      skinApi.flattenBeatorajaElements(fixtures().play5.image);
    },
  });
  define('beatoraja-skin.isElementVisible', {
    run: () => {
      skinApi.isElementVisible([920, -901, 905], fixtures().activeOps);
    },
  });
  define('beatoraja-skin.buildBaseOpSet', {
    run: () => {
      skinApi.buildBaseOpSet(fixtures().defaultOptions);
    },
  });

  // Elements: images, values and float values
  define('beatoraja-skin.normalizeBeatorajaImages', {
    run: () => {
      skinApi.normalizeBeatorajaImages(fixtures().play5.image);
    },
  });
  define('beatoraja-skin.imageFrameAt', {
    run: () => {
      skinApi.imageFrameAt(fixtures().image, 64_537);
    },
  });
  define('beatoraja-skin.imageFrameRect', {
    run: () => {
      skinApi.imageFrameRect(fixtures().image, 7);
    },
  });
  define('beatoraja-skin.imageRefFrame', {
    run: () => {
      skinApi.imageRefFrame(fixtures().image, 4);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaValues', {
    run: () => {
      skinApi.normalizeBeatorajaValues(fixtures().play5.value);
    },
  });
  define('beatoraja-skin.composeBeatorajaValueCells', {
    run: () => {
      const { value } = fixtures();
      skinApi.composeBeatorajaValueCells(value, 1234, skinApi.valueFrameAt(value, 64_537));
    },
  });
  define('beatoraja-skin.composeBeatorajaValueShift', {
    run: () => {
      skinApi.composeBeatorajaValueShift(fixtures().value, 46, 40);
    },
  });
  define('beatoraja-skin.valueFrameAt', {
    run: () => {
      skinApi.valueFrameAt(fixtures().value, 64_537);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaFloatValues', {
    run: () => {
      skinApi.normalizeBeatorajaFloatValues(BENCH_FLOAT_VALUE_INPUT);
    },
  });
  define('beatoraja-skin.composeBeatorajaFloatValueCells', {
    run: () => {
      skinApi.composeBeatorajaFloatValueCells(fixtures().floatValue, 9876);
    },
  });
  define('beatoraja-skin.composeBeatorajaFloatValueShift', {
    run: () => {
      skinApi.composeBeatorajaFloatValueShift(fixtures().floatValue, 9876, 24);
    },
  });
  define('beatoraja-skin.floatValueFrameAt', {
    run: () => {
      skinApi.floatValueFrameAt(fixtures().floatValue, 64_537);
    },
  });
  define('beatoraja-skin.beatorajaFloatValueSlotCount', {
    run: () => {
      skinApi.beatorajaFloatValueSlotCount(fixtures().floatValue);
    },
  });

  // Elements: custom events and timers
  define('beatoraja-skin.normalizeBeatorajaCustomEvents', {
    run: () => {
      skinApi.normalizeBeatorajaCustomEvents(fixtures().luaTable.customEvents);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaCustomTimers', {
    run: () => {
      skinApi.normalizeBeatorajaCustomTimers(fixtures().luaTable.customTimers);
    },
  });
  define('beatoraja-skin.evaluateBeatorajaCustomEvents', {
    run: () => {
      // A steady frame: the state carries over, so the conditions are evaluated but nothing fires.
      const { customEvents, customEventState } = fixtures();
      skinApi.evaluateBeatorajaCustomEvents(customEvents, customEventState, BENCH_LUA_CONTEXT, 64_500);
    },
  });
  define('beatoraja-skin.evaluateBeatorajaCustomTimers', {
    run: () => {
      const { customTimers, customTimerState } = fixtures();
      skinApi.evaluateBeatorajaCustomTimers(customTimers, customTimerState, BENCH_LUA_CONTEXT, () => {});
    },
  });

  // Elements: destinations and offsets
  define('beatoraja-skin.normalizeBeatorajaDestinations', {
    run: () => {
      const { select, activeOps } = fixtures();
      skinApi.normalizeBeatorajaDestinations(select.destination, activeOps);
    },
  });
  define('beatoraja-skin.sampleBeatorajaDestination', {
    run: () => {
      skinApi.sampleBeatorajaDestination(fixtures().destination, 150);
    },
  });
  define('beatoraja-skin.combineBeatorajaOffsets', {
    run: () => {
      skinApi.combineBeatorajaOffsets(BENCH_OFFSET_IDS, resolveBenchOffset);
    },
  });
  define('beatoraja-skin.applyBeatorajaOffsetAlpha', {
    run: () => {
      skinApi.applyBeatorajaOffsetAlpha(0.8, BENCH_OFFSET_IDS, resolveBenchOffset);
    },
  });
  define('beatoraja-skin.centerToAnchor', {
    run: () => {
      skinApi.centerToAnchor(5);
    },
  });

  // Elements: texts and graphs
  define('beatoraja-skin.normalizeBeatorajaTexts', {
    run: () => {
      skinApi.normalizeBeatorajaTexts(fixtures().select.text);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaFonts', {
    run: () => {
      skinApi.normalizeBeatorajaFonts(fixtures().play5.font);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaGraphs', {
    run: () => {
      skinApi.normalizeBeatorajaGraphs(fixtures().play5.graph);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaBpmGraphs', {
    run: () => {
      skinApi.normalizeBeatorajaBpmGraphs(fixtures().select.bpmgraph);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaJudgeGraphs', {
    run: () => {
      skinApi.normalizeBeatorajaJudgeGraphs(fixtures().select.judgegraph);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaGaugeGraphs', {
    run: () => {
      skinApi.normalizeBeatorajaGaugeGraphs(BENCH_GAUGE_GRAPH_INPUT);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaTimingVisualizers', {
    run: () => {
      skinApi.normalizeBeatorajaTimingVisualizers(BENCH_TIMING_VISUALIZER_INPUT);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaTimingDistributionGraphs', {
    run: () => {
      skinApi.normalizeBeatorajaTimingDistributionGraphs(BENCH_TIMING_DISTRIBUTION_INPUT);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaSliders', {
    run: () => {
      skinApi.normalizeBeatorajaSliders(fixtures().play5.slider);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaImagesets', {
    run: () => {
      skinApi.normalizeBeatorajaImagesets(fixtures().play5.imageset);
    },
  });

  // Elements: gauge, judge, notes, song list and characters
  define('beatoraja-skin.beatorajaGaugeModeFromString', {
    run: () => {
      skinApi.beatorajaGaugeModeFromString('EX-HARD');
    },
  });
  define('beatoraja-skin.computeBeatorajaGaugeAnimation', {
    run: () => {
      skinApi.computeBeatorajaGaugeAnimation(fixtures().gauge, 64_537);
    },
  });
  define('beatoraja-skin.gaugeExBase', {
    run: () => {
      skinApi.gaugeExBase(skinApi.BEATORAJA_GAUGE_MODE.EXCLASS);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaGauge', {
    run: () => {
      skinApi.normalizeBeatorajaGauge(fixtures().play5.gauge);
    },
  });
  define('beatoraja-skin.pickBeatorajaGaugeNode', {
    run: () => {
      skinApi.pickBeatorajaGaugeNode(fixtures().gauge, 39, BENCH_GAUGE_STATE, 2);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaJudges', {
    run: () => {
      skinApi.normalizeBeatorajaJudges(fixtures().play5.judge);
    },
  });
  define('beatoraja-skin.expandBeatorajaJudgeDestinations', {
    run: () => {
      // The lookup gains a cloned combo value per plate, so each call starts from the skin's own values.
      const { judges, values } = fixtures();
      skinApi.expandBeatorajaJudgeDestinations(judges, new Map(values.map((entry) => [entry.id, entry])));
    },
  });
  define('beatoraja-skin.normalizeBeatorajaNote', {
    run: () => {
      skinApi.normalizeBeatorajaNote(fixtures().play5.note);
    },
  });
  define('beatoraja-skin.pickBeatorajaNoteRects', {
    run: () => {
      const { note, activeOps } = fixtures();
      skinApi.pickBeatorajaNoteRects(note, activeOps);
    },
  });
  define('beatoraja-skin.parseBeatorajaSongList', {
    run: () => {
      skinApi.parseBeatorajaSongList(fixtures().select as unknown as skinApi.BeatorajaSkin);
    },
  });
  define('beatoraja-skin.normalizeBeatorajaPmCharas', {
    run: () => {
      skinApi.normalizeBeatorajaPmCharas(BENCH_PM_CHARA_INPUT);
    },
  });

  // Paths and sources
  define('beatoraja-skin.resolveBeatorajaPath', {
    run: () => {
      skinApi.resolveBeatorajaPath(fixtures().files, DECIDE_PATH, '../system.png');
    },
  });
  define('beatoraja-skin.expandBeatorajaWildcard', {
    run: () => {
      skinApi.expandBeatorajaWildcard(fixtures().files, PLAY5_PATH, 'play/notes/*.png');
    },
  });
  define('beatoraja-skin.buildDefaultSkinConfigFiles', {
    run: () => {
      const { play5Header, files } = fixtures();
      skinApi.buildDefaultSkinConfigFiles(play5Header, files, PLAY5_PATH);
    },
  });
  define('beatoraja-skin.resolveSourcePath', {
    run: () => {
      const { play5Header, files, defaultFiles } = fixtures();
      skinApi.resolveSourcePath(files, PLAY5_PATH, 'play/lanecover/*.png', defaultFiles, play5Header.filepath);
    },
  });
  define('beatoraja-skin.describeMissingWildcardDirectory', {
    run: () => {
      skinApi.describeMissingWildcardDirectory(fixtures().files, PLAY5_PATH, 'play/bomb/*.png');
    },
  });
  define('beatoraja-skin.bundleBeatorajaSources', {
    run: () => {
      const { files, play5, play5Header, defaultFiles } = fixtures();
      skinApi.bundleBeatorajaSources({
        files,
        entryPath: PLAY5_PATH,
        sources: play5.source as SkinRecord[],
        filepathSchema: play5Header.filepath,
        filepathOverrides: defaultFiles,
      });
    },
  });
  define('beatoraja-skin.listBeatorajaSourcePaths', {
    run: () => {
      const { files, play5, play5Header, defaultFiles } = fixtures();
      skinApi.listBeatorajaSourcePaths(
        files,
        PLAY5_PATH,
        play5.source as SkinRecord[],
        play5Header.filepath,
        defaultFiles,
      );
    },
  });

  // Theme
  define('beatoraja-skin.discoverBeatorajaTheme', {
    run: () => {
      const { files } = fixtures();
      quietly(() => skinApi.discoverBeatorajaTheme(files));
    },
  });
  define('beatoraja-skin.pickBeatorajaPlaySkin', {
    run: () => {
      // No 7-key skin in the theme: falls back to the 5-key one.
      skinApi.pickBeatorajaPlaySkin(fixtures().playSkins, '7');
    },
  });
  define('beatoraja-skin.loadBeatorajaPlaySkin', {
    run: () => {
      const { files, play5Entry, defaultOptions } = fixtures();
      skinApi.loadBeatorajaPlaySkin(files, play5Entry, { option: defaultOptions });
    },
  });

  // Runtime ids
  define('beatoraja-skin.bombTimerId', {
    run: () => {
      skinApi.bombTimerId(1, 3);
    },
  });
  define('beatoraja-skin.lnHoldTimerId', {
    run: () => {
      skinApi.lnHoldTimerId(2, 7);
    },
  });
  define('beatoraja-skin.keyOnTimerId', {
    run: () => {
      skinApi.keyOnTimerId(1, 0);
    },
  });
  define('beatoraja-skin.keyOffTimerId', {
    run: () => {
      skinApi.keyOffTimerId(3, 9);
    },
  });
  define('beatoraja-skin.judgeTimerId', {
    run: () => {
      skinApi.judgeTimerId(2);
    },
  });
  define('beatoraja-skin.comboTimerId', {
    run: () => {
      skinApi.comboTimerId(1);
    },
  });
  define('beatoraja-skin.endOfNoteTimerId', {
    run: () => {
      skinApi.endOfNoteTimerId(2);
    },
  });
  define('beatoraja-skin.computeRankOp', {
    run: () => {
      skinApi.computeRankOp(1650, 2400, 1);
    },
  });
  define('beatoraja-skin.computeGenericRankOp', {
    run: () => {
      skinApi.computeGenericRankOp(1650, 2400);
    },
  });
  define('beatoraja-skin.computeResultRankOp', {
    run: () => {
      skinApi.computeResultRankOp(1650, 2400);
    },
  });
  define('beatoraja-skin.computeJudgeExistOps', {
    run: () => {
      skinApi.computeJudgeExistOps({ perfect: 900, great: 200, good: 50, bad: 0, poor: 30 });
    },
  });
  define('beatoraja-skin.judgeOpForKind', {
    run: () => {
      skinApi.judgeOpForKind(1, 'great');
    },
  });
  define('beatoraja-skin.isPerfectJudge', {
    run: () => {
      skinApi.isPerfectJudge('PERFECT');
    },
  });
}
