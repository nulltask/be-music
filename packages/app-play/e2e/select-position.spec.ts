import { expect, test } from './support.ts';

test('the select screen opens where the last visit left it', async ({ player }) => {
  const { page } = player;
  await page.route('**/api/player-settings', (route) => route.fulfill({ status: 204 }));
  await page.route('**/__url-load-proxy?**', (route) => route.fulfill({ status: 404 }));
  await player.open({ 'be-music.lang': 'en' });

  // Two remembered folders (as `dropped-folders.spec.ts` drops them), so the next visit lists them again.
  for (const name of ['First pack', 'Second pack']) {
    const before = (await player.state()).loads;
    await page.evaluate(async (name) => {
      const chart = new File([`#TITLE ${name}\n#BPM 120\n#WAV01 kick.wav\n#00111:01\n`], 'chart.bms');
      const directory = {
        isDirectory: true,
        isFile: false,
        name,
        fullPath: `/${name}`,
        createReader() {
          let read = false;
          return {
            readEntries(complete: (entries: unknown[]) => void) {
              const entry = {
                isDirectory: false,
                isFile: true,
                name: chart.name,
                fullPath: `/${name}/${chart.name}`,
                file: (complete: (file: File) => void) => complete(chart),
              };
              complete(read ? [] : [entry]);
              read = true;
            },
          };
        },
      };
      const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
      const savedChart = await handle.getFileHandle(chart.name, { create: true });
      const writer = await savedChart.createWritable();
      await writer.write(chart);
      await writer.close();
      const item = { kind: 'file', webkitGetAsEntry: () => directory, getAsFileSystemHandle: async () => handle };
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [item], files: [], types: ['Files'] } });
      window.dispatchEvent(event);
    }, name);
    await player.waitFor((state) => state.loads > before && !state.loading, `the drop of ${name}`);
  }
  await page.waitForFunction(async () => {
    const name = 'be-music-folder-snapshots';
    if (!(await indexedDB.databases()).some((database) => database.name === name)) return false;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const count = database.transaction('snapshots', 'readonly').objectStore('snapshots').count();
        count.onsuccess = () => resolve(count.result === 2);
        count.onerror = () => reject(count.error);
      });
    } finally {
      database.close();
    }
  });

  const left = await player.openFolder('Second pack');
  expect(left.cursor?.bar).toMatchObject({ kind: 'chart', title: 'Second pack' });

  await page.reload();
  const first = await player.waitFor((state) => state.scene.kind === 'select', 'the first select screen after reload');
  expect(first.cursor?.folderPath).toEqual(['Second pack']);
  expect(first.cursor?.bar).toMatchObject({ kind: 'chart', title: 'Second pack' });
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem('be-music.select-position'))) ?? 'null'),
  ).toMatchObject({ folderPath: ['Second pack'] });
});
