import * as chartAPI from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_RANDOM_DRAWS_CACHE = new WeakMap<object, chartAPI.RandomDraws>();

function benchRandomDraws(source: chartAPI.ControlFlowSource): chartAPI.RandomDraws {
  let draws = BENCH_RANDOM_DRAWS_CACHE.get(source);
  if (draws === undefined) {
    draws = chartAPI.drawRandomOutcomes(source, () => 0.25);
    BENCH_RANDOM_DRAWS_CACHE.set(source, draws);
  }
  return draws;
}

const BENCH_COLOR_KEY_PIXELS = Uint8Array.from({ length: 256 * 256 * 4 }, (_, index) =>
  (index & 3) === 3 ? 255 : ((index >>> 2) & 1) === 1 ? 127 : 32,
);
const BENCH_COLOR_KEY_CHART = createEmptyJSON('bms');
const BENCH_EXWAV_CHART = createEmptyJSON('bms');
const BENCH_TEXT_CHART = createEmptyJSON('bms');
BENCH_TEXT_CHART.resources.text = { '00': '"MISS"', '01': '"Hello"', '02': '""' };
BENCH_TEXT_CHART.events = [
  { measure: 0, channel: '99', position: [0, 1], value: '01' },
  { measure: 1, channel: '99', position: [0, 1], value: '02' },
];
BENCH_TEXT_CHART.bms.options = ['774:HI-SPEED_x0.77', 'charatbeatHDX:BGAMODE 0'];
BENCH_TEXT_CHART.bms.changeOption['01'] = '774:HIDDEN_STEALTH';
BENCH_TEXT_CHART.bms.changeOption['02'] = '774:HI-SPEED_x100.00';
BENCH_TEXT_CHART.events.push({ measure: 1, channel: 'A6', position: [0, 1], value: '02' });
BENCH_TEXT_CHART.events.push({ measure: 1, channel: 'A6', position: [0, 1], value: '01' });
const BENCH_CHART_OPTIONS = chartAPI.compileChartOptions(chartAPI.buildChartOptionTimeline(BENCH_TEXT_CHART));
const BENCH_HDX_CHART = createEmptyJSON('bms');
BENCH_HDX_CHART.bms.options = ['774:HI-SPEED_x0.77', 'charatbeatHDX:LONGMODE 1'];
const BENCH_TEXT_TIMELINE = chartAPI.buildChartTextTimeline(BENCH_TEXT_CHART);
BENCH_EXWAV_CHART.resources.wav = { '01': 'ordinary.wav' };
BENCH_EXWAV_CHART.bms.exWAV = { '01': 'pvf 500 -600 48000 extended.wav', '02': 'v 0 only.wav' };
BENCH_COLOR_KEY_CHART.bms.exBMP['01'] = '0,127,127,127 image.png';

const BENCH_FINGERPRINT_OPTIONS: chartAPI.BeMusicFingerprintOptions = { chartPath: 'sample.bms' };
const BENCH_FINGERPRINT_DOCUMENTS = new WeakMap<object, chartAPI.BeMusicFingerprintDocument>();

function getBenchFingerprintDocument(
  json: Parameters<typeof chartAPI.createChartFingerprintDocument>[0],
): chartAPI.BeMusicFingerprintDocument {
  let document = BENCH_FINGERPRINT_DOCUMENTS.get(json);
  if (!document) {
    document = chartAPI.createChartFingerprintDocument(json, BENCH_FINGERPRINT_OPTIONS);
    BENCH_FINGERPRINT_DOCUMENTS.set(json, document);
  }
  return document;
}

