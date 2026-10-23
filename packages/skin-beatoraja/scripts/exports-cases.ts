import { readFileSync } from 'node:fs';
import * as skinAPI from '@be-music/skin-beatoraja';
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
const BENCH_LUA_CONTEXT: skinAPI.BeatorajaLuaRuntimeContext = {
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
  { name: 'Judgment position', id: 40, x: true, y: true },
  { name: 'Lane cover', id: 41, y: true, a: 1 },
  { name: 'Score graph', id: 42, x: true, w: true, h: true },
];
const BENCH_OFFSETS = new Map<number, skinAPI.BeatorajaSkinOffsetValue>([
  [skinAPI.OFFSET_ALL, { x: 4, y: -2, w: 0, h: 0, r: 0, a: 0 }],
  [skinAPI.OFFSET_LIFT, { x: 0, y: 72, w: 0, h: 0, r: 0, a: 0 }],
  [skinAPI.OFFSET_JUDGE_1P, { x: 0, y: 12, w: 8, h: 4, r: 0, a: -64 }],
]);
const BENCH_OFFSET_IDS = [skinAPI.OFFSET_ALL, skinAPI.OFFSET_LIFT, skinAPI.OFFSET_JUDGE_1P];
const resolveBenchOffset = (id: number): skinAPI.BeatorajaSkinOffsetValue | undefined => BENCH_OFFSETS.get(id);
const BENCH_GAUGE_STATE: skinAPI.BeatorajaGaugeState = {
  value: 82,
  max: 100,
  border: 80,
  mode: skinAPI.BEATORAJA_GAUGE_MODE.NORMAL,
};
const BENCH_ASSET_ENTRY = PNG_SIGNATURE;
const BENCH_LUA_ERROR: skinAPI.BeatorajaLuaEvaluationError = {
  message: 'decidemain.lua:42: attempt to index a nil value',
};

