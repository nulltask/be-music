import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, test } from './support.ts';

test('Synesthesia shows distinct marks for library entry types', async ({ player }, info) => {
  const { page } = player;
  const server = 'https://music.bemuse.example';
  const output = process.env.SELECT_PREVIEW_OUTPUT ?? info.outputDir;
  const chart = (title: string, artist: string, level: number, bpm: number) =>
    `#TITLE ${title}\n#ARTIST ${artist}\n#PLAYLEVEL ${level}\n#BPM ${bpm}\n#WAV01 keys.wav\n#00111:01010101\n#01213:0101\n#02415:01\n`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(`${server}/**`, async (route) => {
    const headers = { 'access-control-allow-origin': '*' };
    await route.fulfill(
      new URL(route.request().url()).pathname === '/index.json'
        ? { headers, json: { songs: [{ path: 'song', bemusepack_url: null, charts: [{ file: 'server.bms' }] }] } }
        : { headers, body: chart('Remote Horizon', 'Bemuse collection', 6, 130) },
    );
  });
  await player.open({
    'be-music.built-in-skin': 'synesthesia',
    'be-music.skin-effects': 'full',
    'be-music.bemuse-server-urls': JSON.stringify([`${server}/index.json`]),
    'be-music.course-table-urls': '[]',
  });
  const one = chart('Glass Horizon', 'Mina Vale', 5, 128);
  const md5 = createHash('md5').update(one).digest('hex');
  const hash = '0'.repeat(32) + md5.repeat(3);
  const courses = ['Twilight Circuit', 'Night Drive', '7th Dan'].map(
    (title, type) => `<course><title>${title}</title><type>${type}</type><line>7</line><hash>${hash}</hash></course>`,
  );
  const before = (await player.state()).loads;
  await page.evaluate(
    (entries) => {
      const files = entries.map(([path, text]) => {
        const file = new File([text!], path!.split('/').at(-1)!);
        Object.defineProperty(file, 'webkitRelativePath', { value: path });
        return file;
      });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
      window.dispatchEvent(event);
    },
    [
      ['Local Music/glass.bms', one],
      ['Local Music/afterimage.bms', chart('Afterimage', 'Signal Garden', 8, 165)],
      ['Local Music/orbit.bms', chart('Orbit Breaker', 'Arc Station', 11, 180)],
      ['Course Collection.lr2crs', `<courselist>${courses.join('')}</courselist>`],
      ['header.json', JSON.stringify({ name: 'Starlight', course: [[{ name: 'Starlight Dan', md5: [md5] }]] })],
    ],
  );
  await player.waitFor(
    (state) => state.loads > before && !state.loading && state.library.charts === 4,
    'preview library',
  );
  const capture = async (name: string) => {
    await page.waitForTimeout(850);
    await page.screenshot({ path: join(output, `select-types-${name}.png`) });
  };
  let state = await player.state();
  if (state.cursor?.folderPath.length) await player.key('Escape');
  await player.cursorTo((bar) => bar.kind === 'folder' && bar.title.startsWith('Bemuse '), 'Bemuse server');
  await capture('folders');
  state = await player.openFolder('Course Collection');
  expect(state.cursor?.bar?.kind).toBe('course');
  await player.cursorTo((bar) => bar.title === 'Night Drive', 'Non Stop course');
  await capture('courses');
  await player.browseTo('Local Music', 'Glass Horizon');
  await capture('music');
});