const BENCH_BMSON_BGA = createEmptyJSON('bmson');
BENCH_BMSON_BGA.bmson.bga = {
  header: [
    { id: 10, name: 'a.png' },
    { id: 20, name: 'b.png' },
  ],
  events: [],
  poorEvents: [{ y: 0, id: 1 }],
  layerEvents: [{ y: 240, id: 1, idSet: [1, 20], condition: 'play', interval: 2 }],
  sequences: [{ id: 1, sequence: [{ time: 0, id: 0 }, { time: 100, id: 1 }, { time: 500 }] }],
};
const BENCH_BMSON_BGA_TIMING = chartAPI.createTimingResolver(BENCH_BMSON_BGA);
const BENCH_BMSON_BGA_SEQUENCE = chartAPI.buildBmsonBGAEventTimeline(BENCH_BMSON_BGA, BENCH_BMSON_BGA_TIMING)[0]!
  .sequences[0]!;

export function registerChartExportsCases(define: DefineBenchmarkCase): void {
  define('chart-model.compileChartOptions', {
    run: () => {
      chartAPI.compileChartOptions(chartAPI.buildChartOptionTimeline(BENCH_TEXT_CHART));
    },
  });
  define('chart-model.resolveChartOptionsAt', {
    run: () => {
      chartAPI.resolveChartOptionsAt(BENCH_CHART_OPTIONS.program, 1_000_000);
    },
  });
  const visualInput = { progress: 0.5, channel: '11', beat: 12.5, seconds: 3.25, combo: 120 };
  const visualState = { hidden: 'HID-SUD', changeHS: 'CHAOS', crazySize: 'RD-SIZE', crazyWave: 'XWAVE2' } as const;
  define('chart-model.parseChartVisualOption', {
    run: () => {
      chartAPI.parseChartVisualOption('774:CHANGE-HS_LINEACCEL');
    },
  });
  define('chart-model.isChartVisualOptionValue', {
    run: () => {
      chartAPI.isChartVisualOptionValue('hidden', 'STEALTH');
    },
  });
  define('chart-model.hasChartVisualOptions', {
    run: () => {
      chartAPI.hasChartVisualOptions(visualState);
    },
  });
  define('chart-model.chartVisualHash01', {
    run: () => {
      chartAPI.chartVisualHash01(17, 12_500_000, 3);
    },
  });
  define('chart-model.resolveChartChangeHSProgress', {
    run: () => {
      chartAPI.resolveChartChangeHSProgress('CHAOS', visualInput);
    },
  });
  define('chart-model.resolveChartHiddenAlpha', {
    run: () => {
      chartAPI.resolveChartHiddenAlpha('BLINK', 0.5, 3.25);
    },
  });
  define('chart-model.resolveChartCrazyScale', {
    run: () => {
      chartAPI.resolveChartCrazyScale('RD-SIZE', visualInput);
    },
  });
  define('chart-model.resolveChartCrazyXOffset', {
    run: () => {
      chartAPI.resolveChartCrazyXOffset('XWAVE2', 0.5);
    },
  });
  define('chart-model.resolveChartNoteVisual', {
    run: () => {
      chartAPI.resolveChartNoteVisual(visualState, visualInput);
    },
  });
  define('chart-model.buildChartOptionTimeline', {
    run: () => {
      chartAPI.buildChartOptionTimeline(BENCH_TEXT_CHART);
    },
  });
  define('chart-model.buildChartTextTimeline', {
    run: () => {
      chartAPI.buildChartTextTimeline(BENCH_TEXT_CHART);
    },
  });
  define('chart-model.pickChartText', {
    run: () => {
      chartAPI.pickChartText(BENCH_TEXT_TIMELINE, 1);
    },
  });
  define('chart-model.buildBmsonBGAEventTimeline', {
    run: () => {
      chartAPI.buildBmsonBGAEventTimeline(BENCH_BMSON_BGA, BENCH_BMSON_BGA_TIMING);
    },
  });
  define('chart-model.pickBmsonBGASequenceFrame', {
    run: () => {
      chartAPI.pickBmsonBGASequenceFrame(BENCH_BMSON_BGA_SEQUENCE, 0.2);
    },
  });
  define('chart-model.parseBMSKeyBoundBGA', {
    run: () => {
      chartAPI.parseBMSKeyBoundBGA('100:400:16:0:255,255,255,255 00010203');
    },
  });
  define('chart-model.pickKeyBoundBGAFrame', {
    run: () => {
      chartAPI.pickKeyBoundBGAFrame(
        {
          frameIntervalMs: 100,
          durationMs: 400,
          channel: '16',
          loop: false,
          argb: { a: 255, r: 255, g: 255, b: 255 },
          frames: ['00', '01', '02', '03'],
        },
        250,
      );
    },
  });
  define('chart-model.buildKeyBoundBGATimeline', {
    run: (fixtures) => {
      const chart = {
        ...fixtures.emptyBmsJSON,
        bms: { ...fixtures.emptyBmsJSON.bms, swBGA: { '61': '100:400:16:0:255,255,255,255 00010203' } },
        events: [{ measure: 0, position: [0, 1] as [number, number], channel: 'A5', value: '61' }],
      };
      chartAPI.buildKeyBoundBGATimeline(chart, chartAPI.createTimingResolver(chart));
    },
  });
  define('chart-model.resolveBMSExBMPColorKey', {
    run: () => {
      chartAPI.resolveBMSExBMPColorKey(BENCH_COLOR_KEY_CHART, '01');
    },
  });
  define('chart-model.applyBMSColorKey', {
    run: () => {
      chartAPI.applyBMSColorKey(BENCH_COLOR_KEY_PIXELS, { a: 0, r: 127, g: 127, b: 127 }, false);
    },
  });
  define('chart-model.buildBGAOpacityTimelines', {
    run: (fixtures) => {
      const chart = {
        ...fixtures.emptyBmsJSON,
        bms: { ...fixtures.emptyBmsJSON.bms, argb: { '01': '128,40,175,48' } },
        events: [
          { measure: 0, position: [0, 1] as [number, number], channel: 'A2', value: '01' },
          { measure: 1, position: [0, 1] as [number, number], channel: '0C', value: '80' },
        ],
      };
      chartAPI.buildBGAOpacityTimelines(chart, chartAPI.createTimingResolver(chart));
    },
  });
  define('chart-model.pickBGATint', {
    run: () => {
      chartAPI.pickBGATint(
        [
          { seconds: 0, opacity: 1, tint: 0x28af30 },
          { seconds: 1, opacity: 0.5, tint: 0xead2ad },
        ],
        1.5,
      );
    },
  });
  define('chart-model.pickBGAOpacity', {
    run: () => {
      chartAPI.pickBGAOpacity(
        [
          { seconds: 0, opacity: 1 },
          { seconds: 1, opacity: 128 / 255 },
        ],
        1.5,
      );
    },
  });
  define('chart-model.resolvePoorBGAMode', {
    run: () => {
      chartAPI.resolvePoorBGAMode('1');
    },
  });
  define('chart-model.parseBPMFrom03Token', {
    run: () => {
      chartAPI.parseBPMFrom03Token('7F');
    },
  });
  define('chart-model.getMeasureBeats', {
    run: () => {
      chartAPI.getMeasureBeats(1.5);
    },
  });
  define('chart-model.measureToBeat', {
    run: (fixtures) => {
      chartAPI.measureToBeat(fixtures.sampleBmsJSON, 2, 0.5);
    },
  });
  define('chart-model.eventToBeat', {
    run: (fixtures) => {
      chartAPI.eventToBeat(fixtures.sampleBmsJSON, fixtures.eventA);
    },
  });
  define('chart-model.createBeatResolver', {
    run: (fixtures) => {
      chartAPI.createBeatResolver(fixtures.sampleBmsJSON);
    },
  });
  define('chart-model.sortEvents', {
    run: (fixtures) => {
      chartAPI.sortEvents(fixtures.sampleBmsJSON.events);
    },
  });
  define('chart-model.compareEvents', {
    run: (fixtures) => {
      chartAPI.compareEvents(fixtures.eventA, fixtures.eventB);
    },
  });
  define('chart-model.resolveChartPlayVariant', {
    run: (fixtures) => {
      chartAPI.resolveChartPlayVariant({
        chartPath: 'sample.bme',
        events: fixtures.sampleBmsJSON.events,
        bms: fixtures.sampleBmsJSON.bms,
      });
    },
  });
  define('chart-model.getPlayModeLayouts', {
    run: () => {
      chartAPI.getPlayModeLayouts('9');
    },
  });
  define('chart-model.findPlayModeLane', {
    run: () => {
      chartAPI.findPlayModeLane('48', '2Q');
    },
  });
  define('chart-model.resolvePlayLaneChannels', {
    run: () => {
      chartAPI.resolvePlayLaneChannels('1A');
    },
  });
  define('chart-model.resolveGenericBmsonKeyCount', {
    run: () => {
      chartAPI.resolveGenericBmsonKeyCount('generic-70keys');
      chartAPI.resolveGenericBmsonKeyCount('beat-7k');
    },
  });
  define('chart-model.resolveBmsonModeHintLayout', {
    run: () => {
      chartAPI.resolveBmsonModeHintLayout(' beat-10k ');
      chartAPI.resolveBmsonModeHintLayout('generic-70keys');
    },
  });
  define('chart-model.resolveChartReferenceBPM', {
    run: (fixtures) => {
      chartAPI.resolveChartReferenceBPM(fixtures.sampleBmsJSON, 120);
    },
  });
  let mainBPMChart: ReturnType<typeof chartAPI.resolveChart> | undefined;
  define('chart-model.resolveChartMainBPM', {
    run: (fixtures) => {
      mainBPMChart ??= chartAPI.resolveChart(fixtures.sampleBmsJSON, { chartPath: 'sample.bms' });
      chartAPI.resolveChartMainBPM(mainBPMChart);
    },
  });
  define('chart-model.parseBMSExWAV', {
    run: () => {
      chartAPI.parseBMSExWAV('pvf 1024,-200,48000 sample.wav');
    },
  });
  define('chart-model.exWAVVolumeMillibelsToLinearGain', {
    run: () => {
      chartAPI.exWAVVolumeMillibelsToLinearGain(-600);
    },
  });
  define('chart-model.collectBMSExWAVVolumeMultipliers', {
    run: () => {
      chartAPI.collectBMSExWAVVolumeMultipliers({
        '01': 'v -200 kick.wav',
        '02': 'pv 0,-600 snare.wav',
      });
    },
  });
  define('chart-model.parseBMSExBMP', {
    run: () => {
      chartAPI.parseBMSExBMP('255,0,0,0 backdrop.bmp');
    },
  });
  define('chart-model.parseBmsBGA', {
    run: () => {
      chartAPI.parseBmsBGA('02 0 0 256 256 0 0');
      chartAPI.parseBmsBGA('100 0 0 64 64 0 0', 62, true);
    },
  });
  define('chart-model.parseBmsARGB', {
    run: () => {
      chartAPI.parseBmsARGB('FF112233');
    },
  });
  define('chart-model.volWAVToLinearGain', {
    run: () => {
      chartAPI.volWAVToLinearGain(80);
    },
  });
  define('chart-model.wavCmdVolumePercentToLinearGain', {
    run: () => {
      chartAPI.wavCmdVolumePercentToLinearGain(64);
    },
  });
  define('chart-model.resolveBmsWAVResources', {
    run: () => {
      chartAPI.resolveBmsWAVResources(BENCH_EXWAV_CHART);
    },
  });
  define('chart-model.resolveReferencedBmsWAVResources', {
    run: () => {
      chartAPI.resolveReferencedBmsWAVResources(BENCH_EXWAV_CHART);
    },
  });
  define('chart-model.collectBmsWAVPlaybackModifiers', {
    run: () => {
      chartAPI.collectBmsWAVPlaybackModifiers(BENCH_EXWAV_CHART);
    },
  });
  define('chart-model.resolveBmsWAVPlayback', {
    run: () => {
      chartAPI.resolveBmsWAVPlayback({ semitones: 12, frequencyHz: 22050, pan: -600, durationSeconds: 0.1 }, 44100);
    },
  });
  define('chart-model.parseBmsWAVCmd', {
    run: () => {
      chartAPI.parseBmsWAVCmd('01 0A 64');
    },
  });
  define('chart-model.collectBmsWAVCmdVolumeMultipliers', {
    run: () => {
      chartAPI.collectBmsWAVCmdVolumeMultipliers(['01 0A 64', '00 0A 2', '01 0B 127']);
    },
  });
  define('chart-model.collectBmsWAVVolumeMultipliers', {
    run: () => {
      chartAPI.collectBmsWAVVolumeMultipliers({
        bms: { ...BENCH_EXWAV_CHART.bms, wavCmds: ['01 01 33'] },
        resources: { ...BENCH_EXWAV_CHART.resources, wavGain: { '01': 0.77 } },
      });
    },
  });
  define('chart-model.isTempoChannel', {
    run: () => {
      chartAPI.isTempoChannel('08');
    },
  });
  define('chart-model.isStopChannel', {
    run: () => {
      chartAPI.isStopChannel('09');
    },
  });
  define('chart-model.isScrollChannel', {
    run: () => {
      chartAPI.isScrollChannel('SC');
    },
  });
  define('chart-model.isLandmineChannel', {
    run: () => {
      chartAPI.isLandmineChannel('D1');
    },
  });
  define('chart-model.isSampleTriggerChannel', {
    run: () => {
      chartAPI.isSampleTriggerChannel('11');
    },
  });
  define('chart-model.isPlayableChannel', {
    run: () => {
      chartAPI.isPlayableChannel('11');
    },
  });
  define('chart-model.isPlayLaneSoundChannel', {
    run: () => {
      chartAPI.isPlayLaneSoundChannel('31');
    },
  });
  define('chart-model.mapBMSLongNoteChannelToPlayable', {
    run: () => {
      chartAPI.mapBMSLongNoteChannelToPlayable('51');
    },
  });
  define('chart-model.isBMSLongNoteChannel', {
    run: () => {
      chartAPI.isBMSLongNoteChannel('61');
    },
  });
  define('chart-model.isBmsBGMVolumeChangeChannel', {
    run: () => {
      chartAPI.isBmsBGMVolumeChangeChannel('97');
    },
  });
  define('chart-model.isBMSKeyVolumeChangeChannel', {
    run: () => {
      chartAPI.isBMSKeyVolumeChangeChannel('98');
    },
  });
  define('chart-model.isBMSDynamicVolumeChangeChannel', {
    run: () => {
      chartAPI.isBMSDynamicVolumeChangeChannel('97');
    },
  });
  define('chart-model.parseBMSDynamicVolumeGain', {
    run: () => {
      chartAPI.parseBMSDynamicVolumeGain('80');
    },
  });
  define('chart-model.usesMonophonicWAVPlayback', {
    run: (fixtures) => {
      chartAPI.usesMonophonicWAVPlayback(fixtures.sampleBmsJSON);
    },
  });
  define('chart-model.resolveBMSLongNotes', {
    run: (fixtures) => {
      chartAPI.resolveBMSLongNotes(fixtures.sampleBmsJSON, { inferLNTypeWhenMissing: true });
    },
  });
  define('chart-model.collectLNOBJEndEvents', {
    run: (fixtures) => {
      chartAPI.collectLNOBJEndEvents(fixtures.sampleBmsJSON);
    },
  });
  define('chart-model.resolveLNOBJLongNotes', {
    run: (fixtures) => {
      chartAPI.resolveLNOBJLongNotes(fixtures.sampleBmsJSON);
    },
  });
  define('chart-model.createChartFingerprintDocument', {
    run: (fixtures) => {
      chartAPI.createChartFingerprintDocument(fixtures.sampleBmsJSON, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart-model.createPlayFingerprintDocument', {
    run: (fixtures) => {
      chartAPI.createPlayFingerprintDocument(fixtures.sampleBmsJSON, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart-model.canonicalizeFingerprintDocument', {
    run: (fixtures) => {
      chartAPI.canonicalizeFingerprintDocument(getBenchFingerprintDocument(fixtures.sampleBmsJSON));
    },
  });
  define('chart-model.computeChartFingerprint', {
    run: (fixtures) => {
      chartAPI.computeChartFingerprint(fixtures.sampleBmsJSON, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart-model.canonicalizeJSONValue', {
    run: () => {
      chartAPI.canonicalizeJSONValue({
        v: 'bmcourse0',
        kind: 'grade',
        constraints: ['gauge_lr2', 'grade_mirror'],
        stages: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c', 'bmfp0:d'],
      });
    },
  });
  define('chart-model.sha256Hex', {
    run: () => {
      chartAPI.sha256Hex('bmcourse0 bench text: grade gauge_lr2 grade_mirror bmfp0:0123456789abcdef');
    },
  });
  define('chart-model.computeFingerprintOfDocument', {
    run: (fixtures) => {
      chartAPI.computeFingerprintOfDocument(getBenchFingerprintDocument(fixtures.sampleBmsJSON));
    },
  });
  define('chart-model.computePlayFingerprint', {
    run: (fixtures) => {
      chartAPI.computePlayFingerprint(fixtures.sampleBmsJSON, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart-model.drawRandomOutcomes', {
    run: (fixtures) => {
      chartAPI.drawRandomOutcomes(fixtures.controlFlowJSON, () => 0.25);
    },
  });
  define('chart-model.evaluateControlFlow', {
    run: (fixtures) => {
      chartAPI.evaluateControlFlow(fixtures.controlFlowJSON, benchRandomDraws(fixtures.controlFlowJSON));
    },
  });
  define('chart-model.hasControlFlow', {
    run: (fixtures) => {
      chartAPI.hasControlFlow(fixtures.controlFlowJSON);
    },
  });
  define('chart-model.createTimingResolver', {
    run: (fixtures) => {
      chartAPI.createTimingResolver(fixtures.sampleBmsJSON);
    },
  });
  define('chart-model.createTimingBuildContext', {
    run: (fixtures) => {
      chartAPI.createTimingBuildContext(fixtures.sampleBmsJSON);
    },
  });
  define('chart-model.createTimingResolverWithContext', {
    run: (fixtures) => {
      const context = chartAPI.createTimingBuildContext(fixtures.sampleBmsJSON);
      chartAPI.createTimingResolverWithContext(fixtures.sampleBmsJSON, context);
    },
  });
  define('chart-model.mirrorBeatAtTempoReversal', {
    run: () => {
      const reversal = { beat: 16, seconds: 7.5 };
      chartAPI.mirrorBeatAtTempoReversal(reversal, 5, 10);
      chartAPI.mirrorBeatAtTempoReversal(reversal, 9, 17.5);
      chartAPI.mirrorBeatAtTempoReversal(undefined, 9, 17.5);
    },
  });
  define('chart-model.firesBeforeTempoReversal', {
    run: () => {
      const reversal = { beat: 16, seconds: 7.5 };
      chartAPI.firesBeforeTempoReversal(reversal, 5, '01');
      chartAPI.firesBeforeTempoReversal(reversal, 7.5, '01');
      chartAPI.firesBeforeTempoReversal(reversal, 7.5, '11');
      chartAPI.firesBeforeTempoReversal(undefined, 9, '11');
    },
  });
  define('chart-model.collectSampleTriggers', {
    run: (fixtures) => {
      const resolver = chartAPI.createTimingResolver(fixtures.sampleBmsJSON);
      chartAPI.collectSampleTriggers(fixtures.sampleBmsJSON, resolver, { inferBmsLNTypeWhenMissing: true });
    },
  });
  define('chart-model.collectSampleTriggersWithContext', {
    run: (fixtures) => {
      const context = chartAPI.createTimingBuildContext(fixtures.sampleBmsJSON);
      const resolver = chartAPI.createTimingResolverWithContext(fixtures.sampleBmsJSON, context);
      chartAPI.collectSampleTriggersWithContext(fixtures.sampleBmsJSON, resolver, context, {
        inferBmsLNTypeWhenMissing: true,
      });
    },
  });
  define('chart-model.createBmsonSamplePlaybackMap', {
    run: (fixtures) => {
      const context = chartAPI.createTimingBuildContext(fixtures.sampleBmsonJSON);
      const resolver = chartAPI.createTimingResolverWithContext(fixtures.sampleBmsonJSON, context);
      chartAPI.createBmsonSamplePlaybackMap(
        fixtures.sampleBmsonJSON,
        resolver,
        fixtures.sampleBmsonJSON.events,
        context.beatResolver,
      );
    },
  });
  define('chart-model.createMeasureTimeline', {
    run: (fixtures) => {
      const json = fixtures.sampleBmsJSON;
      chartAPI.createMeasureTimeline(json, chartAPI.createTimingResolver(json), chartAPI.createBeatResolver(json));
    },
  });
  define('chart-model.createBPMTimeline', {
    run: (fixtures) => {
      chartAPI.createBPMTimeline(fixtures.sampleBmsJSON, chartAPI.createTimingResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart-model.createScrollTimeline', {
    run: (fixtures) => {
      chartAPI.createScrollTimeline(fixtures.sampleBmsJSON, chartAPI.createBeatResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart-model.createSpeedTimeline', {
    run: (fixtures) => {
      chartAPI.createSpeedTimeline(fixtures.sampleBmsJSON, chartAPI.createBeatResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart-model.createStopBeatWindows', {
    run: (fixtures) => {
      chartAPI.createStopBeatWindows(chartAPI.createTimingResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart-model.createBeatAtSecondsResolver', {
    run: (fixtures) => {
      chartAPI.createBeatAtSecondsResolver(fixtures.sampleBmsJSON)(1.5);
    },
  });
  define('chart-model.createBeatAtSecondsResolverFromTimingResolver', {
    run: (fixtures) => {
      chartAPI.createBeatAtSecondsResolverFromTimingResolver(chartAPI.createTimingResolver(fixtures.sampleBmsJSON))(
        1.5,
      );
    },
  });
  define('chart-model.createMeasureBoundariesBeats', {
    run: (fixtures) => {
      chartAPI.createMeasureBoundariesBeats(
        fixtures.sampleBmsJSON,
        chartAPI.createBeatResolver(fixtures.sampleBmsJSON),
      );
    },
  });
  define('chart-model.buildBGATimelines', {
    run: (fixtures) => {
      chartAPI.buildBGATimelines(fixtures.sampleBmsJSON, chartAPI.createTimingResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart-model.buildBmsBGATimeline', {
    run: (fixtures) => {
      const json = fixtures.sampleBmsJSON;
      chartAPI.buildBmsBGATimeline(json.events, chartAPI.createTimingResolver(json), '04');
    },
  });
  define('chart-model.resolveChartLongNoteMode', {
    run: (fixtures) => {
      chartAPI.resolveChartLongNoteMode(fixtures.sampleBmsJSON);
      chartAPI.resolveChartLongNoteMode(BENCH_HDX_CHART);
    },
  });
  define('chart-model.resolveLandmineDamage', {
    run: () => {
      chartAPI.resolveLandmineDamage({ value: '0A' }, 36, 'bms');
    },
  });
  define('chart-model.resolveChart', {
    run: (fixtures) => {
      const resolved = chartAPI.resolveChart(fixtures.sampleBmsJSON, { chartPath: 'sample.bms' });
      void resolved.notes;
      void resolved.mines;
      void resolved.invisibleNotes;
      void resolved.sampleTriggers;
    },
  });
  define('chart-model.countScoredNotes', {
    run: (fixtures) => {
      chartAPI.countScoredNotes(fixtures.sampleBmsJSON, { chartPath: 'sample.bms', inferBmsLNTypeWhenMissing: true });
    },
  });
  define('chart-model.isInvisibleNoteChannel', {
    run: () => {
      chartAPI.isInvisibleNoteChannel('3A');
    },
  });
}