interface RootFixtures {
  play5Text: string;
  play5Bytes: Uint8Array;
  play5: SkinRecord;
  play5Header: skinAPI.BeatorajaSkinHeader;
  select: SkinRecord;
  files: Map<string, skinAPI.BeatorajaSkinFileEntry>;
  inputFiles: skinAPI.BeatorajaSkinInputFile[];
  decideEntry: Uint8Array;
  decideModules: skinAPI.BeatorajaLuaModuleSource[];
  playSkins: skinAPI.BeatorajaPlaySkinMap;
  play5Entry: skinAPI.BeatorajaSkinEntry;
  defaultOptions: Record<string, number>;
  defaultFiles: Record<string, string>;
  activeOps: Set<number>;
  image: skinAPI.BeatorajaImageElement;
  values: skinAPI.BeatorajaValueElement[];
  value: skinAPI.BeatorajaValueElement;
  floatValue: skinAPI.BeatorajaFloatValueElement;
  judges: skinAPI.BeatorajaJudgeElement[];
  gauge: skinAPI.BeatorajaGaugeElement;
  note: skinAPI.BeatorajaNoteSection;
  destination: skinAPI.BeatorajaDestinationGroup;
  luaTable: SkinRecord;
  luaDraw: skinAPI.BeatorajaLuaFunctionValue;
  luaValue: skinAPI.BeatorajaLuaFunctionValue;
  luaText: skinAPI.BeatorajaLuaFunctionValue;
  customEvents: skinAPI.BeatorajaCustomEvent[];
  customEventState: skinAPI.BeatorajaCustomEventState[];
  customTimers: skinAPI.BeatorajaCustomTimer[];
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
  const files = new Map<string, skinAPI.BeatorajaSkinFileEntry>(themeBytes);
  const inputFiles = themeBytes.map(([path, bytes]) => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    webkitRelativePath: path,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  }));
  const play5 = skinAPI.parseBeatorajaSkinJSON(play5Text) as unknown as SkinRecord;
  const play5Header = skinAPI.parseBeatorajaSkinJSONHeader(play5Text);
  const select = skinAPI.parseBeatorajaSkinJSON(selectBytes) as unknown as SkinRecord;
  const defaultOptions = skinAPI.buildDefaultSkinConfigOptions(play5Header);
  const { theme } = quietly(() => skinAPI.discoverBeatorajaTheme(files));
  const play5Entry = theme.playSkins['5'];
  if (play5Entry === undefined) throw new Error('Benchmark fixture: play5.json is not discovered as a play skin.');

  const images = skinAPI.normalizeBeatorajaImages(play5.image);
  const values = skinAPI.normalizeBeatorajaValues(play5.value);
  const gauge = skinAPI.normalizeBeatorajaGauge(play5.gauge);
  const destinations = skinAPI.normalizeBeatorajaDestinations(select.destination);
  const lua = quietly(() =>
    skinAPI.evaluateBeatorajaLuaSkin({
      entry: new TextEncoder().encode(BENCH_LUA_SOURCE),
      modules: [],
      skinConfig: {},
    }),
  );
  if (!lua.ok) throw new Error(`Benchmark fixture: ${lua.error.message}`);
  const luaTable = lua.value as SkinRecord;
  const { draw, value, text } = luaTable;
  if (
    !skinAPI.isBeatorajaLuaFunctionValue(draw) ||
    !skinAPI.isBeatorajaLuaFunctionValue(value) ||
    !skinAPI.isBeatorajaLuaFunctionValue(text)
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
    decideModules: skinAPI.collectBeatorajaLuaModules(files, DECIDE_DIR),
    playSkins: theme.playSkins,
    play5Entry,
    defaultOptions,
    defaultFiles: skinAPI.buildDefaultSkinConfigFiles(play5Header, files, PLAY5_PATH),
    activeOps: skinAPI.buildBaseOpSet(defaultOptions),
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
    floatValue: pick(skinAPI.normalizeBeatorajaFloatValues(BENCH_FLOAT_VALUE_INPUT)[0], 'a float value'),
    judges: skinAPI.normalizeBeatorajaJudges(play5.judge),
    gauge: pick(gauge, 'a gauge'),
    note: skinAPI.normalizeBeatorajaNote(play5.note),
    // A select-screen destination with keyframes, looping from 300 ms.
    destination: pick(
      destinations.find((group) => group.dst.length > 1 && group.loop > 0),
      'an animated destination',
    ),
    luaTable,
    luaDraw: draw,
    luaValue: value,
    luaText: text,
    customEvents: skinAPI.normalizeBeatorajaCustomEvents(luaTable.customEvents),
    customEventState: [],
    customTimers: skinAPI.normalizeBeatorajaCustomTimers(luaTable.customTimers),
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
  define('skin-beatoraja.findCaseInsensitivePath', {
    run: () => {
      skinAPI.findCaseInsensitivePath(fixtures().files, 'Skin/Default/Play/Notes/DEFAULT.PNG');
    },
  });
  define('skin-beatoraja.lookupBytesCaseInsensitive', {
    run: () => {
      skinAPI.lookupBytesCaseInsensitive(fixtures().files, 'SKIN/DEFAULT/SYSTEM.PNG');
    },
  });
  define('skin-beatoraja.loadAssetBytes', {
    run: async () => {
      await skinAPI.loadAssetBytes(BENCH_ASSET_ENTRY);
    },
  });
  define('skin-beatoraja.asLoadedBytes', {
    run: () => {
      skinAPI.asLoadedBytes(BENCH_ASSET_ENTRY);
    },
  });
  define('skin-beatoraja.readFilesIntoBytesMap', {
    ioBound: true,
    run: async () => {
      await skinAPI.readFilesIntoBytesMap(fixtures().inputFiles, { deferAudio: true });
    },
  });

  // Skin types and header
  define('skin-beatoraja.playVariantForSkinType', {
    run: () => {
      skinAPI.playVariantForSkinType(skinAPI.BEATORAJA_SKIN_TYPE.PLAY_14KEYS);
    },
  });
  define('skin-beatoraja.sceneForSkinType', {
    run: () => {
      skinAPI.sceneForSkinType(skinAPI.BEATORAJA_SKIN_TYPE.RESULT);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaSkinCustomOffsets', {
    run: () => {
      skinAPI.normalizeBeatorajaSkinCustomOffsets(BENCH_CUSTOM_OFFSET_INPUT);
    },
  });
  define('skin-beatoraja.defaultOpForBeatorajaSkinProperty', {
    run: () => {
      const property = fixtures().play5Header.property?.[3];
      if (property) skinAPI.defaultOpForBeatorajaSkinProperty(property);
    },
  });
  define('skin-beatoraja.buildDefaultSkinConfigOptions', {
    run: () => {
      skinAPI.buildDefaultSkinConfigOptions(fixtures().play5Header);
    },
  });

  // Lua
  define('skin-beatoraja.describeBeatorajaLuaError', {
    run: () => {
      skinAPI.describeBeatorajaLuaError(BENCH_LUA_ERROR);
    },
  });
  define('skin-beatoraja.isBeatorajaLuaFunctionValue', {
    run: () => {
      const { luaTable } = fixtures();
      skinAPI.isBeatorajaLuaFunctionValue(luaTable.draw);
      skinAPI.isBeatorajaLuaFunctionValue(luaTable.customEvents);
    },
  });
  define('skin-beatoraja.evaluateBeatorajaLuaBoolean', {
    run: () => {
      skinAPI.evaluateBeatorajaLuaBoolean(fixtures().luaDraw, BENCH_LUA_CONTEXT);
    },
  });
  define('skin-beatoraja.evaluateBeatorajaLuaNumber', {
    run: () => {
      skinAPI.evaluateBeatorajaLuaNumber(fixtures().luaValue, BENCH_LUA_CONTEXT);
    },
  });
  define('skin-beatoraja.evaluateBeatorajaLuaString', {
    run: () => {
      skinAPI.evaluateBeatorajaLuaString(fixtures().luaText, BENCH_LUA_CONTEXT);
    },
  });
  define('skin-beatoraja.evaluateBeatorajaLuaSkin', {
    run: () => {
      // The header pass of the default decide skin, as theme discovery runs it.
      const { decideEntry, decideModules } = fixtures();
      quietly(() =>
        skinAPI.evaluateBeatorajaLuaSkin({ entry: decideEntry, entryName: 'decide.luaskin', modules: decideModules }),
      );
    },
  });

  // Skin loading
  define('skin-beatoraja.detectBeatorajaSkinFormat', {
    run: () => {
      skinAPI.detectBeatorajaSkinFormat(DECIDE_PATH);
      skinAPI.detectBeatorajaSkinFormat(PLAY5_PATH);
    },
  });
  define('skin-beatoraja.collectBeatorajaLuaModules', {
    run: () => {
      skinAPI.collectBeatorajaLuaModules(fixtures().files, DECIDE_DIR);
    },
  });
  define('skin-beatoraja.extractBeatorajaSkinHeader', {
    run: () => {
      skinAPI.extractBeatorajaSkinHeader(fixtures().play5);
    },
  });
  define('skin-beatoraja.loadBeatorajaSkin', {
    run: () => {
      // The main pass of the default decide skin, with the user's options.
      const { files } = fixtures();
      quietly(() => skinAPI.loadBeatorajaSkin({ entryPath: DECIDE_PATH, files, skinConfig: { option: {} } }));
    },
  });

  // JSON
  define('skin-beatoraja.parseBeatorajaSkinJSON', {
    run: () => {
      skinAPI.parseBeatorajaSkinJSON(fixtures().play5Bytes);
    },
  });
  define('skin-beatoraja.parseBeatorajaSkinJSONHeader', {
    run: () => {
      skinAPI.parseBeatorajaSkinJSONHeader(fixtures().play5Text);
    },
  });
  define('skin-beatoraja.relaxBeatorajaJSON', {
    run: () => {
      skinAPI.relaxBeatorajaJSON(fixtures().play5Text);
    },
  });

  // Elements: shared
  define('skin-beatoraja.flattenBeatorajaElements', {
    run: () => {
      skinAPI.flattenBeatorajaElements(fixtures().play5.image);
    },
  });
  define('skin-beatoraja.isElementVisible', {
    run: () => {
      skinAPI.isElementVisible([920, -901, 905], fixtures().activeOps);
    },
  });
  define('skin-beatoraja.buildBaseOpSet', {
    run: () => {
      skinAPI.buildBaseOpSet(fixtures().defaultOptions);
    },
  });

  // Elements: images, values and float values
  define('skin-beatoraja.normalizeBeatorajaImages', {
    run: () => {
      skinAPI.normalizeBeatorajaImages(fixtures().play5.image);
    },
  });
  define('skin-beatoraja.imageFrameAt', {
    run: () => {
      skinAPI.imageFrameAt(fixtures().image, 64_537);
    },
  });
  define('skin-beatoraja.imageFrameRect', {
    run: () => {
      skinAPI.imageFrameRect(fixtures().image, 7);
    },
  });
  define('skin-beatoraja.imageRefFrame', {
    run: () => {
      skinAPI.imageRefFrame(fixtures().image, 4);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaValues', {
    run: () => {
      skinAPI.normalizeBeatorajaValues(fixtures().play5.value);
    },
  });
  define('skin-beatoraja.composeBeatorajaValueCells', {
    run: () => {
      const { value } = fixtures();
      skinAPI.composeBeatorajaValueCells(value, 1234, skinAPI.valueFrameAt(value, 64_537));
    },
  });
  define('skin-beatoraja.composeBeatorajaValueShift', {
    run: () => {
      skinAPI.composeBeatorajaValueShift(fixtures().value, 46, 40);
    },
  });
  define('skin-beatoraja.valueFrameAt', {
    run: () => {
      skinAPI.valueFrameAt(fixtures().value, 64_537);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaFloatValues', {
    run: () => {
      skinAPI.normalizeBeatorajaFloatValues(BENCH_FLOAT_VALUE_INPUT);
    },
  });
  define('skin-beatoraja.composeBeatorajaFloatValueCells', {
    run: () => {
      skinAPI.composeBeatorajaFloatValueCells(fixtures().floatValue, 9876);
    },
  });
  define('skin-beatoraja.composeBeatorajaFloatValueShift', {
    run: () => {
      skinAPI.composeBeatorajaFloatValueShift(fixtures().floatValue, 9876, 24);
    },
  });
  define('skin-beatoraja.floatValueFrameAt', {
    run: () => {
      skinAPI.floatValueFrameAt(fixtures().floatValue, 64_537);
    },
  });
  define('skin-beatoraja.beatorajaFloatValueSlotCount', {
    run: () => {
      skinAPI.beatorajaFloatValueSlotCount(fixtures().floatValue);
    },
  });

  // Elements: custom events and timers
  define('skin-beatoraja.normalizeBeatorajaCustomEvents', {
    run: () => {
      skinAPI.normalizeBeatorajaCustomEvents(fixtures().luaTable.customEvents);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaCustomTimers', {
    run: () => {
      skinAPI.normalizeBeatorajaCustomTimers(fixtures().luaTable.customTimers);
    },
  });
  define('skin-beatoraja.evaluateBeatorajaCustomEvents', {
    run: () => {
      // A steady frame: the state carries over, so the conditions are evaluated but nothing fires.
      const { customEvents, customEventState } = fixtures();
      skinAPI.evaluateBeatorajaCustomEvents(customEvents, customEventState, BENCH_LUA_CONTEXT, 64_500);
    },
  });
  define('skin-beatoraja.evaluateBeatorajaCustomTimers', {
    run: () => {
      const { customTimers, customTimerState } = fixtures();
      skinAPI.evaluateBeatorajaCustomTimers(customTimers, customTimerState, BENCH_LUA_CONTEXT, () => {});
    },
  });

  // Elements: destinations and offsets
  define('skin-beatoraja.normalizeBeatorajaDestinations', {
    run: () => {
      const { select, activeOps } = fixtures();
      skinAPI.normalizeBeatorajaDestinations(select.destination, activeOps);
    },
  });
  define('skin-beatoraja.sampleBeatorajaDestination', {
    run: () => {
      skinAPI.sampleBeatorajaDestination(fixtures().destination, 150);
    },
  });
  define('skin-beatoraja.combineBeatorajaOffsets', {
    run: () => {
      skinAPI.combineBeatorajaOffsets(BENCH_OFFSET_IDS, resolveBenchOffset);
    },
  });
  define('skin-beatoraja.applyBeatorajaOffsetAlpha', {
    run: () => {
      skinAPI.applyBeatorajaOffsetAlpha(0.8, BENCH_OFFSET_IDS, resolveBenchOffset);
    },
  });
  define('skin-beatoraja.centerToAnchor', {
    run: () => {
      skinAPI.centerToAnchor(5);
    },
  });

  // Elements: texts and graphs
  define('skin-beatoraja.normalizeBeatorajaTexts', {
    run: () => {
      skinAPI.normalizeBeatorajaTexts(fixtures().select.text);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaFonts', {
    run: () => {
      skinAPI.normalizeBeatorajaFonts(fixtures().play5.font);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaGraphs', {
    run: () => {
      skinAPI.normalizeBeatorajaGraphs(fixtures().play5.graph);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaBPMGraphs', {
    run: () => {
      skinAPI.normalizeBeatorajaBPMGraphs(fixtures().select.bpmgraph);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaJudgeGraphs', {
    run: () => {
      skinAPI.normalizeBeatorajaJudgeGraphs(fixtures().select.judgegraph);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaGaugeGraphs', {
    run: () => {
      skinAPI.normalizeBeatorajaGaugeGraphs(BENCH_GAUGE_GRAPH_INPUT);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaTimingVisualizers', {
    run: () => {
      skinAPI.normalizeBeatorajaTimingVisualizers(BENCH_TIMING_VISUALIZER_INPUT);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaTimingDistributionGraphs', {
    run: () => {
      skinAPI.normalizeBeatorajaTimingDistributionGraphs(BENCH_TIMING_DISTRIBUTION_INPUT);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaSliders', {
    run: () => {
      skinAPI.normalizeBeatorajaSliders(fixtures().play5.slider);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaImagesets', {
    run: () => {
      skinAPI.normalizeBeatorajaImagesets(fixtures().play5.imageset);
    },
  });

  // Elements: gauge, judge, notes, song list and characters
  define('skin-beatoraja.beatorajaGaugeModeFromString', {
    run: () => {
      skinAPI.beatorajaGaugeModeFromString('EX-HARD');
    },
  });
  define('skin-beatoraja.computeBeatorajaGaugeAnimation', {
    run: () => {
      skinAPI.computeBeatorajaGaugeAnimation(fixtures().gauge, 64_537);
    },
  });
  define('skin-beatoraja.gaugeExBase', {
    run: () => {
      skinAPI.gaugeExBase(skinAPI.BEATORAJA_GAUGE_MODE.EXCLASS);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaGauge', {
    run: () => {
      skinAPI.normalizeBeatorajaGauge(fixtures().play5.gauge);
    },
  });
  define('skin-beatoraja.pickBeatorajaGaugeNode', {
    run: () => {
      skinAPI.pickBeatorajaGaugeNode(fixtures().gauge, 39, BENCH_GAUGE_STATE, 2);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaJudges', {
    run: () => {
      skinAPI.normalizeBeatorajaJudges(fixtures().play5.judge);
    },
  });
  define('skin-beatoraja.expandBeatorajaJudgeDestinations', {
    run: () => {
      // The lookup gains a cloned combo value per plate, so each call starts from the skin's own values.
      const { judges, values } = fixtures();
      skinAPI.expandBeatorajaJudgeDestinations(judges, new Map(values.map((entry) => [entry.id, entry])));
    },
  });
  define('skin-beatoraja.normalizeBeatorajaNote', {
    run: () => {
      skinAPI.normalizeBeatorajaNote(fixtures().play5.note);
    },
  });
  define('skin-beatoraja.pickBeatorajaNoteRects', {
    run: () => {
      const { note, activeOps } = fixtures();
      skinAPI.pickBeatorajaNoteRects(note, activeOps);
    },
  });
  define('skin-beatoraja.parseBeatorajaSongList', {
    run: () => {
      skinAPI.parseBeatorajaSongList(fixtures().select as unknown as skinAPI.BeatorajaSkin);
    },
  });
  define('skin-beatoraja.normalizeBeatorajaPmCharas', {
    run: () => {
      skinAPI.normalizeBeatorajaPmCharas(BENCH_PM_CHARA_INPUT);
    },
  });

  // Paths and sources
  define('skin-beatoraja.resolveBeatorajaPath', {
    run: () => {
      skinAPI.resolveBeatorajaPath(fixtures().files, DECIDE_PATH, '../system.png');
    },
  });
  define('skin-beatoraja.expandBeatorajaWildcard', {
    run: () => {
      skinAPI.expandBeatorajaWildcard(fixtures().files, PLAY5_PATH, 'play/notes/*.png');
    },
  });
  define('skin-beatoraja.buildDefaultSkinConfigFiles', {
    run: () => {
      const { play5Header, files } = fixtures();
      skinAPI.buildDefaultSkinConfigFiles(play5Header, files, PLAY5_PATH);
    },
  });
  define('skin-beatoraja.resolveSourcePath', {
    run: () => {
      const { play5Header, files, defaultFiles } = fixtures();
      skinAPI.resolveSourcePath(files, PLAY5_PATH, 'play/lanecover/*.png', defaultFiles, play5Header.filepath);
    },
  });
  define('skin-beatoraja.describeMissingWildcardDirectory', {
    run: () => {
      skinAPI.describeMissingWildcardDirectory(fixtures().files, PLAY5_PATH, 'play/bomb/*.png');
    },
  });
  define('skin-beatoraja.bundleBeatorajaSources', {
    run: () => {
      const { files, play5, play5Header, defaultFiles } = fixtures();
      skinAPI.bundleBeatorajaSources({
        files,
        entryPath: PLAY5_PATH,
        sources: play5.source as SkinRecord[],
        filepathSchema: play5Header.filepath,
        filepathOverrides: defaultFiles,
      });
    },
  });
  define('skin-beatoraja.listBeatorajaSourcePaths', {
    run: () => {
      const { files, play5, play5Header, defaultFiles } = fixtures();
      skinAPI.listBeatorajaSourcePaths(
        files,
        PLAY5_PATH,
        play5.source as SkinRecord[],
        play5Header.filepath,
        defaultFiles,
      );
    },
  });

  // Theme
  define('skin-beatoraja.discoverBeatorajaTheme', {
    run: () => {
      const { files } = fixtures();
      quietly(() => skinAPI.discoverBeatorajaTheme(files));
    },
  });
  define('skin-beatoraja.pickBeatorajaPlaySkin', {
    run: () => {
      // No 7-key skin in the theme: falls back to the 5-key one.
      skinAPI.pickBeatorajaPlaySkin(fixtures().playSkins, '7');
    },
  });
  define('skin-beatoraja.pickBeatorajaPlaySkinVariant', {
    run: () => {
      skinAPI.pickBeatorajaPlaySkinVariant(fixtures().playSkins, '7');
    },
  });
  define('skin-beatoraja.loadBeatorajaPlaySkin', {
    run: () => {
      const { files, play5Entry, defaultOptions } = fixtures();
      skinAPI.loadBeatorajaPlaySkin(files, play5Entry, { option: defaultOptions });
    },
  });

  // Runtime ids
  define('skin-beatoraja.hcnActiveTimerId', {
    run: () => {
      skinAPI.hcnActiveTimerId(2, 26);
    },
  });
  define('skin-beatoraja.hcnDamageTimerId', {
    run: () => {
      skinAPI.hcnDamageTimerId(1, 9);
    },
  });
  define('skin-beatoraja.bombTimerId', {
    run: () => {
      skinAPI.bombTimerId(1, 3);
    },
  });
  define('skin-beatoraja.lnHoldTimerId', {
    run: () => {
      skinAPI.lnHoldTimerId(2, 7);
    },
  });
  define('skin-beatoraja.keyOnTimerId', {
    run: () => {
      skinAPI.keyOnTimerId(1, 0);
    },
  });
  define('skin-beatoraja.keyOffTimerId', {
    run: () => {
      skinAPI.keyOffTimerId(3, 9);
    },
  });
  define('skin-beatoraja.judgeTimerId', {
    run: () => {
      skinAPI.judgeTimerId(2);
    },
  });
  define('skin-beatoraja.comboTimerId', {
    run: () => {
      skinAPI.comboTimerId(1);
    },
  });
  define('skin-beatoraja.endOfNoteTimerId', {
    run: () => {
      skinAPI.endOfNoteTimerId(2);
    },
  });
  define('skin-beatoraja.computeRankOp', {
    run: () => {
      skinAPI.computeRankOp(1650, 2400, 1);
    },
  });
  define('skin-beatoraja.computeGenericRankOp', {
    run: () => {
      skinAPI.computeGenericRankOp(1650, 2400);
    },
  });
  define('skin-beatoraja.computeResultRankOp', {
    run: () => {
      skinAPI.computeResultRankOp(1650, 2400);
    },
  });
  define('skin-beatoraja.computeJudgeExistOps', {
    run: () => {
      skinAPI.computeJudgeExistOps({ perfect: 900, great: 200, good: 50, bad: 0, poor: 30 });
    },
  });
  define('skin-beatoraja.judgeOpForKind', {
    run: () => {
      skinAPI.judgeOpForKind(1, 'great');
    },
  });
  define('skin-beatoraja.isPerfectJudge', {
    run: () => {
      skinAPI.isPerfectJudge('PERFECT');
    },
  });
}
