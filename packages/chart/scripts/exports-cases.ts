import * as chartApi from '@be-music/chart';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_RANDOM_DRAWS_CACHE = new WeakMap<object, chartApi.RandomDraws>();

function benchRandomDraws(source: chartApi.ControlFlowSource): chartApi.RandomDraws {
  let draws = BENCH_RANDOM_DRAWS_CACHE.get(source);
  if (draws === undefined) {
    draws = chartApi.drawRandomOutcomes(source, () => 0.25);
    BENCH_RANDOM_DRAWS_CACHE.set(source, draws);
  }
  return draws;
}

const BENCH_SWITCHING_BGA = chartApi.parseBmsSwBga('10:5:1:FF000000 02 03 04 05 06');
const BENCH_FINGERPRINT_OPTIONS: chartApi.BeMusicFingerprintOptions = { chartPath: 'sample.bms' };
const BENCH_FINGERPRINT_DOCUMENTS = new WeakMap<object, chartApi.BeMusicFingerprintDocument>();

function getBenchFingerprintDocument(
  json: Parameters<typeof chartApi.createChartFingerprintDocument>[0],
): chartApi.BeMusicFingerprintDocument {
  let document = BENCH_FINGERPRINT_DOCUMENTS.get(json);
  if (!document) {
    document = chartApi.createChartFingerprintDocument(json, BENCH_FINGERPRINT_OPTIONS);
    BENCH_FINGERPRINT_DOCUMENTS.set(json, document);
  }
  return document;
}

