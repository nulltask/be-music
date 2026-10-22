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

/** Opens the embed on a track holding the fixture `folders`. */
async function openEmbed(page: Page, folders: readonly string[]): Promise<void> {
  const name = `${folders.join('-')}.zip`;
  const body = Buffer.from(await zipFolders(folders));
  await page.route(`**${TRACK_ROUTE}${name}`, (route) => route.fulfill({ body, contentType: 'application/zip' }));
  await page.goto(`/embed/?track=${encodeURIComponent(`${TRACK_ROUTE}${name}`)}`);
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
  // Lanes on the left half, the BGA on the right.
  const lanes = (await page.locator('be-music-lanes').boundingBox())!;
  const bga = (await page.locator('be-music-bga').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(lanes.x + lanes.width).toBeLessThanOrEqual(viewport.width / 2);
  expect(bga.x).toBeGreaterThanOrEqual(viewport.width / 2);
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
