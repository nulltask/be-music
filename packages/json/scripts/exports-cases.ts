import * as jsonAPI from '@be-music/json';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerJSONExportsCases(define: DefineBenchmarkCase): void {
  define('json.createEmptyJSON', {
    run: () => {
      jsonAPI.createEmptyJSON('bms');
    },
  });
  define('json.cloneJSON', {
    run: (fixtures) => {
      jsonAPI.cloneJSON(fixtures.sampleBmsJSON);
    },
  });
  define('json.normalizeObjectKey', {
    run: () => {
      jsonAPI.normalizeObjectKey('aZ');
    },
  });
  define('json.normalizeChannel', {
    run: () => {
      jsonAPI.normalizeChannel('1a');
    },
  });
  define('json.parseBmsonSubartist', {
    run: () => {
      jsonAPI.parseBmsonSubartist('illust:bench');
      jsonAPI.parseBmsonSubartist('Anonymous');
    },
  });
  define('json.resolveBMSBase', {
    run: (fixtures) => {
      jsonAPI.resolveBMSBase(fixtures.sampleBmsJSON);
    },
  });
  define('json.intToBase36', {
    run: () => {
      jsonAPI.intToBase36(12_345, 2);
    },
  });
  define('json.ensureMeasure', {
    run: (fixtures) => {
      const cloned = jsonAPI.cloneJSON(fixtures.sampleBmsJSON);
      jsonAPI.ensureMeasure(cloned, 32);
    },
  });
}
