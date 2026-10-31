import * as jsonAPI from '@be-music/chart-source';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerJSONExportsCases(define: DefineBenchmarkCase): void {
  define('chart-source.cloneJSONFields', {
    run: () => {
      jsonAPI.cloneJSONFields({ vendor: { values: [null, 1, false] } });
    },
  });
  define('chart-source.collectBmsonExtraFields', {
    run: () => {
      jsonAPI.collectBmsonExtraFields({ x: 1, y: 0, vendor: { values: [1] } }, 'note');
    },
  });
  define('chart-source.createEmptyJSON', {
    run: () => {
      jsonAPI.createEmptyJSON('bms');
    },
  });
  define('chart-source.cloneJSON', {
    run: (fixtures) => {
      jsonAPI.cloneJSON(fixtures.sampleBmsJSON);
      jsonAPI.cloneJSON({
        ...fixtures.sampleBmsJSON,
        bmson: {
          ...fixtures.sampleBmsJSON.bmson,
          extraFields: { vendor: { tags: [1, null] } },
          channelExtraFields: { '01': { vendor: ['channel'] } },
        },
      });
      jsonAPI.cloneJSON({
        ...fixtures.sampleBmsJSON,
        resources: { ...fixtures.sampleBmsJSON.resources, wavGain: { '01': 0.77 } },
      });
    },
  });
  define('chart-source.normalizeObjectKey', {
    run: () => {
      jsonAPI.normalizeObjectKey('aZ');
      jsonAPI.normalizeObjectKey('aZ1', 62, true);
    },
  });
  define('chart-source.normalizeChannel', {
    run: () => {
      jsonAPI.normalizeChannel('1a');
    },
  });
  define('chart-source.parseBmsonSubartist', {
    run: () => {
      jsonAPI.parseBmsonSubartist('illust:bench');
      jsonAPI.parseBmsonSubartist('Anonymous');
    },
  });
  define('chart-source.resolveBMSBase', {
    run: (fixtures) => {
      jsonAPI.resolveBMSBase(fixtures.sampleBmsJSON);
    },
  });
  define('chart-source.intToBase36', {
    run: () => {
      jsonAPI.intToBase36(12_345, 2);
    },
  });
  define('chart-source.ensureMeasure', {
    run: (fixtures) => {
      const cloned = jsonAPI.cloneJSON(fixtures.sampleBmsJSON);
      jsonAPI.ensureMeasure(cloned, 32);
    },
  });
}
