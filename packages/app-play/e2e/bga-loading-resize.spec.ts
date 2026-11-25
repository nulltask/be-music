import { readFile } from 'node:fs/promises';
import { expect, SMOKE, test } from './support.ts';

type MonitorSample = { x: number; w: number; h: number; loading: boolean };

test('widens the opening video monitor while NOW LOADING is drawn', SMOKE, async ({ player }, info) => {
  const { page } = player;
  await page.addInitScript(() => {
    const samples: MonitorSample[] = [];
    Object.assign(window, { testBGAMonitorSamples: samples });
    const monitor = new WeakMap<object, MonitorSample>();
    // Plain cuts its BGA window out of the chrome canvas before drawing the loading label.
    for (const prototype of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
      // The wrappers invoke the originals with the same Canvas receiver.
      const clearRect = Reflect.get(prototype, 'clearRect') as typeof prototype.clearRect;
      prototype.clearRect = function (x, y, w, h) {
        if (y === 98 && x > 0 && w > 0 && h > 0) {
          const sample = { x, w, h, loading: false };
          monitor.set(this, sample);
          samples.push(sample);
        }
        clearRect.call(this, x, y, w, h);
      };
      const fillText = Reflect.get(prototype, 'fillText') as typeof prototype.fillText;
      prototype.fillText = function (text, x, y, maxWidth) {
        const sample = monitor.get(this);
        if (text === 'NOW LOADING' && sample) sample.loading = true;
        if (maxWidth === undefined) fillText.call(this, text, x, y);
        else fillText.call(this, text, x, y, maxWidth);
      };
    }
  });
  await player.open({ 'be-music.built-in-skin': 'plain', 'be-music.skin-effects': 'full' });
  await page.getByRole('button', { name: 'Close drop card' }).click();
  const before = (await player.state()).loads;
  const video = (await readFile('test/fixtures/bga-crop-colors.webm')).toString('base64');
  await page.evaluate((video) => {
    const files = [
      new File([Uint8Array.from(atob(video), (character) => character.charCodeAt(0))], 'wide.webm'),
      new File(['#TITLE Wide BGA\n#BPM 120\n#BMP01 wide.webm\n#00004:01\n#00111:01\n#00411:01\n'], 'wide.bms'),
    ];
    const drop = new Event('drop', { cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
    window.dispatchEvent(drop);
  }, video);
  await player.waitFor((state) => state.loads > before && !state.loading, 'the wide BGA chart');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.key('Enter');
  await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? -1) > 0, 'chart playback');

  const samples = await page.evaluate(
    () => (window as unknown as { testBGAMonitorSamples: MonitorSample[] }).testBGAMonitorSamples,
  );
  const fitted = samples.at(-1)!;
  expect(fitted.w).toBeGreaterThan(fitted.h);
  const intermediate = samples.find(({ w, h, loading }) => loading && w > h + 1 && w < fitted.w - 1);
  expect(intermediate).toBeDefined();
  expect(intermediate!.h).toBe(fitted.h);
  expect(intermediate!.x + intermediate!.w / 2).toBeCloseTo(fitted.x + fitted.w / 2);
  await page.locator('#stage canvas').screenshot({ path: info.outputPath('wide-bga.png') });
});
