import { createEmptyJSON } from '@be-music/chart-source';
import { parseBMS } from '@be-music/chart-parser';
import { parseBMSExBMP, parseBmsBGA, resolveChart } from '@be-music/chart-model';
import { expect, test, vi } from 'vite-plus/test';
import { createNonstopBMPAllocator } from './bga-resources.ts';
import { NonstopKeyAllocator } from './ids.ts';
import { stitchNonstopCourse } from './compose.ts';

test('remaps EXBMP paths, authored color fields and sub-region dependencies per stage', () => {
  const source = parseBMS(
    '#BPM 120\n#BASE 62\n#EXBMPaa 128, 1, 2, 3 folder/my image,01.png\n#BGAaA aa 10 20 50 60 70 80\n#ARGBaA FF112233',
  );
  const original = structuredClone(source);
  const target = createEmptyJSON('bms');
  target.bms.base = 62;
  const keys = new NonstopKeyAllocator();
  const stageKeys: string[] = [];
  const assetPath = vi.fn((path: string) => `s0/${path}`);
  const bmp = createNonstopBMPAllocator({ source, target, stage: 0, keys, stageKeys, assetPath });
  const root = bmp('aA')!;
  const region = parseBmsBGA(target.bms.bga[root]!, 62)!;
  expect(region).toMatchObject({ sx: 10, sy: 20, ex: 50, ey: 60, dx: 70, dy: 80 });
  expect(target.resources.bmp[region.sourceBMP]).toBe('s0/folder/my image,01.png');
  expect(parseBMSExBMP(target.bms.exBMP[region.sourceBMP]!)).toMatchObject({
    filename: 's0/folder/my image,01.png',
    argb: { a: 128, r: 1, g: 2, b: 3 },
  });
  expect(target.bms.argb[root]).toBe('FF112233');
  expect(stageKeys).toEqual([root, region.sourceBMP]);
  expect(bmp('aA')).toBe(root);
  expect(assetPath).toHaveBeenCalledExactlyOnceWith('folder/my image,01.png');
  expect(source).toEqual(original);
});

test('keeps explicit BMP precedence and does not allocate an ignored same-slot BGA dependency', () => {
  const source = parseBMS('#BMP01 explicit.png\n#EXBMP01 ,,,,alternate.png\n#BGA01 02 0 0 64 64 0 0');
  const target = createEmptyJSON();
  const stageKeys: string[] = [];
  const bmp = createNonstopBMPAllocator({
    source,
    target,
    stage: 1,
    keys: new NonstopKeyAllocator(),
    stageKeys,
    assetPath: (path) => `s1/${path}`,
  });
  const key = bmp('01')!;
  expect(target.resources.bmp[key]).toBe('s1/explicit.png');
  expect(parseBMSExBMP(target.bms.exBMP[key]!)?.filename).toBe('s1/alternate.png');
  expect(target.bms.bga[key]).toBeUndefined();
  expect(stageKeys).toEqual([key]);
});

test('terminates cyclic, malformed and missing definitions without borrowing another stage resource', () => {
  const source = parseBMS('#BGA01 02 0 0 64 64 0 0\n#BGA02 01 0 0 64 64 0 0\n#BGA03 malformed');
  const target = createEmptyJSON();
  const stageKeys: string[] = [];
  const bmp = createNonstopBMPAllocator({
    source,
    target,
    stage: 0,
    keys: new NonstopKeyAllocator(),
    stageKeys,
    assetPath: (path) => path,
  });
  const root = bmp('01')!;
  const parent = parseBmsBGA(target.bms.bga[root]!)!.sourceBMP;
  expect(parseBmsBGA(target.bms.bga[parent]!)!.sourceBMP).toBe(root);
  expect(bmp('03')).toBeDefined();
  expect(bmp('04')).toBeDefined();
  expect(stageKeys).toHaveLength(4);
  expect(target.resources.bmp).toEqual({});
});

test('reports key exhaustion even when the cue slot fits but its dependency does not', () => {
  const keys = new NonstopKeyAllocator();
  for (let index = 0; index < 3842; index++) keys.keyFor(9, String(index));
  const source = parseBMS('#BMP02 source.png\n#BGA01 02 0 0 64 64 0 0');
  const bmp = createNonstopBMPAllocator({
    source,
    target: createEmptyJSON(),
    stage: 0,
    keys,
    stageKeys: [],
    assetPath: (path) => path,
  });
  expect(bmp('01')).toBeUndefined();
  expect(bmp('01')).toBeUndefined();
});

test('walks long dependency chains iteratively and preserves internal long ids in mixed bmson output', () => {
  const source = createEmptyJSON('bmson');
  source.bms.base = 62;
  for (let index = 0; index < 5000; index++) source.bms.bga[`node${index}`] = `node${index + 1} 0 0 64 64 0 0`;
  source.resources.bmp.node5000 = 'source.png';
  const target = createEmptyJSON('bmson');
  const stageKeys: string[] = [];
  const bmp = createNonstopBMPAllocator({
    source,
    target,
    stage: 0,
    keys: new NonstopKeyAllocator(true),
    stageKeys,
    assetPath: (path) => path,
  });
  const root = bmp('node0')!;
  expect(root).toBeDefined();
  expect(stageKeys).toHaveLength(5001);
  expect(stageKeys.at(-1)!.length).toBeGreaterThan(2);
  const lastAlias = stageKeys.at(-2)!;
  expect(parseBmsBGA(target.bms.bga[lastAlias]!, 62, true)!.sourceBMP).toBe(stageKeys.at(-1));
});

test('stitches reused source slots into independent stage namespaces and retains EXBMP-only cues in mixed output', () => {
  const a = parseBMS('#BPM 120\n#EXBMP01 ,,,,a.png\n#BGA02 01 0 0 64 64 32 48\n#00004:02\n#00111:01\n#00411:01');
  const b = parseBMS('#BPM 120\n#EXBMP01 ,,,,b.png\n#BGA02 01 64 0 128 64 96 112\n#00204:02\n#00211:01\n#00411:01');
  for (const mixed of [false, true]) {
    const stages = [{ chart: a }, { chart: b }];
    if (mixed) stages.push({ chart: createEmptyJSON('bmson') });
    const result = stitchNonstopCourse(stages, {
      connections: ['cut', 'blank2'],
      assetPath: (stage, _kind, path) => `s${stage}/${path}`,
    });
    if (!result.ok) throw new Error(result.reason);
    const cues = resolveChart(result.chart).bga.base;
    expect(cues).toHaveLength(2);
    const roots = cues.map((cue) => cue.key!);
    const dependencies = roots.map((key) => parseBmsBGA(result.chart.bms.bga[key]!, 62, mixed)!.sourceBMP);
    expect(new Set([...roots, ...dependencies]).size).toBe(4);
    expect(dependencies.map((key) => result.chart.resources.bmp[key])).toEqual(['s0/a.png', 's1/b.png']);
    expect(result.map.stages[0]!.bmpKeys).toEqual([roots[0], dependencies[0]]);
    expect(result.map.stages[1]!.bmpKeys).toEqual([roots[1], dependencies[1]]);
  }
});
