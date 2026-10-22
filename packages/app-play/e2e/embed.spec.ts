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

test('seeks back and forth: the time follows the second sought, and the combo is the one reached by playing there', async ({
  page,
}) => {
  // Fixture A at 150 BPM: a PGREAT every 0.4 s from 1.6 s to 6.0 s, twelve notes.
  const notesBy = (seconds: number): number => Math.max(0, Math.min(12, Math.floor((seconds - 1.6) / 0.4 + 1e-9) + 1));
  await openEmbed(page, ['songs/fixA']);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const hud = page.locator('be-music-preview-hud');
  const seek = hud.getByRole('slider', { name: 'Seek' });
  await expect(seek).toBeEnabled({ timeout: 30_000 });
  // Lets the seek bar go at `seconds`, as a drag does (`change`).
  const seekTo = (seconds: number) =>
    seek.evaluate((input: HTMLInputElement, value: number) => {
      input.value = String(value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, seconds);
  const combo = hud.locator('p.line', { hasText: 'Combo' });
  const judgments = hud.locator('.judgments');
  const expectAt = async (seconds: number): Promise<void> => {
    const notes = notesBy(seconds);
    await expect.poll(async () => Number(await seek.inputValue())).toBeCloseTo(seconds, 1);
    // The combo and max combo a play from the start shows there, all PGREAT under AUTO.
    await expect(combo).toHaveText(new RegExp(`EX SCORE ${notes * 2}\\s[\\s\\S]*Combo ${notes}\\s*/\\s*${notes}\\s*$`));
    await expect(judgments).toHaveText(new RegExp(`PG\\s*${notes}\\b`));
  };
  // Paused, the play stays where it was sought.
  await page.keyboard.press('Space');
  await expect(hud.getByRole('status')).toHaveText('Paused');
  await seekTo(5);
  await expectAt(5);
  await expect(hud.getByRole('status')).toHaveText('Paused');
  // Back: the notes after the second sought are not judged any more, the max combo included.
  await seekTo(3);
  await expectAt(3);
  await seekTo(4.5);
  await expectAt(4.5);
  // Played on from there, the time runs on from the second sought and the combo keeps counting.
  await page.keyboard.press('Space');
  await expect(hud.getByRole('status')).toHaveCount(0);
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(4.7);
  await expect(combo).toHaveText(/Combo 12\s*\/\s*12\s*$/, { timeout: 30_000 });
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

test('a paused play shows a centred play button, and the controls fade out while the viewer is idle', async ({
  page,
}) => {
  await openEmbed(page, ['songs/fixD']);
  await page.getByRole('button', { name: 'Play', exact: true }).click({ timeout: 60_000 });
  const hud = page.locator('be-music-preview-hud');
  await expect(hud.getByRole('slider', { name: 'Seek' })).toBeEnabled({ timeout: 30_000 });
  await hud.getByRole('button', { name: 'Pause' }).click();
  const resume = hud.locator('button.resume');
  await expect(resume).toBeVisible();
  await expect(hud.getByText('Paused', { exact: true })).toHaveCount(0);
  // Paused, the controls stay however long the viewer waits.
  await page.waitForTimeout(3500);
  await expect(hud).not.toHaveAttribute('controls-hidden');
  await resume.click();
  await expect(resume).toHaveCount(0);
  // Playing untouched, they fade out; moving the pointer brings them back.
  await expect(hud).toHaveAttribute('controls-hidden', '', { timeout: 6000 });
  await page.mouse.move(10, 10);
  await expect(hud).not.toHaveAttribute('controls-hidden');
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
