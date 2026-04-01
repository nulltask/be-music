import * as chartApi from '@be-music/chart';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

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
