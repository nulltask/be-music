import { readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  eventToBeat,
  isBmsBgmVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  isPlayLaneSoundChannel,
  isPlayableChannel,
  isSampleTriggerChannel,
  parseBmsArgb,
  parseBmsBga,
  parseBmsDynamicVolumeGain,
  parseBmsExBmp,
  parseBmsExWav,
  parseBmsSwBga,
  parseBmsWavCmd,
  resolveBmsLongNotes,
  resolveChartPlayVariant,
  resolveLnobjLongNotes,
  type ChartPlayVariant,
} from '../../chart/src/index.ts';
import { parseChartFile, resolveBmsControlFlow } from './index.ts';

/**
 * Tests for the shared chart corpus in `examples/test`.
 *
 * Every fixture in that directory is meant to exercise one coherent feature cluster end to end. The per-function unit
 * tests next to each source file stay inline — they need many tiny variations of one input, and a file per case would
 * hide the assertion. What they cannot show is whether a real chart file, parsed off disk, still carries payloads the
 * feature's own parser accepts. That is what lives here, so a fixture that drifts away from the code fails a test
 * instead of quietly rotting.
 */

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDir = resolve(rootDir, 'examples/test');
const fixture = (name: string) => resolve(fixtureDir, name);

const CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);

describe('examples/test corpus', () => {
  test('every chart fixture parses off disk', async () => {
    const entries = await readdir(fixtureDir);
    const charts = entries.filter((entry) => CHART_EXTENSIONS.has(extname(entry).toLowerCase())).sort();

    // Guards against the directory being silently emptied / renamed out from under this suite.
    expect(charts.length).toBeGreaterThanOrEqual(18);

    for (const name of charts) {
      const json = await parseChartFile(fixture(name));
      expect(json.sourceFormat, name).toBe(extname(name).toLowerCase() === '.bmson' ? 'bmson' : 'bms');
      expect(json.metadata.title, name).not.toBe('');
      expect(json.metadata.bpm, name).toBeGreaterThan(0);

      // A chart whose objects all live inside control-flow blocks (control-flow-random-demo.bms) has no top-level
      // events, so the playable-content check has to run against the resolved chart. Resolving also catches the
      // failure mode that motivated this test: an unbalanced `#RANDOM` / `#SWITCH` scope swallows every line below
      // it, which leaves a chart that parses cleanly and plays nothing.
      const resolved =
        json.sourceFormat === 'bms' && json.bms.controlFlow.length > 0
          ? resolveBmsControlFlow(json, { random: () => 0 })
          : json;
      expect(resolved.events.length, name).toBeGreaterThan(0);
    }
  });

  test('lane-mode fixtures cover every ChartPlayVariant the resolver can return', async () => {
    // One fixture per branch of `resolveChartPlayVariant`. The resolver's own unit tests drive synthetic channel lists;
    // this table proves a real chart authored the channels that branch actually needs.
    const cases: ReadonlyArray<{ file: string; expected: ChartPlayVariant }> = [
      { file: '5key-sp.bms', expected: '5' },
      { file: 'ln-mode-1-long-note.bms', expected: '7' },
      { file: '9key-all-keys-quarter.pms', expected: '9' },
      { file: 'ln-9key-popn.bms', expected: '9' },
      { file: '10key-dp.bms', expected: '10' },
      { file: 'lane-order-test.bms', expected: '14' },
      { file: '24key-keyboard-sp.bme', expected: '24' },
      { file: '48key-keyboard-dp.bme', expected: '48' },
    ];

    const resolved = new Set<ChartPlayVariant>();
    for (const { file, expected } of cases) {
      const json = await parseChartFile(fixture(file));
      expect(resolveChartPlayVariant({ chartPath: fixture(file), events: json.events, bms: json.bms }), file).toBe(
        expected,
      );
      resolved.add(expected);
    }

    expect([...resolved].sort()).toEqual(['10', '14', '24', '48', '5', '7', '9']);
  });

  test('extended-directives.bms carries payloads every #directive value parser accepts', async () => {
    const json = await parseChartFile(fixture('extended-directives.bms'));

    // `#EXWAVxx <flags> <params> <filename>` — flags are matched positionally, in any order.
    expect(parseBmsExWav(json.bms.exWav['01'] ?? '')).toEqual({
      pan: 1024,
      volumeCentibels: -200,
      frequencyHz: 48_000,
      filename: 'sample.wav',
    });
    expect(parseBmsExWav(json.bms.exWav['02'] ?? '')).toMatchObject({
      volumeCentibels: -600,
      pan: -500,
      filename: 'branch.wav',
    });
    // An explicitly authored 0 cB is unity, and must stay distinguishable from an unauthored flag.
    const unity = parseBmsExWav(json.bms.exWav['03'] ?? '');
    expect(unity?.volumeCentibels).toBe(0);
    expect(unity?.pan).toBeUndefined();

    // `#EXBMPxx a,r,g,b,filename`
    expect(parseBmsExBmp(json.bms.exBmp['01'] ?? '')).toMatchObject({
      filename: 'bga-base.bmp',
      argb: { a: 255, r: 0, g: 0, b: 0 },
    });
    expect(parseBmsExBmp(json.bms.exBmp['02'] ?? '')?.argb).toEqual({ a: 128, r: 255, g: 255, b: 255 });

    // `#ARGBxx` in both accepted spellings — AARRGGBB hex and comma-separated decimal.
    expect(parseBmsArgb(json.bms.argb['01'] ?? '')).toEqual({ a: 255, r: 0, g: 0, b: 0 });
    expect(parseBmsArgb(json.bms.argb['02'] ?? '')).toEqual({ a: 128, r: 255, g: 0, b: 0 });

    // `#BGAxx YY x1 y1 x2 y2 dx dy` sub-region crops.
    expect(parseBmsBga(json.bms.bga['05'] ?? '')).toEqual({
      sourceBmp: '01',
      sx: 0,
      sy: 0,
      ex: 256,
      ey: 256,
      dx: 0,
      dy: 0,
    });
    expect(parseBmsBga(json.bms.bga['06'] ?? '')).toMatchObject({ sourceBmp: '02', sx: 64, sy: 32, dx: 16, dy: 8 });

    // `#SWBGAxx fr:tot:lp[:ARGB] N1 N2 …` — `fr` is in 1/100 s, so 10 is a 100 ms frame interval.
    expect(parseBmsSwBga(json.bms.swBga['01'] ?? '')).toEqual({
      frameIntervalMs: 100,
      totalFrames: 5,
      loop: true,
      argbRaw: 'FF000000',
      frames: ['01', '02', '03', '04', '05'],
    });
    const holdLast = parseBmsSwBga(json.bms.swBga['02'] ?? '');
    expect(holdLast?.loop).toBe(false);
    expect(holdLast?.argbRaw).toBeUndefined();

    // One `#WAVCMD pp xx vv` line per parameter byte.
    const wavCmds = json.bms.wavCmds.map((line) => parseBmsWavCmd(line));
    expect(wavCmds).toEqual([
      { param: 'volume', slot: '01', value: 64 },
      { param: 'pitch', slot: '02', value: 12 },
      { param: 'loop', slot: '03', value: 1024 },
    ]);

    // `#EXRANKxx` percentages cued from channel A0, `#CHANGEOPTIONxx` from channel A6.
    expect(json.bms.exRank['01']).toBe('48');
    expect(json.bms.exRank['02']).toBe('150');
    expect(json.bms.changeOption['01']).toBe('MIRROR');
    const cueChannels = json.events.filter((event) => event.channel === 'A0' || event.channel === 'A6');
    expect(cueChannels.map((event) => event.value).sort()).toEqual(['01', '01', '02', '02']);
    // A0 is excluded from the audio path; A6 is not, because its runtime reflection is still unimplemented and it
    // therefore falls through to the default "an object with a value is a keysound" rule.
    expect(isSampleTriggerChannel('A0')).toBe(false);

    expect(json.bms.stp).toEqual(['001.500', '002.250']);
  });

  test('scroll-speed-gimmick.bms authors every timing and drawing gimmick channel', async () => {
    const json = await parseChartFile(fixture('scroll-speed-gimmick.bms'));

    expect(json.bms.scroll).toEqual({ '01': 1, '02': 0.5, '03': 0, '04': -1, '05': 2 });
    expect(json.bms.speed).toEqual({ '01': 1, '02': 0.5, '03': 2 });
    expect(json.resources.bpm).toEqual({ '01': 60, '02': 240, '03': 90.5 });
    expect(json.resources.stop).toEqual({ '01': 48, '02': 192 });
    expect(json.measures).toContainEqual({ index: 3, length: 0.75 });
    expect(json.measures).toContainEqual({ index: 4, length: 1.5 });

    const channels = new Set(json.events.map((event) => event.channel));
    for (const channel of ['03', '08', '09', 'SC', 'SP']) {
      expect(channels.has(channel), channel).toBe(true);
    }

    // The scroll / speed reference channels must never reach the audio path.
    for (const channel of ['SC', 'SP']) {
      expect(isSampleTriggerChannel(channel)).toBe(false);
    }

    // Measure 6 is the compatibility corner: `#SCROLL 0` followed by a negative value.
    const measure6Scroll = json.events
      .filter((event) => event.measure === 6 && event.channel === 'SC')
      .map((event) => json.bms.scroll[event.value]);
    expect(measure6Scroll).toEqual([0, -1]);
  });

  test('bus-volume-channels.bms drives the 97 / 98 volume buses without triggering samples', async () => {
    const json = await parseChartFile(fixture('bus-volume-channels.bms'));

    const bgm = json.events.filter((event) => isBmsBgmVolumeChangeChannel(event.channel));
    const key = json.events.filter((event) => isBmsKeyVolumeChangeChannel(event.channel));
    expect(bgm.length).toBeGreaterThan(0);
    expect(key.length).toBeGreaterThan(0);

    for (const event of [...bgm, ...key]) {
      // A volume change must not sound, and every authored token must decode to a usable gain.
      expect(isSampleTriggerChannel(event.channel), event.channel).toBe(false);
      expect(parseBmsDynamicVolumeGain(event.value), `${event.channel}:${event.value}`).toBeGreaterThan(0);
    }

    // `FF` is unity and `01` is the quietest audible step, so the authored range spans the whole bus.
    const gains = bgm.map((event) => parseBmsDynamicVolumeGain(event.value) ?? Number.NaN);
    expect(Math.max(...gains)).toBeCloseTo(1, 9);
    expect(Math.min(...gains)).toBeCloseTo(0x01 / 0xff, 9);

    // Measure 3 moves both buses on the same beat.
    const measure3 = json.events.filter((event) => event.measure === 3 && event.channel.startsWith('9'));
    expect(new Set(measure3.map((event) => event.channel))).toEqual(new Set(['97', '98']));
  });

  test('base62-ids.bms keeps upper and lower case object IDs apart', async () => {
    const json = await parseChartFile(fixture('base62-ids.bms'));

    expect(json.bms.base).toBe(62);
    expect(json.resources.wav['0a']).toBe('sample.wav');
    expect(json.resources.wav['0A']).toBe('branch.wav');
    expect(json.resources.wav['0z']).toBe('right.wav');
    expect(json.resources.wav['0Z']).toBe('wrong.wav');
    expect(json.bms.lnObjs).toEqual(['zz']);

    // Channel-stream tokens keep their case too, so the four slots stay four distinct samples.
    const lane = json.events.filter((event) => event.measure === 0 && event.channel === '11');
    expect(lane.map((event) => event.value)).toEqual(['0a', '0A', '0z', '0Z']);

    // The LN end marker is the lower case `zz`; folding it to `ZZ` would stop it matching `#LNOBJ`.
    const lnMeasure = json.events.filter((event) => event.measure === 2 && event.channel === '11');
    expect(lnMeasure.map((event) => event.value)).toEqual(['0a', 'zz']);

    // An indexed header declared inside a `#RANDOM` / `#IF` block is captured rather than applied, so the case-
    // preserving path has to survive the control-flow replay too.
    const captured = json.bms.controlFlow.find((entry) => entry.kind === 'header' && entry.commandRaw === 'WAV0b');
    expect(captured).toBeDefined();
    const resolved = resolveBmsControlFlow(json, { random: () => 0 });
    expect(resolved.resources.wav['0b']).toBe('wrong.wav');
    expect(resolved.events.some((event) => event.measure === 3 && event.value === '0b')).toBe(true);
  });

  test('invisible-notes.bms sounds 3x / 4x lanes without making them playable', async () => {
    const json = await parseChartFile(fixture('invisible-notes.bms'));

    const invisible = json.events.filter((event) => /^[34]/.test(event.channel));
    expect(invisible.length).toBeGreaterThan(0);
    for (const event of invisible) {
      expect(isPlayLaneSoundChannel(event.channel), event.channel).toBe(true);
      expect(isPlayableChannel(event.channel), event.channel).toBe(false);
      expect(isSampleTriggerChannel(event.channel), event.channel).toBe(true);
    }

    // The 2P-side invisible channels must not turn a single-player chart into a DP chart.
    expect(invisible.some((event) => event.channel.startsWith('4'))).toBe(true);
    expect(
      resolveChartPlayVariant({
        chartPath: fixture('invisible-notes.bms'),
        events: json.events,
        bms: json.bms,
      }),
    ).toBe('7');

    // Measure 3 is invisible-only: the lane keeps its sample assignment while nothing is judged.
    const measure3 = json.events.filter((event) => event.measure === 3);
    expect(measure3.length).toBeGreaterThan(0);
    expect(measure3.every((event) => !isPlayableChannel(event.channel))).toBe(true);
  });

  test('lntype2-long-note.bms expands continuous runs into long notes', async () => {
    const json = await parseChartFile(fixture('lntype2-long-note.bms'));
    expect(json.bms.lnType).toBe(2);

    const resolved = resolveBmsLongNotes(json);
    const byLane = new Map<string, typeof resolved.notes>();
    for (const note of resolved.notes) {
      byLane.set(note.channel, [...(byLane.get(note.channel) ?? []), note]);
    }

    // Measure 1 — one run of four eighth-note slots on lane 1: beat 0 to beat 2.
    const lane1 = byLane.get('11') ?? [];
    expect(lane1).toHaveLength(1);
    expect(lane1[0]?.beat).toBeCloseTo(4, 6);
    expect(lane1[0]?.endBeat).toBeCloseTo(6, 6);

    // Measure 2 — two runs separated by an empty slot must stay two long notes.
    expect(byLane.get('13')).toHaveLength(2);

    // Measures 3-4 — a run across the measure boundary is one long note.
    const lane5 = byLane.get('15') ?? [];
    expect(lane5).toHaveLength(1);
    expect(lane5[0]?.beat).toBeCloseTo(15, 6);
    expect(lane5[0]?.endBeat).toBeCloseTo(17, 6);

    // Every token after a run's first is a continuation and must not trigger a keysound.
    expect(resolved.suppressedTriggerEvents.size).toBeGreaterThan(0);
    for (const note of resolved.notes) {
      expect(resolved.suppressedTriggerEvents.has(note.event)).toBe(false);
    }
  });

  test('bmson-key-channels-mines.bmson routes key_channels mines and keeps the LN extensions', async () => {
    const json = await parseChartFile(fixture('bmson-key-channels-mines.bmson'));

    expect(json.bmson.info.lnType).toBe(2);
    expect(json.bmson.info.modeHint).toBe('beat-7k');

    // `key_channels` notes become landmines on the `Dx` / `Ex` channels via the same `mode_hint` lane map the playable
    // notes use: x=1 → 11 → D1, x=6 → 18 → D8, x=8 → scratch 16 → D6.
    const mines = json.events.filter((event) => /^[DE]/.test(event.channel));
    expect(mines.map((event) => event.channel)).toEqual(['D1', 'D8', 'D6']);
    expect(mines.map((event) => event.bmson?.damage)).toEqual([0, 50, 100]);

    // The mine WAV is registered after the `sound_channels` block, keeping the WAV ID space contiguous.
    expect(json.resources.wav['03']).toBe('wrong.wav');

    // `notes[].t` survives only on long notes (`l > 0`).
    const withNoteType = json.events.filter((event) => event.bmson?.t !== undefined);
    expect(withNoteType.length).toBeGreaterThan(0);
    for (const event of withNoteType) {
      expect(event.bmson?.l ?? 0).toBeGreaterThan(0);
    }
  });

  test('nonpositive-bpm.bms keeps its usable tempo points and drops the rest', async () => {
    const json = await parseChartFile(fixture('nonpositive-bpm.bms'));

    // Zero and negative slots are stored verbatim — the parser's job is to report what the chart says.
    expect(json.resources.bpm).toEqual({ '01': 130, '02': 0, '03': -65 });

    // All four channel-08 references survive parsing, including the one pointing at an undefined slot.
    const tempoRefs = json.events.filter((event) => event.channel === '08');
    expect(tempoRefs.map((event) => event.value)).toEqual(['01', '02', '03', 'ZZ']);
    expect(json.resources.bpm.ZZ).toBeUndefined();

    // Notes keep playing on every lane through the bad changes, so a consumer that skips the unusable tempo points
    // still has a chart to render rather than an empty one.
    for (const measure of [0, 1, 2, 3, 4, 5]) {
      expect(
        json.events.some((event) => event.measure === measure && event.channel === '11'),
        `measure ${measure}`,
      ).toBe(true);
    }
  });

  test('7key-longnote.bml parses and classifies like any other BMS chart', async () => {
    // The `.bml` extension carries no parsing rule of its own, so the point is that a real file with that extension
    // reaches the same place a `.bme` chart would.
    const json = await parseChartFile(fixture('7key-longnote.bml'));

    expect(json.sourceFormat).toBe('bms');
    expect(json.metadata.title).toBe('7 KEY Long Note (BML)');
    expect(json.bms.lnObjs).toContain('ZZ');
    expect(
      resolveChartPlayVariant({ chartPath: fixture('7key-longnote.bml'), events: json.events, bms: json.bms }),
    ).toBe('7');

    // The long notes are real head/tail pairs, not stray markers: every head maps to an end beat, and every `ZZ`
    // object is claimed as the end of one of them.
    const resolved = resolveLnobjLongNotes(json);
    expect(resolved.startToEndBeat.size).toBeGreaterThan(0);
    expect(resolved.endEvents.size).toBe(resolved.startToEndBeat.size);
    for (const [head, endBeat] of resolved.startToEndBeat) {
      expect(endBeat, `${head.measure}:${head.channel}`).toBeGreaterThan(eventToBeat(json, head));
    }
  });

  test('measure-length.bms shortens a single measure', async () => {
    const json = await parseChartFile(fixture('measure-length.bms'));

    expect(json.measures).toEqual([{ index: 1, length: 0.5 }]);
    // One note per measure across three measures, so the shortened middle measure is visible as timing, not as data.
    expect(json.events.filter((event) => event.channel === '11')).toHaveLength(3);
  });

  test('control-flow-random-demo.bms resolves every branch shape it authors', async () => {
    const parsed = await parseChartFile(fixture('control-flow-random-demo.bms'));

    // Unresolved, the chart carries the control-flow commands rather than the branch bodies' objects.
    expect(parsed.bms.controlFlow.length).toBeGreaterThan(0);

    // `#RANDOM 1` / `#SWITCH 1` — the lowest branch of every block.
    const first = resolveBmsControlFlow(parsed, { random: () => 0 });
    expect(first.metadata.title).toBe('Control Flow Random Demo [A]');
    expect(first.events.some((event) => event.measure === 4 && event.channel === '11')).toBe(true);

    // The top branch of every block. `#RANDOM 2` selects the `#ELSE` body, which retitles the chart.
    const last = resolveBmsControlFlow(parsed, { random: () => 0.999_999_9 });
    expect(last.metadata.title).toBe('Control Flow Random Demo [B]');
    expect(last.events.some((event) => event.measure === 0 && event.channel === '29')).toBe(true);
    expect(last.events.some((event) => event.measure === 12 && event.channel === '16')).toBe(true);

    // Resolution is exclusive: an object from the branch that was not taken never survives.
    expect(first.events.some((event) => event.measure === 0 && event.channel === '29')).toBe(false);
    expect(last.events.some((event) => event.measure === 4 && event.channel === '11')).toBe(false);
  });
});
