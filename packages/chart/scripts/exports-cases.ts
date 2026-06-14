import * as chartApi from '@be-music/chart';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_SWITCHING_BGA = chartApi.parseBmsSwBga('10:5:1:FF000000 02 03 04 05 06');

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
}
