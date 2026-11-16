import { describe, expect, test } from 'vite-plus/test';
import { parseLRX, parseLRXBytes, resolveLRXHeaderPath, resolveLRXMoviePath } from './lrx.ts';
import { normalizeLRXEventExtensions } from './lrx-extensions.ts';
import { parseChart } from './parser.ts';

const lrs = (...lines: string[]) => `<?xml version="1.0"?>\r\n<LRS>\r\n${lines.join('\r\n')}\r\n</LRS>\r\n`;
const lrh = (attributes: string) => `<?xml version="1.0"?>\r\n<LRH>\r\n\t<information ${attributes} />\r\n</LRH>\r\n`;

function utf16(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, true);
  for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), true);
  return bytes;
}

const BASIC = lrs(
  '\t<information rank="1" total="150" />',
  '\t<sound id="0" filename="kick.wav" />',
  '\t<sound id="1" filename="snare.wav" />',
  '\t<n c="300" s="0" />',
  '\t<n c="301" s="0" p="150.000000" />',
  '\t<n c="1" s="0" p="0" />',
  '\t<n c="0" s="480" p="1" />',
  '\t<n c="100" s="960" p="1" />',
  '\t<n c="300" s="1920" />',
  '\t<n c="5" s="1920" e="2880" p="0" />',
  '\t<n c="309" s="3840" p="1" />',
);

