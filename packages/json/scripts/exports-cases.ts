import * as jsonApi from '@be-music/json';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerJsonExportsCases(define: DefineBenchmarkCase): void {
  define('json.createEmptyJson', {
    run: () => {
      jsonApi.createEmptyJson('bms');
    },
  });
  define('json.cloneJson', {
    run: (fixtures) => {
      jsonApi.cloneJson(fixtures.sampleBmsJson);
    },
  });
  define('json.normalizeObjectKey', {
    run: () => {
      jsonApi.normalizeObjectKey('aZ');
    },
  });
  define('json.normalizeChannel', {
    run: () => {
      jsonApi.normalizeChannel('1a');
    },
  });
  define('json.intToBase36', {
    run: () => {
      jsonApi.intToBase36(12_345, 2);
    },
  });
  define('json.parseBpmFrom03Token', {
    run: () => {
      jsonApi.parseBpmFrom03Token('7F');
    },
  });
  define('json.ensureMeasure', {
    run: (fixtures) => {
      const cloned = jsonApi.cloneJson(fixtures.sampleBmsJson);
      jsonApi.ensureMeasure(cloned, 32);
    },
  });
  define('json.getMeasureBeats', {
    run: () => {
      jsonApi.getMeasureBeats(1.5);
    },
  });
  define('json.measureToBeat', {
    run: (fixtures) => {
      jsonApi.measureToBeat(fixtures.sampleBmsJson, 2, 0.5);
    },
  });
  define('json.eventToBeat', {
    run: (fixtures) => {
      jsonApi.eventToBeat(fixtures.sampleBmsJson, fixtures.eventA);
    },
  });
  define('json.createBeatResolver', {
    run: (fixtures) => {
      jsonApi.createBeatResolver(fixtures.sampleBmsJson);
    },
  });
  define('json.sortEvents', {
    run: (fixtures) => {
      jsonApi.sortEvents(fixtures.sampleBmsJson.events);
    },
  });
  define('json.compareEvents', {
    run: (fixtures) => {
      jsonApi.compareEvents(fixtures.eventA, fixtures.eventB);
    },
  });
  define('json.isTempoChannel', {
    run: () => {
      jsonApi.isTempoChannel('08');
    },
  });
  define('json.isStopChannel', {
    run: () => {
      jsonApi.isStopChannel('09');
    },
  });
  define('json.isScrollChannel', {
    run: () => {
      jsonApi.isScrollChannel('SC');
    },
  });
  define('json.isLandmineChannel', {
    run: () => {
      jsonApi.isLandmineChannel('D1');
    },
  });
  define('json.isSampleTriggerChannel', {
    run: () => {
      jsonApi.isSampleTriggerChannel('11');
    },
  });
  define('json.isPlayableChannel', {
    run: () => {
      jsonApi.isPlayableChannel('11');
    },
  });
  define('json.mapBmsLongNoteChannelToPlayable', {
    run: () => {
      jsonApi.mapBmsLongNoteChannelToPlayable('51');
    },
  });
  define('json.isBmsLongNoteChannel', {
    run: () => {
      jsonApi.isBmsLongNoteChannel('61');
    },
  });
  define('json.resolveBmsLongNotes', {
    run: (fixtures) => {
      jsonApi.resolveBmsLongNotes(fixtures.sampleBmsJson, { inferLnTypeWhenMissing: true });
    },
  });
  define('json.collectLnobjEndEvents', {
    run: (fixtures) => {
      jsonApi.collectLnobjEndEvents(fixtures.sampleBmsJson);
    },
  });
  define('json.resolveLnobjLongNotes', {
    run: (fixtures) => {
      jsonApi.resolveLnobjLongNotes(fixtures.sampleBmsJson);
    },
  });
}
