import { describe, expect, test } from 'vite-plus/test';
import { formatJigReport, jigLogWarnings, jigRunReport, parseJigLog, summarizeJigLatencies } from './analyze.ts';

const LOG = [
  '# status usb=mounted',
  '# run presses=4 gapMs=300-800 threshold=300 timeoutMs=500 holdMs=30 quiet=150 key=0x1d chip=rp2040',
  '# kind,index,queuedUs,sentUs,onsetUs,latencyUs,usbUs,peak,quietSpan',
  'P,1,1000000,1000400,1029400,29000,400,1500,12',
  'P,2,2000000,2000700,2031700,31000,700,1500,10',
  'T,3,3000000,3000500,,,500,40,9',
  'N,4,,,,,,,400',
  '# done timed=2 timeouts=1 noisy=1',
  '',
].join('\r\n');

describe('parseJigLog', () => {
  test('reads the settings, the timed presses and the counts', () => {
    const log = parseJigLog(LOG);
    expect(log.settings).toMatchObject({ presses: '4', threshold: '300', chip: 'rp2040' });
    expect(log.presses).toEqual([
      {
        index: 1,
        queuedUs: 1000000,
        sentUs: 1000400,
        onsetUs: 1029400,
        latencyUs: 29000,
        usbUs: 400,
        peak: 1500,
        quietSpan: 12,
      },
      {
        index: 2,
        queuedUs: 2000000,
        sentUs: 2000700,
        onsetUs: 2031700,
        latencyUs: 31000,
        usbUs: 700,
        peak: 1500,
        quietSpan: 10,
      },
    ]);
    expect(log).toMatchObject({ timeouts: 1, noisy: 1, done: true, stopped: false, errors: [] });
  });

  test('keeps only the last run of a file', () => {
    const log = parseJigLog(
      `${LOG}# run presses=1 threshold=200\nP,1,0,100,10100,10000,100,900,5\n# done timed=1 stopped\n`,
    );
    expect(log.settings).toEqual({ presses: '1', threshold: '200' });
    expect(log.presses.map((press) => press.latencyUs)).toEqual([10000]);
    expect(log).toMatchObject({ timeouts: 0, noisy: 0, done: true, stopped: true });
  });

  test('skips malformed lines and keeps errors', () => {
    const log = parseJigLog('# run presses=2\nP,1,x,1,1,1,1,1,1\nP,2\n# error: the host did not take the key report\n');
    expect(log.presses).toEqual([]);
    expect(log.errors).toEqual(['the host did not take the key report']);
    expect(log.done).toBe(false);
  });
});

describe('summarizeJigLatencies', () => {
  test('gives the distribution', () => {
    const stats = summarizeJigLatencies([30, 10, 20, 40]);
    expect(stats).toMatchObject({ count: 4, minMs: 10, medianMs: 25, maxMs: 40, meanMs: 25 });
    expect(stats?.p95Ms).toBeCloseTo(38.5);
    expect(stats?.stdevMs).toBeCloseTo(Math.sqrt(125));
  });

  test('is undefined for no values', () => {
    expect(summarizeJigLatencies([])).toBeUndefined();
  });
});

describe('jigLogWarnings', () => {
  test('flags timeouts, noisy presses, weak and clipped signals and an unfinished run', () => {
    const log = parseJigLog(
      '# run threshold=300\nP,1,0,0,10000,10000,0,2000,1\nP,2,0,0,10000,10000,0,500,1\nT,3,0,0,,,0,0,1\nN,4,,,,,,,400\n',
    );
    expect(jigLogWarnings(log)).toEqual([
      "1 press(es) near the ADC's rail: turn the volume down",
      'a peak under twice the threshold: turn the volume up or lower thr',
      '1 timeout(s): no sound within the timeout',
      '1 press(es) skipped for a noisy input',
      'the log ends before "# done"',
    ]);
  });

  test('has nothing to say about a clean run', () => {
    expect(jigLogWarnings(parseJigLog(LOG.replace(/^[TN],.*$/gm, '')))).toEqual([]);
  });
});

describe('formatJigReport', () => {
  test('tabulates each run against the first', () => {
    const web = jigRunReport('web.csv', parseJigLog(LOG.replace(/^[TN],.*$/gm, '')));
    const native = jigRunReport(
      'native.csv',
      parseJigLog('# run threshold=300\nP,1,0,0,8000,8000,500,1500,1\nP,2,0,0,9000,9000,500,1500,1\n# done\n'),
    );
    expect(formatJigReport([web, native])).toBe(
      [
        'Press to sound, milliseconds (usb: queued to taken by the host)',
        'run         n  median    p95    p99    max  stdev   usb  vs first',
        'web.csv     2   30.00  30.90  30.98  31.00   1.00  0.55         -',
        'native.csv  2    8.50   8.95   8.99   9.00   0.50  0.50    -21.50',
        '',
      ].join('\n'),
    );
  });
});