describe('parseLRX', () => {
  test('maps notes, sounds and header values onto the BMS-shaped chart', () => {
    const chart = parseLRX({
      lrs: BASIC,
      lrh: lrh(
        'title="Song" subtitle="sub" genre="PIANO" artist_song="comp" artist_sequence="seq" lanetype="1" lrslevel="7" bmslevel="9" category="1" basebpm="150" startbpm="150" phase="3" songid="12" titleimage="t.png" backimage="b.png" bannerimage="n.png" rank="3" total="999"',
      ),
    });
    expect(chart.sourceFormat).toBe('lrx');
    expect(chart.metadata).toMatchObject({
      title: 'Song',
      subtitle: 'sub',
      genre: 'PIANO',
      artist: 'comp',
      playLevel: 7,
      difficulty: 2,
      bpm: 150,
      titleImage: 't.png',
      backBMP: 'b.png',
      banner: 'n.png',
      // rank and TOTAL come from the .lrs only.
      rank: 1,
      total: 150,
    });
    expect(chart.metadata.extras.SUBARTIST).toBe('seq');
    expect(chart.lrx).toMatchObject({
      laneType: 1,
      level: 7,
      bmsLevel: 9,
      category: 1,
      phase: 3,
      songId: 12,
      endTick: 3840,
    });
    expect(chart.resources.wav).toEqual({ '01': 'kick.wav', '02': 'snare.wav' });
    expect(
      chart.events.map(({ measure, channel, position, value, lrx }) => ({ measure, channel, position, value, lrx })),
    ).toEqual([
      { measure: 0, channel: '08', position: [0, 1920], value: '01', lrx: undefined },
      { measure: 0, channel: '11', position: [0, 1920], value: '01', lrx: undefined },
      { measure: 0, channel: '16', position: [480, 1920], value: '02', lrx: undefined },
      { measure: 0, channel: '01', position: [960, 1920], value: '02', lrx: undefined },
      { measure: 1, channel: '15', position: [0, 1920], value: '01', lrx: { length: 960 } },
    ]);
    expect(chart.resources.bpm).toEqual({ '01': 150 });
    expect(chart.diagnostics).toBeUndefined();
  });

  test('takes the starting BPM from the first BPM note and the measures from the bar lines', () => {
    const chart = parseLRX({
      lrs: lrs(
        '<n c="301" s="0" p="120" />',
        '<n c="300" s="480" />',
        '<n c="300" s="1920" />',
        '<n c="301" s="1920" p="180" />',
        '<n c="1" s="2400" p="0" />',
      ),
    });
    expect(chart.metadata.bpm).toBe(120);
    expect(chart.lrx?.barTicks).toEqual([0, 480, 1920]);
    // 0–480 is a quarter measure, 480–1920 three quarters; past the last bar line measures are 4/4.
    expect(chart.measures).toEqual([
      { index: 0, length: 0.25 },
      { index: 1, length: 0.75 },
    ]);
    const note = chart.events.find((event) => event.channel === '11')!;
    expect([note.measure, note.position]).toEqual([2, [480, 1920]]);
  });

  test('converts a STOP in milliseconds to BMS units at the BPM in force on its tick', () => {
    const chart = parseLRX({
      lrs: lrs('<n c="301" s="0" p="120" />', '<n c="302" s="960" p="500" />', '<n c="301" s="960" p="60" />'),
    });
    // 500 ms at 60 BPM is half a beat: 24 units of 1/192 measure.
    expect(chart.resources.stop).toEqual({ '01': 24 });
    expect(chart.events.filter((event) => event.channel === '09')).toHaveLength(1);
  });

  test('plays hidden (dmg=0) and chain notes in the background and keeps their values', () => {
    const chart = parseLRX({
      lrs: lrs(
        '<n c="301" s="0" p="120" />',
        '<n c="2" s="0" p="3" dmg="0" />',
        // A note before it on lane 3, so the chain note follows in the background.
        '<n c="3" s="0" p="7" />',
        '<n c="3" s="0" p="4" cn="1" />',
        '<n c="5" s="0" p="6" cn="1" dmg="0" />',
        '<n c="4" s="0" p="5" vol="64" pan="0" frq="22050" atk="10" rls="20" ost="30" len="40" rev="1" dmg="50" rcv="80" />',
      ),
      lrh: lrh('lanetype="1"'),
    });
    const byValue = new Map(chart.events.map((event) => [event.value, event]));
    expect(byValue.get('04')).toMatchObject({ channel: '01', lrx: { damage: 0, lane: '12', keyVolume: true } });
    // A chain note remembers its lane, for chart-model to tie it to the lane's preceding note.
    expect(byValue.get('05')).toMatchObject({ channel: '01', lrx: { chain: true, lane: '13', keyVolume: true } });
    // A hidden chain note keeps its lane too; chart-model ties it to nothing, since plugout keeps it out of the lane.
    expect(byValue.get('07')!.lrx).toEqual({ chain: true, damage: 0, lane: '15', keyVolume: true });
    expect(byValue.get('06')).toMatchObject({
      channel: '14',
      lrx: {
        volume: 64,
        pan: 0,
        frequency: 22050,
        attackMs: 10,
        releaseMs: 20,
        offsetMs: 30,
        lengthMs: 40,
        reverse: true,
        damage: 50,
        recover: 80,
      },
    });
  });

  test('lays out each lane type', () => {
    const lanes = (laneType: number | undefined, channels: number[]) =>
      parseLRX({
        lrs: lrs('<n c="301" s="0" p="120" />', ...channels.map((c) => `<n c="${c}" s="0" p="0" />`)),
        ...(laneType === undefined ? {} : { lrh: lrh(`lanetype="${laneType}"`) }),
      })
        .events.filter((event) => event.channel !== '08')
        .map((event) => event.channel)
        .sort();
    expect(lanes(0, [0, 6, 7])).toEqual(['16', '18', '19']);
    expect(lanes(3, [10, 11, 15])).toEqual(['21', '25', '26']);
    expect(lanes(2, [16, 17])).toEqual(['28', '29']);
    expect(lanes(4, [1, 6, 9])).toEqual(['11', '22', '25']);
    // Without a header, keys 8 / 9 and nothing past them read as 9 keys.
    expect(lanes(undefined, [1, 9])).toEqual(['11', '25']);
    expect(lanes(undefined, [1, 10])).toEqual(['11', '26']);
  });

  test('warns about lane types and channels Be-Music cannot lay out', () => {
    const chart = parseLRX({
      lrs: lrs('<n c="301" s="0" p="120" />', '<n c="8" s="0" p="0" />', '<n c="205" s="0" p="0" />'),
      lrh: lrh('lanetype="5"'),
    });
    expect(chart.diagnostics?.map((diagnostic) => [diagnostic.code, diagnostic.subject])).toEqual([
      ['unsupported-lane-type', '5'],
      ['unsupported-channel', '8'],
      // plugout draws layers 201–204 only.
      ['unsupported-channel', '205'],
    ]);
    // The lane outside the table plays in the background.
    expect(chart.events.find((event) => event.value === '01' && event.channel === '01')).toBeDefined();
    expect(parseLRX({ lrs: lrs(), lrh: lrh('lanetype="9"') }).diagnostics?.[0]?.code).toBe('unsupported-lane-type');
  });

  test('judges a chain note that starts its lane, as plugout does', () => {
    const chart = parseLRX({
      lrs: lrs('<n c="301" s="0" p="120" />', '<n c="1" s="0" p="0" cn="1" />', '<n c="1" s="480" p="1" cn="1" />'),
    });
    const byValue = new Map(chart.events.map((event) => [event.value, event]));
    // The first is the lane's note; the second follows it in the background.
    expect(byValue.get('01')).toMatchObject({ channel: '11', lrx: { chain: true } });
    expect(byValue.get('02')).toMatchObject({ channel: '01', lrx: { chain: true, lane: '11' } });
  });

  test('keeps every BGA cue with its transform when the BMS channels cannot carry it', () => {
    const plain = parseLRX({ lrs: lrs('<n c="301" s="0" p="120" />', '<n c="200" s="0" p="0" />') });
    expect(plain.lrx?.bga).toBeUndefined();
    const chart = parseLRX({
      lrs: lrs(
        '<n c="301" s="0" p="120" />',
        '<n c="200" s="0" p="0" />',
        '<n c="203" s="480" e="960" p="1" sx="1" sy="2" sw="3" sh="4" dx="5" dy="6" dw="7" dh="8" a="9" bld="1" rot="30" ctr="7" acc="2" />',
        '<n c="203" s="960" p="2" cn="1" />',
      ),
    });
    expect(chart.lrx?.bga).toEqual([
      { slot: 0, tick: 0, image: 0, key: '01' },
      {
        slot: 3,
        tick: 480,
        endTick: 960,
        image: 1,
        key: '02',
        src: [1, 2, 3, 4],
        dst: [5, 6, 7, 8],
        color: [9, 255, 255, 255],
        blend: 1,
        rotation: 30,
        center: 7,
        accel: 2,
      },
      { slot: 3, tick: 960, image: 2, key: '03', chain: true },
    ]);
    // Layer 203 has no BMS channel; the base stays on `04` for every other player.
    expect(chart.events.filter((event) => event.channel === '04')).toHaveLength(1);
  });

  test('reads the BGA file: one id table for images and movies, base / layers / POOR', () => {
    const chart = parseLRX({
      lrs: lrs('<n c="301" s="0" p="120" />'),
      lrm:
        '<LRM><information artist_movie="vj" size="2" /><movie id="1" filename="a.mp4" /><image id="2" filename="b.bmp" />' +
        '<n c="200" s="0" p="1" /><n c="201" s="0" p="2" /><n c="202" s="0" p="2" /><n c="299" s="0" p="2" /></LRM>',
    });
    expect(chart.resources.bmp).toEqual({ '02': 'a.mp4', '03': 'b.bmp' });
    expect(chart.lrx?.movieArtist).toBe('vj');
    expect(chart.events.filter((event) => event.channel !== '08').map((event) => [event.channel, event.value])).toEqual(
      [
        ['04', '02'],
        ['06', '03'],
        ['07', '03'],
        ['0A', '03'],
      ],
    );
  });

  test('moves to base-62 keys when sound ids pass 1,294', () => {
    const chart = parseLRX({ lrs: lrs('<sound id="1295" filename="last.wav" />', '<n c="100" s="0" p="1295" />') });
    expect(chart.bms.base).toBe(62);
    // Key 1,296 in base 62 (`0-9A-Za-z`).
    expect(chart.resources.wav).toEqual({ Ku: 'last.wav' });
  });

  test('falls back to the header BPM, then the default, without a BPM note', () => {
    expect(parseLRX({ lrs: lrs(), lrh: lrh('startbpm="155"') }).metadata.bpm).toBe(155);
    expect(parseLRX({ lrs: lrs() }).metadata.bpm).toBe(130);
  });

  test('round-trips through Be-Music JSON', () => {
    const chart = parseLRX({ lrs: BASIC, lrh: lrh('lanetype="1" title="Song"') });
    expect(parseChart(JSON.stringify(chart), 'json')).toEqual(chart);
  });
});

