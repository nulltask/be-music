import * as parserApi from '@be-music/parser';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerParserExportsCases(define: DefineBenchmarkCase): void {
  define('parser.canonicalizeBmsCharset', {
    run: () => {
      parserApi.canonicalizeBmsCharset('Shift-JIS');
      parserApi.canonicalizeBmsCharset('utf8');
    },
  });
  define('parser.decodeBmsText', {
    run: (fixtures) => {
      parserApi.decodeBmsText(fixtures.bmsBuffer);
    },
  });
  define('parser.extractDeclaredBmsCharset', {
    run: () => {
      parserApi.extractDeclaredBmsCharset('#CHARSET Shift_JIS\n#TITLE Bench\n');
    },
  });
  define('parser.parseBms', {
    run: (fixtures) => {
      parserApi.parseBms(fixtures.bmsText);
    },
  });
  define('parser.parseBmson', {
    run: (fixtures) => {
      parserApi.parseBmson(fixtures.bmsonText);
    },
  });
  define('parser.parseChart', {
    run: (fixtures) => {
      parserApi.parseChart(fixtures.bmsText);
    },
  });
  define('parser.parseChartFile', {
    run: async (fixtures) => {
      await parserApi.parseChartFile(fixtures.paths.bmsPath);
    },
  });
  define('parser.resolveBmsControlFlow', {
    run: (fixtures) => {
      parserApi.resolveBmsControlFlow(fixtures.controlFlowJson, { random: () => 0.25 });
    },
  });
}