export function registerChartExportsCases(define: DefineBenchmarkCase): void {
  define('chart.parseBpmFrom03Token', {
    run: () => {
      chartApi.parseBpmFrom03Token('7F');
    },
  });
  define('chart.getMeasureBeats', {
    run: () => {
      chartApi.getMeasureBeats(1.5);
    },
  });
  define('chart.measureToBeat', {
    run: (fixtures) => {
      chartApi.measureToBeat(fixtures.sampleBmsJson, 2, 0.5);
    },
  });
  define('chart.eventToBeat', {
    run: (fixtures) => {
      chartApi.eventToBeat(fixtures.sampleBmsJson, fixtures.eventA);
    },
  });
  define('chart.createBeatResolver', {
    run: (fixtures) => {
      chartApi.createBeatResolver(fixtures.sampleBmsJson);
    },
  });
  define('chart.sortEvents', {
    run: (fixtures) => {
      chartApi.sortEvents(fixtures.sampleBmsJson.events);
    },
  });
  define('chart.compareEvents', {
    run: (fixtures) => {
      chartApi.compareEvents(fixtures.eventA, fixtures.eventB);
    },
  });
  define('chart.resolveChartPlayVariant', {
    run: (fixtures) => {
      chartApi.resolveChartPlayVariant({
        chartPath: 'sample.bme',
        events: fixtures.sampleBmsJson.events,
        bms: fixtures.sampleBmsJson.bms,
      });
    },
  });
  define('chart.getPlayModeLayouts', {
    run: () => {
      chartApi.getPlayModeLayouts('9');
    },
  });
  define('chart.findPlayModeLane', {
    run: () => {
      chartApi.findPlayModeLane('48', '2Q');
    },
  });
  define('chart.resolvePlayLaneChannels', {
    run: () => {
      chartApi.resolvePlayLaneChannels('1A');
    },
  });
  define('chart.resolveBmsonModeHintLayout', {
    run: () => {
      chartApi.resolveBmsonModeHintLayout(' beat-10k ');
    },
  });
  define('chart.resolveChartReferenceBpm', {
    run: (fixtures) => {
      chartApi.resolveChartReferenceBpm(fixtures.sampleBmsJson, 120);
    },
  });
  define('chart.parseBmsExWav', {
    run: () => {
      chartApi.parseBmsExWav('pvf 1024,-200,48000 sample.wav');
    },
  });
  define('chart.exWavVolumeCentibelsToLinearGain', {
    run: () => {
      chartApi.exWavVolumeCentibelsToLinearGain(-600);
    },
  });
  define('chart.collectBmsExWavVolumeMultipliers', {
    run: () => {
      chartApi.collectBmsExWavVolumeMultipliers({
        '01': 'v -200 kick.wav',
        '02': 'pv 0,-600 snare.wav',
      });
    },
  });
  define('chart.parseBmsExBmp', {
    run: () => {
      chartApi.parseBmsExBmp('255,0,0,0,backdrop.bmp');
    },
  });
  define('chart.resolveBmsBmpArgb', {
    run: (fixtures) => {
      chartApi.resolveBmsBmpArgb(fixtures.sampleBmsJson, '01');
    },
  });
  define('chart.parseBmsSwBga', {
    run: () => {
      chartApi.parseBmsSwBga('10:5:1:FF000000 02 03 04 05 06');
    },
  });
  define('chart.pickSwitchingBgaFrame', {
    run: () => {
      if (BENCH_SWITCHING_BGA) {
        chartApi.pickSwitchingBgaFrame(BENCH_SWITCHING_BGA, 350);
      }
    },
  });
  define('chart.parseBmsBga', {
    run: () => {
      chartApi.parseBmsBga('02 0 0 256 256 0 0');
    },
  });
  define('chart.parseBmsArgb', {
    run: () => {
      chartApi.parseBmsArgb('FF112233');
    },
  });
  define('chart.volWavToLinearGain', {
    run: () => {
      chartApi.volWavToLinearGain(80);
    },
  });
  define('chart.wavCmdVolumeByteToLinearGain', {
    run: () => {
      chartApi.wavCmdVolumeByteToLinearGain(64);
    },
  });
  define('chart.parseBmsWavCmd', {
    run: () => {
      chartApi.parseBmsWavCmd('01 0A 64');
    },
  });
  define('chart.collectBmsWavCmdVolumeMultipliers', {
    run: () => {
      chartApi.collectBmsWavCmdVolumeMultipliers(['01 0A 64', '00 0A 2', '01 0B 127']);
    },
  });
  define('chart.isTempoChannel', {
    run: () => {
      chartApi.isTempoChannel('08');
    },
  });
  define('chart.isStopChannel', {
    run: () => {
      chartApi.isStopChannel('09');
    },
  });
  define('chart.isScrollChannel', {
    run: () => {
      chartApi.isScrollChannel('SC');
    },
  });
  define('chart.isLandmineChannel', {
    run: () => {
      chartApi.isLandmineChannel('D1');
    },
  });
  define('chart.isSampleTriggerChannel', {
    run: () => {
      chartApi.isSampleTriggerChannel('11');
    },
  });
  define('chart.isPlayableChannel', {
    run: () => {
      chartApi.isPlayableChannel('11');
    },
  });
  define('chart.isPlayLaneSoundChannel', {
    run: () => {
      chartApi.isPlayLaneSoundChannel('31');
    },
  });
  define('chart.mapBmsLongNoteChannelToPlayable', {
    run: () => {
      chartApi.mapBmsLongNoteChannelToPlayable('51');
    },
  });
  define('chart.isBmsLongNoteChannel', {
    run: () => {
      chartApi.isBmsLongNoteChannel('61');
    },
  });
  define('chart.isBmsBgmVolumeChangeChannel', {
    run: () => {
      chartApi.isBmsBgmVolumeChangeChannel('97');
    },
  });
  define('chart.isBmsKeyVolumeChangeChannel', {
    run: () => {
      chartApi.isBmsKeyVolumeChangeChannel('98');
    },
  });
  define('chart.isBmsDynamicVolumeChangeChannel', {
    run: () => {
      chartApi.isBmsDynamicVolumeChangeChannel('97');
    },
  });
  define('chart.parseBmsDynamicVolumeGain', {
    run: () => {
      chartApi.parseBmsDynamicVolumeGain('80');
    },
  });
  define('chart.usesMonophonicWavPlayback', {
    run: (fixtures) => {
      chartApi.usesMonophonicWavPlayback(fixtures.sampleBmsJson);
    },
  });
  define('chart.resolveBmsLongNotes', {
    run: (fixtures) => {
      chartApi.resolveBmsLongNotes(fixtures.sampleBmsJson, { inferLnTypeWhenMissing: true });
    },
  });
  define('chart.collectLnobjEndEvents', {
    run: (fixtures) => {
      chartApi.collectLnobjEndEvents(fixtures.sampleBmsJson);
    },
  });
  define('chart.resolveLnobjLongNotes', {
    run: (fixtures) => {
      chartApi.resolveLnobjLongNotes(fixtures.sampleBmsJson);
    },
  });
  define('chart.createChartFingerprintDocument', {
    run: (fixtures) => {
      chartApi.createChartFingerprintDocument(fixtures.sampleBmsJson, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart.createPlayFingerprintDocument', {
    run: (fixtures) => {
      chartApi.createPlayFingerprintDocument(fixtures.sampleBmsJson, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart.canonicalizeFingerprintDocument', {
    run: (fixtures) => {
      chartApi.canonicalizeFingerprintDocument(getBenchFingerprintDocument(fixtures.sampleBmsJson));
    },
  });
  define('chart.computeChartFingerprint', {
    run: (fixtures) => {
      chartApi.computeChartFingerprint(fixtures.sampleBmsJson, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart.computePlayFingerprint', {
    run: (fixtures) => {
      chartApi.computePlayFingerprint(fixtures.sampleBmsJson, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart.drawRandomOutcomes', {
    run: (fixtures) => {
      chartApi.drawRandomOutcomes(fixtures.controlFlowJson, () => 0.25);
    },
  });
  define('chart.evaluateControlFlow', {
    run: (fixtures) => {
      chartApi.evaluateControlFlow(fixtures.controlFlowJson, benchRandomDraws(fixtures.controlFlowJson));
    },
  });
  define('chart.hasControlFlow', {
    run: (fixtures) => {
      chartApi.hasControlFlow(fixtures.controlFlowJson);
    },
  });
  define('chart.createTimingResolver', {
    run: (fixtures) => {
      chartApi.createTimingResolver(fixtures.sampleBmsJson);
    },
  });
  define('chart.createTimingBuildContext', {
    run: (fixtures) => {
      chartApi.createTimingBuildContext(fixtures.sampleBmsJson);
    },
  });
  define('chart.createTimingResolverWithContext', {
    run: (fixtures) => {
      const context = chartApi.createTimingBuildContext(fixtures.sampleBmsJson);
      chartApi.createTimingResolverWithContext(fixtures.sampleBmsJson, context);
    },
  });
  define('chart.collectSampleTriggers', {
    run: (fixtures) => {
      const resolver = chartApi.createTimingResolver(fixtures.sampleBmsJson);
      chartApi.collectSampleTriggers(fixtures.sampleBmsJson, resolver, { inferBmsLnTypeWhenMissing: true });
    },
  });
  define('chart.collectSampleTriggersWithContext', {
    run: (fixtures) => {
      const context = chartApi.createTimingBuildContext(fixtures.sampleBmsJson);
      const resolver = chartApi.createTimingResolverWithContext(fixtures.sampleBmsJson, context);
      chartApi.collectSampleTriggersWithContext(fixtures.sampleBmsJson, resolver, context, {
        inferBmsLnTypeWhenMissing: true,
      });
    },
  });
  define('chart.createBmsonSamplePlaybackMap', {
    run: (fixtures) => {
      const context = chartApi.createTimingBuildContext(fixtures.sampleBmsonJson);
      const resolver = chartApi.createTimingResolverWithContext(fixtures.sampleBmsonJson, context);
      chartApi.createBmsonSamplePlaybackMap(
        fixtures.sampleBmsonJson,
        resolver,
        fixtures.sampleBmsonJson.events,
        context.beatResolver,
      );
    },
  });
  define('chart.createMeasureTimeline', {
    run: (fixtures) => {
      const json = fixtures.sampleBmsJson;
      chartApi.createMeasureTimeline(json, chartApi.createTimingResolver(json), chartApi.createBeatResolver(json));
    },
  });
  define('chart.createBpmTimeline', {
    run: (fixtures) => {
      chartApi.createBpmTimeline(fixtures.sampleBmsJson, chartApi.createTimingResolver(fixtures.sampleBmsJson));
    },
  });
  define('chart.createScrollTimeline', {
    run: (fixtures) => {
      chartApi.createScrollTimeline(fixtures.sampleBmsJson, chartApi.createBeatResolver(fixtures.sampleBmsJson));
    },
  });
  define('chart.createSpeedTimeline', {
    run: (fixtures) => {
      chartApi.createSpeedTimeline(fixtures.sampleBmsJson, chartApi.createBeatResolver(fixtures.sampleBmsJson));
    },
  });
  define('chart.createStopBeatWindows', {
    run: (fixtures) => {
      chartApi.createStopBeatWindows(chartApi.createTimingResolver(fixtures.sampleBmsJson));
    },
  });
  define('chart.createBeatAtSecondsResolver', {
    run: (fixtures) => {
      chartApi.createBeatAtSecondsResolver(fixtures.sampleBmsJson)(1.5);
    },
  });
  define('chart.createBeatAtSecondsResolverFromTimingResolver', {
    run: (fixtures) => {
      chartApi.createBeatAtSecondsResolverFromTimingResolver(chartApi.createTimingResolver(fixtures.sampleBmsJson))(
        1.5,
      );
    },
  });
  define('chart.createMeasureBoundariesBeats', {
    run: (fixtures) => {
      chartApi.createMeasureBoundariesBeats(
        fixtures.sampleBmsJson,
        chartApi.createBeatResolver(fixtures.sampleBmsJson),
      );
    },
  });
  define('chart.buildBgaTimelines', {
    run: (fixtures) => {
      chartApi.buildBgaTimelines(fixtures.sampleBmsJson, chartApi.createTimingResolver(fixtures.sampleBmsJson));
    },
  });
  define('chart.buildBmsBgaTimeline', {
    run: (fixtures) => {
      const json = fixtures.sampleBmsJson;
      chartApi.buildBmsBgaTimeline(json.events, chartApi.createTimingResolver(json), '04');
    },
  });
  define('chart.resolveChartLongNoteMode', {
    run: (fixtures) => {
      chartApi.resolveChartLongNoteMode(fixtures.sampleBmsJson);
    },
  });
  define('chart.resolveLandmineDamage', {
    run: () => {
      chartApi.resolveLandmineDamage({ value: '0A' }, 36, 'bms');
    },
  });
  define('chart.resolveChart', {
    run: (fixtures) => {
      const resolved = chartApi.resolveChart(fixtures.sampleBmsJson, { chartPath: 'sample.bms' });
      void resolved.notes;
      void resolved.mines;
      void resolved.invisibleNotes;
      void resolved.sampleTriggers;
    },
  });
  define('chart.isInvisibleNoteChannel', {
    run: () => {
      chartApi.isInvisibleNoteChannel('3A');
    },
  });
}
