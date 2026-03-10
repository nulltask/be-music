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
  define('json.ensureMeasure', {
    run: (fixtures) => {
      const cloned = jsonApi.cloneJson(fixtures.sampleBmsJson);
      jsonApi.ensureMeasure(cloned, 32);
    },
  });
}
