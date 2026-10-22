import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { zipSync } from 'fflate';

/** Where the specs serve the zipped fixture folders on the embed's own origin. */
const TRACK_ROUTE = '/__e2e/track/';

async function zipFolders(folders: readonly string[]): Promise<Uint8Array> {
  const root = process.env.E2E_FIXTURES;
  if (root === undefined) throw new Error('E2E_FIXTURES is not set: run the specs through the Playwright config');
  const files: Record<string, Uint8Array> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files[relative(root, path).split(sep).join('/')] = new Uint8Array(await readFile(path));
    }
  };
  for (const folder of folders) await walk(join(root, folder));
  return zipSync(files);
}

/** Opens the embed on a track holding the fixture `folders`, with `?chart=` when `chart` is given. */
async function openEmbed(page: Page, folders: readonly string[], chart?: string): Promise<void> {
  const name = `${folders.join('-')}.zip`;
  const body = Buffer.from(await zipFolders(folders));
  await page.route(`**${TRACK_ROUTE}${name}`, (route) => route.fulfill({ body, contentType: 'application/zip' }));
  const query = chart === undefined ? '' : `&chart=${encodeURIComponent(chart)}`;
  await page.goto(`/embed/?track=${encodeURIComponent(`${TRACK_ROUTE}${name}`)}${query}`);
}

const stageCanvas = (page: Page) => page.locator('canvas[aria-label="be-music stage"]');

test('a single chart waits behind a play button, plays in AUTO with seekable controls, and offers a replay', async ({
  page,
}, info) => {
  await openEmbed(page, ['songs/fixA']);
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled({ timeout: 60_000 });
  await expect(stageCanvas(page)).toHaveCount(0);
  const hud = page.locator('be-music-preview-hud');
  await expect(hud.getByRole('heading', { name: 'Fixture A' })).toBeVisible();
  await play.click();
  const seek = hud.getByRole('slider', { name: 'Seek' });
  await expect(seek).toBeEnabled({ timeout: 30_000 });
  for (const part of ['be-music-bga', 'be-music-lanes', 'be-music-notes', 'be-music-judge-line']) {
    await expect(page.locator(`be-music-playfield ${part} canvas`)).toBeAttached();
  }
  // Lanes on the left half, and the BGA as tall as the space above the controls, right of the lanes.
  const lanes = (await page.locator('be-music-lanes').boundingBox())!;
  const bga = (await page.locator('be-music-bga').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(lanes.x + lanes.width).toBeLessThanOrEqual(viewport.width / 2);
  expect(bga.x).toBeGreaterThanOrEqual(lanes.x + lanes.width);
  expect(bga.height).toBeGreaterThan(viewport.height * 0.6);
  await page.screenshot({ path: info.outputPath('embed-play.png') });
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThanOrEqual(4);
  await expect(stageCanvas(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.screenshot({ path: info.outputPath('embed-replay.png') });
});

test('several charts list first, play the one picked at once, and return to the list', async ({ page }, info) => {
  await openEmbed(page, ['songs/fixA', 'songs/fixB']);
  const list = page.locator('be-music-preview-select');
  await expect(list.getByRole('button')).toHaveCount(2, { timeout: 60_000 });
  await expect(stageCanvas(page)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('embed-select.png') });
  await list.getByRole('button', { name: /Fixture A/ }).click();
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await expect(page.locator('be-music-preview-hud').getByRole('heading', { name: 'Fixture A' })).toBeVisible();
  await expect(page.locator('be-music-preview-select').getByRole('button')).toHaveCount(2, { timeout: 60_000 });
});

test('?chart= plays the chart it names on its own, and a name matching none lists the track', async ({ page }) => {
  await openEmbed(page, ['songs/fixA', 'songs/fixB'], 'fixB.bms');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('be-music-preview-hud').getByRole('heading', { name: 'Fixture B' })).toBeVisible();
  await expect(page.locator('be-music-preview-select')).toHaveCount(0);

  await openEmbed(page, ['songs/fixA', 'songs/fixB'], 'missing.bms');
  await expect(page.locator('be-music-preview-select').getByRole('button')).toHaveCount(2, { timeout: 60_000 });
});

test('a long chart list scrolls to its last chart', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 200 });
  await openEmbed(page, ['songs']);
  const list = page.locator('be-music-preview-select');
  const rows = list.getByRole('button');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const last = rows.last();
  await expect(last).not.toBeInViewport();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});

test('asks the platform audio session for playback, so an iPhone in silent mode still plays the sound', async ({
  page,
}) => {
  // Chromium has no `navigator.audioSession` (Safari's Audio Session API); stand one in to see what the embed asks for.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
  });
  await openEmbed(page, ['songs/fixA']);
  await expect
    .poll(() => page.evaluate(() => (navigator as { audioSession?: { type: string } }).audioSession?.type))
    .toBe('playback');
});
