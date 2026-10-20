import { drawRandomOutcomes, type RandomDraws } from '@be-music/chart-model';
import * as parserAPI from '@be-music/chart-parser';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_RANDOM_DRAWS_CACHE = new WeakMap<object, RandomDraws>();

function benchRandomDraws(source: Parameters<typeof drawRandomOutcomes>[0]): RandomDraws {
  let draws = BENCH_RANDOM_DRAWS_CACHE.get(source);
  if (draws === undefined) {
    draws = drawRandomOutcomes(source, () => 0.25);
    BENCH_RANDOM_DRAWS_CACHE.set(source, draws);
  }
  return draws;
}

export function registerParserExportsCases(define: DefineBenchmarkCase): void {
  define('chart-parser.canonicalizeBMSCharset', {
    run: () => {
      parserAPI.canonicalizeBMSCharset('Shift-JIS');
      parserAPI.canonicalizeBMSCharset('utf8');
    },
  });
  define('chart-parser.decodeBMSText', {
    run: (fixtures) => {
      parserAPI.decodeBMSText(fixtures.bmsBuffer);
    },
  });
  define('chart-parser.decodeUTF8Text', {
    run: (fixtures) => {
      parserAPI.decodeUTF8Text(fixtures.bmsBuffer);
    },
  });
  define('chart-parser.extractDeclaredBMSCharset', {
    run: () => {
      parserAPI.extractDeclaredBMSCharset('#CHARSET Shift_JIS\n#TITLE Bench\n');
    },
  });
  define('chart-parser.parseBMS', {
    run: (fixtures) => {
      parserAPI.parseBMS(fixtures.bmsText);
    },
  });
  define('chart-parser.parseBmson', {
    run: (fixtures) => {
      parserAPI.parseBmson(fixtures.bmsonText);
    },
  });
  define('chart-parser.parseChart', {
    run: (fixtures) => {
      parserAPI.parseChart(fixtures.bmsText);
    },
  });
  define('chart-parser.parseChartFile', {
    ioBound: true,
    run: async (fixtures) => {
      await parserAPI.parseChartFile(fixtures.paths.bmsPath);
    },
  });
  define('chart-parser.resolveBMSControlFlow', {
    run: (fixtures) => {
      parserAPI.resolveBMSControlFlow(fixtures.controlFlowJSON, { random: () => 0.25 });
    },
  });
  define('chart-parser.resolveBMSControlFlowWithDraws', {
    run: (fixtures) => {
      parserAPI.resolveBMSControlFlowWithDraws(fixtures.controlFlowJSON, benchRandomDraws(fixtures.controlFlowJSON));
    },
  });
}
