import * as chartAPI from '@be-music/chart';
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

const BENCH_SWITCHING_BGA = chartAPI.parseBMSSwBGA('10:5:1:FF000000 02 03 04 05 06');
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

export function registerChartExportsCases(define: DefineBenchmarkCase): void {
  define('chart.parseBPMFrom03Token', {
    run: () => {
      chartAPI.parseBPMFrom03Token('7F');
    },
  });
  define('chart.getMeasureBeats', {
    run: () => {
      chartAPI.getMeasureBeats(1.5);
    },
  });
  define('chart.measureToBeat', {
    run: (fixtures) => {
      chartAPI.measureToBeat(fixtures.sampleBmsJSON, 2, 0.5);
    },
  });
  define('chart.eventToBeat', {
    run: (fixtures) => {
      chartAPI.eventToBeat(fixtures.sampleBmsJSON, fixtures.eventA);
    },
  });
  define('chart.createBeatResolver', {
    run: (fixtures) => {
      chartAPI.createBeatResolver(fixtures.sampleBmsJSON);
    },
  });
  define('chart.sortEvents', {
    run: (fixtures) => {
      chartAPI.sortEvents(fixtures.sampleBmsJSON.events);
    },
  });
  define('chart.compareEvents', {
    run: (fixtures) => {
      chartAPI.compareEvents(fixtures.eventA, fixtures.eventB);
    },
  });
  define('chart.resolveChartPlayVariant', {
    run: (fixtures) => {
      chartAPI.resolveChartPlayVariant({
        chartPath: 'sample.bme',
        events: fixtures.sampleBmsJSON.events,
        bms: fixtures.sampleBmsJSON.bms,
      });
    },
  });
  define('chart.getPlayModeLayouts', {
    run: () => {
      chartAPI.getPlayModeLayouts('9');
    },
  });
  define('chart.findPlayModeLane', {
    run: () => {
      chartAPI.findPlayModeLane('48', '2Q');
    },
  });
  define('chart.resolvePlayLaneChannels', {
    run: () => {
      chartAPI.resolvePlayLaneChannels('1A');
    },
  });
  define('chart.resolveBmsonModeHintLayout', {
    run: () => {
      chartAPI.resolveBmsonModeHintLayout(' beat-10k ');
    },
  });
  define('chart.resolveChartReferenceBPM', {
    run: (fixtures) => {
      chartAPI.resolveChartReferenceBPM(fixtures.sampleBmsJSON, 120);
    },
  });
  let mainBPMChart: ReturnType<typeof chartAPI.resolveChart> | undefined;
  define('chart.resolveChartMainBPM', {
    run: (fixtures) => {
      mainBPMChart ??= chartAPI.resolveChart(fixtures.sampleBmsJSON, { chartPath: 'sample.bms' });
      chartAPI.resolveChartMainBPM(mainBPMChart);
    },
  });
  define('chart.parseBMSExWAV', {
    run: () => {
      chartAPI.parseBMSExWAV('pvf 1024,-200,48000 sample.wav');
    },
  });
  define('chart.exWAVVolumeCentibelsToLinearGain', {
    run: () => {
      chartAPI.exWAVVolumeCentibelsToLinearGain(-600);
    },
  });
  define('chart.collectBMSExWAVVolumeMultipliers', {
    run: () => {
      chartAPI.collectBMSExWAVVolumeMultipliers({
        '01': 'v -200 kick.wav',
        '02': 'pv 0,-600 snare.wav',
      });
    },
  });
  define('chart.parseBMSExBMP', {
    run: () => {
      chartAPI.parseBMSExBMP('255,0,0,0,backdrop.bmp');
    },
  });
  define('chart.resolveBmsBmpARGB', {
    run: (fixtures) => {
      chartAPI.resolveBmsBmpARGB(fixtures.sampleBmsJSON, '01');
    },
  });
  define('chart.parseBMSSwBGA', {
    run: () => {
      chartAPI.parseBMSSwBGA('10:5:1:FF000000 02 03 04 05 06');
    },
  });
  define('chart.pickSwitchingBGAFrame', {
    run: () => {
      if (BENCH_SWITCHING_BGA) {
        chartAPI.pickSwitchingBGAFrame(BENCH_SWITCHING_BGA, 350);
      }
    },
  });
  define('chart.parseBmsBGA', {
    run: () => {
      chartAPI.parseBmsBGA('02 0 0 256 256 0 0');
    },
  });
  define('chart.parseBmsARGB', {
    run: () => {
      chartAPI.parseBmsARGB('FF112233');
    },
  });
  define('chart.volWAVToLinearGain', {
    run: () => {
      chartAPI.volWAVToLinearGain(80);
    },
  });
  define('chart.wavCmdVolumeByteToLinearGain', {
    run: () => {
      chartAPI.wavCmdVolumeByteToLinearGain(64);
    },
  });
  define('chart.parseBmsWAVCmd', {
    run: () => {
      chartAPI.parseBmsWAVCmd('01 0A 64');
    },
  });
  define('chart.collectBmsWAVCmdVolumeMultipliers', {
    run: () => {
      chartAPI.collectBmsWAVCmdVolumeMultipliers(['01 0A 64', '00 0A 2', '01 0B 127']);
    },
  });
  define('chart.isTempoChannel', {
    run: () => {
      chartAPI.isTempoChannel('08');
    },
  });
  define('chart.isStopChannel', {
    run: () => {
      chartAPI.isStopChannel('09');
    },
  });
  define('chart.isScrollChannel', {
    run: () => {
      chartAPI.isScrollChannel('SC');
    },
  });
  define('chart.isLandmineChannel', {
    run: () => {
      chartAPI.isLandmineChannel('D1');
    },
  });
  define('chart.isSampleTriggerChannel', {
    run: () => {
      chartAPI.isSampleTriggerChannel('11');
    },
  });
  define('chart.isPlayableChannel', {
    run: () => {
      chartAPI.isPlayableChannel('11');
    },
  });
  define('chart.isPlayLaneSoundChannel', {
    run: () => {
      chartAPI.isPlayLaneSoundChannel('31');
    },
  });
  define('chart.mapBMSLongNoteChannelToPlayable', {
    run: () => {
      chartAPI.mapBMSLongNoteChannelToPlayable('51');
    },
  });
  define('chart.isBMSLongNoteChannel', {
    run: () => {
      chartAPI.isBMSLongNoteChannel('61');
    },
  });
  define('chart.isBmsBGMVolumeChangeChannel', {
    run: () => {
      chartAPI.isBmsBGMVolumeChangeChannel('97');
    },
  });
  define('chart.isBMSKeyVolumeChangeChannel', {
    run: () => {
      chartAPI.isBMSKeyVolumeChangeChannel('98');
    },
  });
  define('chart.isBMSDynamicVolumeChangeChannel', {
    run: () => {
      chartAPI.isBMSDynamicVolumeChangeChannel('97');
    },
  });
  define('chart.parseBMSDynamicVolumeGain', {
    run: () => {
      chartAPI.parseBMSDynamicVolumeGain('80');
    },
  });
  define('chart.usesMonophonicWAVPlayback', {
    run: (fixtures) => {
      chartAPI.usesMonophonicWAVPlayback(fixtures.sampleBmsJSON);
    },
  });
  define('chart.resolveBMSLongNotes', {
    run: (fixtures) => {
      chartAPI.resolveBMSLongNotes(fixtures.sampleBmsJSON, { inferLNTypeWhenMissing: true });
    },
  });
  define('chart.collectLNOBJEndEvents', {
    run: (fixtures) => {
      chartAPI.collectLNOBJEndEvents(fixtures.sampleBmsJSON);
    },
  });
  define('chart.resolveLNOBJLongNotes', {
    run: (fixtures) => {
      chartAPI.resolveLNOBJLongNotes(fixtures.sampleBmsJSON);
    },
  });
  define('chart.createChartFingerprintDocument', {
    run: (fixtures) => {
      chartAPI.createChartFingerprintDocument(fixtures.sampleBmsJSON, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart.createPlayFingerprintDocument', {
    run: (fixtures) => {
      chartAPI.createPlayFingerprintDocument(fixtures.sampleBmsJSON, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart.canonicalizeFingerprintDocument', {
    run: (fixtures) => {
      chartAPI.canonicalizeFingerprintDocument(getBenchFingerprintDocument(fixtures.sampleBmsJSON));
    },
  });
  define('chart.computeChartFingerprint', {
    run: (fixtures) => {
      chartAPI.computeChartFingerprint(fixtures.sampleBmsJSON, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart.canonicalizeJSONValue', {
    run: () => {
      chartAPI.canonicalizeJSONValue({
        v: 'bmcourse0',
        kind: 'grade',
        constraints: ['gauge_lr2', 'grade_mirror'],
        stages: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c', 'bmfp0:d'],
      });
    },
  });
  define('chart.sha256Hex', {
    run: () => {
      chartAPI.sha256Hex('bmcourse0 bench text: grade gauge_lr2 grade_mirror bmfp0:0123456789abcdef');
    },
  });
  define('chart.computeFingerprintOfDocument', {
    run: (fixtures) => {
      chartAPI.computeFingerprintOfDocument(getBenchFingerprintDocument(fixtures.sampleBmsJSON));
    },
  });
  define('chart.computePlayFingerprint', {
    run: (fixtures) => {
      chartAPI.computePlayFingerprint(fixtures.sampleBmsJSON, BENCH_FINGERPRINT_OPTIONS);
    },
  });
  define('chart.drawRandomOutcomes', {
    run: (fixtures) => {
      chartAPI.drawRandomOutcomes(fixtures.controlFlowJSON, () => 0.25);
    },
  });
  define('chart.evaluateControlFlow', {
    run: (fixtures) => {
      chartAPI.evaluateControlFlow(fixtures.controlFlowJSON, benchRandomDraws(fixtures.controlFlowJSON));
    },
  });
  define('chart.hasControlFlow', {
    run: (fixtures) => {
      chartAPI.hasControlFlow(fixtures.controlFlowJSON);
    },
  });
  define('chart.createTimingResolver', {
    run: (fixtures) => {
      chartAPI.createTimingResolver(fixtures.sampleBmsJSON);
    },
  });
  define('chart.createTimingBuildContext', {
    run: (fixtures) => {
      chartAPI.createTimingBuildContext(fixtures.sampleBmsJSON);
    },
  });
  define('chart.createTimingResolverWithContext', {
    run: (fixtures) => {
      const context = chartAPI.createTimingBuildContext(fixtures.sampleBmsJSON);
      chartAPI.createTimingResolverWithContext(fixtures.sampleBmsJSON, context);
    },
  });
  define('chart.mirrorBeatAtTempoReversal', {
    run: () => {
      const reversal = { beat: 16, seconds: 7.5 };
      chartAPI.mirrorBeatAtTempoReversal(reversal, 5, 10);
      chartAPI.mirrorBeatAtTempoReversal(reversal, 9, 17.5);
      chartAPI.mirrorBeatAtTempoReversal(undefined, 9, 17.5);
    },
  });
  define('chart.firesBeforeTempoReversal', {
    run: () => {
      const reversal = { beat: 16, seconds: 7.5 };
      chartAPI.firesBeforeTempoReversal(reversal, 5, '01');
      chartAPI.firesBeforeTempoReversal(reversal, 7.5, '01');
      chartAPI.firesBeforeTempoReversal(reversal, 7.5, '11');
      chartAPI.firesBeforeTempoReversal(undefined, 9, '11');
    },
  });
  define('chart.collectSampleTriggers', {
    run: (fixtures) => {
      const resolver = chartAPI.createTimingResolver(fixtures.sampleBmsJSON);
      chartAPI.collectSampleTriggers(fixtures.sampleBmsJSON, resolver, { inferBmsLNTypeWhenMissing: true });
    },
  });
  define('chart.collectSampleTriggersWithContext', {
    run: (fixtures) => {
      const context = chartAPI.createTimingBuildContext(fixtures.sampleBmsJSON);
      const resolver = chartAPI.createTimingResolverWithContext(fixtures.sampleBmsJSON, context);
      chartAPI.collectSampleTriggersWithContext(fixtures.sampleBmsJSON, resolver, context, {
        inferBmsLNTypeWhenMissing: true,
      });
    },
  });
  define('chart.createBmsonSamplePlaybackMap', {
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
  define('chart.createMeasureTimeline', {
    run: (fixtures) => {
      const json = fixtures.sampleBmsJSON;
      chartAPI.createMeasureTimeline(json, chartAPI.createTimingResolver(json), chartAPI.createBeatResolver(json));
    },
  });
  define('chart.createBPMTimeline', {
    run: (fixtures) => {
      chartAPI.createBPMTimeline(fixtures.sampleBmsJSON, chartAPI.createTimingResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart.createScrollTimeline', {
    run: (fixtures) => {
      chartAPI.createScrollTimeline(fixtures.sampleBmsJSON, chartAPI.createBeatResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart.createSpeedTimeline', {
    run: (fixtures) => {
      chartAPI.createSpeedTimeline(fixtures.sampleBmsJSON, chartAPI.createBeatResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart.createStopBeatWindows', {
    run: (fixtures) => {
      chartAPI.createStopBeatWindows(chartAPI.createTimingResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart.createBeatAtSecondsResolver', {
    run: (fixtures) => {
      chartAPI.createBeatAtSecondsResolver(fixtures.sampleBmsJSON)(1.5);
    },
  });
  define('chart.createBeatAtSecondsResolverFromTimingResolver', {
    run: (fixtures) => {
      chartAPI.createBeatAtSecondsResolverFromTimingResolver(chartAPI.createTimingResolver(fixtures.sampleBmsJSON))(
        1.5,
      );
    },
  });
  define('chart.createMeasureBoundariesBeats', {
    run: (fixtures) => {
      chartAPI.createMeasureBoundariesBeats(
        fixtures.sampleBmsJSON,
        chartAPI.createBeatResolver(fixtures.sampleBmsJSON),
      );
    },
  });
  define('chart.buildBGATimelines', {
    run: (fixtures) => {
      chartAPI.buildBGATimelines(fixtures.sampleBmsJSON, chartAPI.createTimingResolver(fixtures.sampleBmsJSON));
    },
  });
  define('chart.buildBmsBGATimeline', {
    run: (fixtures) => {
      const json = fixtures.sampleBmsJSON;
      chartAPI.buildBmsBGATimeline(json.events, chartAPI.createTimingResolver(json), '04');
    },
  });
  define('chart.resolveChartLongNoteMode', {
    run: (fixtures) => {
      chartAPI.resolveChartLongNoteMode(fixtures.sampleBmsJSON);
    },
  });
  define('chart.resolveLandmineDamage', {
    run: () => {
      chartAPI.resolveLandmineDamage({ value: '0A' }, 36, 'bms');
    },
  });
  define('chart.resolveChart', {
    run: (fixtures) => {
      const resolved = chartAPI.resolveChart(fixtures.sampleBmsJSON, { chartPath: 'sample.bms' });
      void resolved.notes;
      void resolved.mines;
      void resolved.invisibleNotes;
      void resolved.sampleTriggers;
    },
  });
  define('chart.countScoredNotes', {
    run: (fixtures) => {
      chartAPI.countScoredNotes(fixtures.sampleBmsJSON, { chartPath: 'sample.bms', inferBmsLNTypeWhenMissing: true });
    },
  });
  define('chart.isInvisibleNoteChannel', {
    run: () => {
      chartAPI.isInvisibleNoteChannel('3A');
    },
  });
}
