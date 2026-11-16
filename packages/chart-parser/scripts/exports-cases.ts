import { drawRandomOutcomes, type RandomDraws } from '@be-music/chart-model';
import * as parserAPI from '@be-music/chart-parser';
import { zlibSync } from 'fflate';
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

const BENCH_N2S_CACHE = new WeakMap<object, Uint8Array>();

/** An unencrypted ZEXA container (the `.n2s` layout) holding `chart` as `bench.pms`. */
function benchN2S(chart: Uint8Array): Uint8Array {
  let archive = BENCH_N2S_CACHE.get(chart);
  if (archive !== undefined) return archive;
  const u32 = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return [...bytes];
  };
  const tag = (name: string) => Array.from({ length: 8 }, (_, i) => (i < name.length ? name.charCodeAt(i) : 0xff));
  const payload = zlibSync(chart);
  const name = [...new TextEncoder().encode('bench.pms'), 0];
  archive = Uint8Array.from([
    ...tag('ZEXA'),
    ...u32(1),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...tag('DATA'),
    ...payload,
    ...tag('INDEX'),
    ...u32(1),
    ...u32(0),
    ...u32(0),
    ...u32(payload.length),
    ...u32(name.length),
    ...name,
  ]);
  BENCH_N2S_CACHE.set(chart, archive);
  return archive;
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
  define('chart-parser.parseBMSBytes', {
    run: (fixtures) => {
      parserAPI.parseBMSBytes(fixtures.bmsBuffer);
    },
  });
  define('chart-parser.parseBmson', {
    run: (fixtures) => {
      parserAPI.parseBmson(fixtures.bmsonText);
      parserAPI.parseBmson(JSON.stringify({ ...JSON.parse(fixtures.bmsonText), vendor: { tags: [null, 1] } }));
    },
  });
  define('chart-parser.isN2SArchive', {
    run: (fixtures) => {
      parserAPI.isN2SArchive(benchN2S(fixtures.bmsBuffer));
      parserAPI.isN2SArchive(fixtures.bmsBuffer);
    },
  });
  define('chart-parser.readN2SArchive', {
    run: (fixtures) => {
      parserAPI.readN2SArchive(benchN2S(fixtures.bmsBuffer));
    },
  });
  define('chart-parser.parseN2SBytes', {
    run: (fixtures) => {
      parserAPI.parseN2SBytes(benchN2S(fixtures.bmsBuffer));
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