describe('parseLRXBytes', () => {
  test('decodes the UTF-16 files plugout writes', () => {
    const chart = parseLRXBytes({ lrs: utf16(BASIC), lrh: utf16(lrh('title="曲"')) });
    expect(chart.metadata.title).toBe('曲');
    expect(chart.events).toHaveLength(5);
  });
});

describe('LRX sibling paths', () => {
  test('the header swaps the extension', () => {
    expect(resolveLRXHeaderPath('song/001/01.lrs')).toBe('song/001/01.lrh');
    expect(resolveLRXHeaderPath('song.v2/01')).toBe('song.v2/01.lrh');
  });

  test('the BGA file comes from the header, then the sequence, then the default', () => {
    const sequence = utf16(lrs('<information moviepath="_movie_sp.lrm" />'));
    expect(resolveLRXMoviePath(sequence, utf16(lrh('moviepath="_movie_dp.lrm"')))).toBe('_movie_dp.lrm');
    expect(resolveLRXMoviePath(sequence)).toBe('_movie_sp.lrm');
    expect(resolveLRXMoviePath(utf16(lrs()), utf16(lrh('moviepath=""')))).toBe('_movie.lrm');
  });
});

describe('parseChartFile', () => {
  test('reads an .lrs chart with the header and BGA file beside it', async () => {
    const [{ mkdtemp, rm, writeFile }, { tmpdir }, { join }, { parseChartFile }] = await Promise.all([
      import('node:fs/promises'),
      import('node:os'),
      import('node:path'),
      import('../node-file.ts'),
    ]);
    const dir = await mkdtemp(join(tmpdir(), 'lrx-'));
    try {
      await writeFile(join(dir, '02.lrs'), utf16(lrs('<n c="301" s="0" p="120" />', '<n c="11" s="0" p="0" />')));
      await writeFile(join(dir, '02.lrh'), utf16(lrh('title="DP" lanetype="3" moviepath="_movie_dp.lrm"')));
      await writeFile(join(dir, '_movie_dp.lrm'), utf16('<LRM><movie id="1" filename="dp.mp4" /></LRM>'));
      const chart = await parseChartFile(join(dir, '02.lrs'));
      expect(chart.metadata.title).toBe('DP');
      expect(chart.resources.bmp).toEqual({ '02': 'dp.mp4' });
      expect(chart.events.map((event) => event.channel)).toContain('21');
      // Without the header and BGA file the sequence still reads.
      await writeFile(join(dir, '03.lrs'), utf16(lrs('<n c="1" s="0" p="0" />')));
      expect((await parseChartFile(join(dir, '03.lrs'))).sourceFormat).toBe('lrx');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('LRX background volume', () => {
  test('only the BGM columns with a non-zero dmg play at the BGM volume, as plugout groups them', () => {
    const chart = parseLRX({
      lrs: lrs(
        '<n c="301" s="0" p="120" />',
        '<n c="100" s="0" p="0" />',
        '<n c="150" s="0" p="1" dmg="0" />',
        '<n c="20" s="0" p="2" />',
        '<n c="1" s="0" p="3" />',
      ),
    });
    const byValue = new Map(chart.events.map((event) => [event.value, event]));
    expect(byValue.get('01')!.lrx?.keyVolume).toBeUndefined();
    expect(byValue.get('02')!.lrx?.keyVolume).toBe(true);
    expect(byValue.get('03')!.lrx?.keyVolume).toBe(true);
    // A lane note is a keysound by its lane; it needs no flag.
    expect(byValue.get('04')!.lrx?.keyVolume).toBeUndefined();
  });
});

describe('normalizeLRXEventExtensions', () => {
  test("keeps a chain note's lane when reading Be-Music JSON back", () => {
    expect(normalizeLRXEventExtensions({ chain: true, lane: '13', keyVolume: true, other: 1 })).toEqual({
      chain: true,
      lane: '13',
      keyVolume: true,
    });
    expect(normalizeLRXEventExtensions({ lane: 13 })).toBeUndefined();
  });
});
