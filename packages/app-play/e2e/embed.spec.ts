import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { lr2CourseList } from '../../../scripts/course-checklist/fixtures.ts';
import { SMOKE } from './support.ts';

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

/** Opens the embed on a track holding the fixture `folders`, with `?chart=` and `?mode=` when given. */
async function openEmbed(page: Page, folders: readonly string[], chart?: string, mode?: 'play'): Promise<void> {
  const name = `${folders.join('-')}.zip`;
  const body = Buffer.from(await zipFolders(folders));
  await page.route(`**${TRACK_ROUTE}${name}`, (route) => route.fulfill({ body, contentType: 'application/zip' }));
  const query =
    (chart === undefined ? '' : `&chart=${encodeURIComponent(chart)}`) + (mode === undefined ? '' : `&mode=${mode}`);
  await page.goto(`/embed/?track=${encodeURIComponent(`${TRACK_ROUTE}${name}`)}${query}`);
}

const stageCanvas = (page: Page) => page.locator('canvas[aria-label="be-music stage"]');

/** Fails when `inner` sticks out of `outer`, as a theme's fixed button height once cut the content of a row or a button. */
async function expectInside(outer: Locator, inner: Locator): Promise<void> {
  const a = (await outer.boundingBox())!;
  const b = (await inner.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(a.x - 0.5);
  expect(b.y).toBeGreaterThanOrEqual(a.y - 0.5);
  expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width + 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(a.y + a.height + 0.5);
}

test(
  'a single chart waits behind a play button, plays in AUTO with seekable controls, and offers a replay',
  SMOKE,
  async ({ page }, info) => {
    await openEmbed(page, ['songs/fixA']);
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeEnabled({ timeout: 60_000 });
    await expect(stageCanvas(page)).toHaveCount(0);
    await expectInside(play, play.locator('svg'));
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
  },
);

test('?mode=play lets the viewer play: no seeking, and M is a lane rather than mute', async ({ page }) => {
  await openEmbed(page, ['songs/fixA'], undefined, 'play');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled({ timeout: 60_000 });
  // Before the play starts, M still mutes.
  const hud = page.locator('be-music-preview-hud');
  await page.keyboard.press('KeyM');
  await expect(hud.getByRole('button', { name: 'Unmute' })).toBeAttached();
  await page.keyboard.press('KeyM');
  await play.click();
  // The picture is a Pause button too: ask the controls bar's.
  const controls = hud.locator('be-music-playback-controls');
  await expect(controls.getByRole('button', { name: 'Pause', exact: true })).toBeAttached({ timeout: 30_000 });
  await expect(hud.getByRole('slider', { name: 'Seek' })).toBeDisabled();
  await page.keyboard.press('KeyM');
  await expect(hud.getByRole('button', { name: 'Mute', exact: true })).toBeAttached();
  await expect(hud.getByRole('button', { name: 'Unmute' })).toHaveCount(0);
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
  // Lets the seek bar go at `seconds`. A drag also seeks on `input`; `change` is the release.
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
  await expect(hud.locator('button.resume')).toBeVisible();
  await seekTo(5);
  await expectAt(5);
  await expect(hud.locator('button.resume')).toBeVisible();
  // Back: the notes after the second sought are not judged any more, the max combo included.
  await seekTo(3);
  await expectAt(3);
  await seekTo(4.5);
  await expectAt(4.5);
  // Played on from there, the time runs on from the second sought and the combo keeps counting.
  await page.keyboard.press('Space');
  await expect(hud.locator('button.resume')).toHaveCount(0);
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(4.7);
  await expect(combo).toHaveText(/Combo 12\s*\/\s*12\s*$/, { timeout: 30_000 });
});

test('several charts list first, play the one picked at once, and return to the list', async ({ page }, info) => {
  await openEmbed(page, ['songs/fixA', 'songs/fixB']);
  const list = page.locator('be-music-preview-select');
  await expect(list.getByRole('button')).toHaveCount(2, { timeout: 60_000 });
  await expect(stageCanvas(page)).toHaveCount(0);
  for (const row of await list.getByRole('button').all()) {
    await expectInside(row, row.locator('[part~="artwork"]'));
    await expectInside(row, row.locator('.title'));
  }
  // The list keeps its padding even under the page's reset of every element's padding.
  expect((await list.getByRole('heading').boundingBox())!.x).toBeGreaterThan(0);
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
  await hud.locator('be-music-playback-controls').getByRole('button', { name: 'Pause', exact: true }).click();
  const resume = hud.locator('button.resume');
  await expect(resume).toBeVisible();
  await expectInside(resume, resume.locator('svg'));
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

test('the play fills the window at any aspect ratio and follows a resize, then still seeks', async ({ page }, info) => {
  await openEmbed(page, ['songs/fixD']);
  await page.getByRole('button', { name: 'Play', exact: true }).click({ timeout: 60_000 });
  const hud = page.locator('be-music-preview-hud');
  const seek = hud.getByRole('slider', { name: 'Seek' });
  await expect(seek).toBeEnabled({ timeout: 30_000 });
  await hud.locator('be-music-playback-controls').getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(hud.locator('button.resume')).toBeVisible();
  const sizes = [
    { name: '16x9', width: 1280, height: 720 },
    { name: '4x3', width: 1024, height: 768 },
    { name: '21x9', width: 1680, height: 720 },
    { name: 'phone-portrait', width: 375, height: 812 },
    { name: 'tablet-portrait', width: 768, height: 1024 },
    { name: 'phone-landscape', width: 812, height: 375 },
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    // No letterbox: the HUD's and the playfield's stages cover the whole window.
    for (const stage of [hud.locator('[part="stage"]'), page.locator('be-music-playfield [part="stage"]')]) {
      await expect
        .poll(async () => {
          const box = (await stage.boundingBox())!;
          return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
        })
        .toEqual([0, 0, size.width, size.height]);
    }
    const lanes = (await page.locator('be-music-lanes').boundingBox())!;
    const bga = (await page.locator('be-music-bga').boundingBox())!;
    // The chart's facts fit their box, and stay off the lanes and the BGA.
    const facts = hud.locator('[aria-label="Chart and play status"]');
    expect(await facts.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    const factsBox = (await facts.boundingBox())!;
    if (size.height > size.width) expect(factsBox.y + factsBox.height).toBeLessThanOrEqual(lanes.y + 1);
    else expect(factsBox.x).toBeGreaterThanOrEqual(lanes.x + lanes.width);
    expect(factsBox.y >= bga.y + bga.height - 1 || factsBox.x >= bga.x + bga.width - 1).toBe(true);
    if (size.height > size.width) {
      expect(bga.y + bga.height).toBeLessThanOrEqual(lanes.y + 1);
      expect(lanes.x).toBeGreaterThanOrEqual(0);
      expect(lanes.x + lanes.width).toBeLessThanOrEqual(size.width);
    } else {
      expect(lanes.x + lanes.width).toBeLessThanOrEqual(size.width / 2 + 1);
      expect(bga.x).toBeGreaterThanOrEqual(lanes.x + lanes.width);
      expect(bga.x + bga.width).toBeLessThanOrEqual(size.width);
    }
    await page.screenshot({ path: info.outputPath(`embed-${size.name}.png`) });
  }
  // The controls still seek after the resizes.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThanOrEqual(4);
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

/** A course pack with both stages' assets; beatoraja is deliberately outside a `course/` folder. */
async function openCourseEmbed(
  page: Page,
  options: {
    format: 'lr2' | 'beatoraja';
    many?: boolean;
    missing?: boolean;
    kind?: 0 | 1 | 2;
    name?: string;
    query?: string;
  },
): Promise<void> {
  const files = unzipSync(await zipFolders(['songs/fixA', 'songs/fixB']));
  const paths = ['songs/fixA/fixA.bms', 'songs/fixB/fixB.bms'];
  const hashes = paths.map((path) => {
    const bytes = files[path]!;
    return {
      md5: createHash('md5').update(bytes).digest('hex'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  if (options.missing) hashes[1] = { md5: '0'.repeat(32), sha256: '0'.repeat(64) };
  const names = options.many ? ['Preview course', 'Other course'] : ['Preview course'];
  const path = options.format === 'lr2' ? 'courses/preview.lr2crs' : 'preview.json';
  const content =
    options.format === 'lr2'
      ? lr2CourseList(names.map((title) => ({ title, type: options.kind ?? 0, md5s: hashes.map((hash) => hash.md5) })))
      : JSON.stringify(
          names.map((name) => ({
            name,
            hash: hashes.map(({ sha256 }) => ({ sha256 })),
            constraint: ['CLASS', 'NO_SPEED'],
          })),
        );
  files[path] = new TextEncoder().encode(content);
  const body = Buffer.from(zipSync(files));
  await page.route(`**${TRACK_ROUTE}course.zip`, (route) => route.fulfill({ body, contentType: 'application/zip' }));
  const query = options.query ?? path;
  await page.goto(
    `/embed/?track=${encodeURIComponent(`${TRACK_ROUTE}course.zip`)}&course=${encodeURIComponent(query)}${options.name === undefined ? '' : `&courseName=${encodeURIComponent(options.name)}`}`,
  );
}

for (const format of ['lr2', 'beatoraja'] as const) {
  test(`${format} course preview advances through its stages and Replay restarts the course`, async ({ page }) => {
    await openCourseEmbed(page, { format });
    const hud = page.locator('be-music-preview-hud');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(hud.getByRole('heading', { name: 'Fixture A' })).toBeVisible();
    await expect(hud.getByText('Preview course · Stage 1 / 2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(hud.getByRole('heading', { name: 'Fixture B' })).toBeVisible({ timeout: 60_000 });
    await expect(hud.getByText('Preview course · Stage 2 / 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replay', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(hud.getByRole('heading', { name: 'Fixture A' })).toBeVisible();
    await expect(page.locator('be-music-preview-select')).toHaveCount(0);
    await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(hud.getByRole('slider', { name: 'Seek' })).toBeEnabled();
  });
}

test('a course file with several definitions lists courses and returns there after playing', async ({ page }) => {
  await openCourseEmbed(page, { format: 'beatoraja', many: true });
  const list = page.getByRole('list', { name: 'Courses' });
  await expect(list.getByRole('button')).toHaveCount(2, { timeout: 60_000 });
  await expect(list.getByRole('button', { name: /Preview course/ })).toContainText('GRADE · 2 stages');
  await list.getByRole('button', { name: /Preview course/ }).click();
  await expect(page.locator('be-music-preview-hud').getByRole('heading', { name: 'Fixture B' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(list.getByRole('button')).toHaveCount(2, { timeout: 60_000 });
});

test('a named LR2 NONSTOP course uses the stitched chart with seeking and replay', async ({ page }) => {
  await openCourseEmbed(page, { format: 'lr2', many: true, kind: 1, name: 'Other course' });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60_000 });
  const hud = page.locator('be-music-preview-hud');
  await expect(hud.getByRole('heading', { name: 'Other course' })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const seek = hud.getByRole('slider', { name: 'Seek' });
  await expect(seek).toBeEnabled();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThanOrEqual(4);
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toBeEnabled({ timeout: 60_000 });
});

test('missing course files and missing stage charts show an error instead of playing a different chart', async ({
  page,
}) => {
  await openCourseEmbed(page, { format: 'beatoraja', query: 'missing.json' });
  await expect(page.getByText('Course file not found: missing.json', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await openCourseEmbed(page, { format: 'lr2', name: 'Missing course' });
  await expect(page.getByText('Course not found: Missing course', { exact: true })).toBeVisible({ timeout: 60_000 });
  await openCourseEmbed(page, { format: 'lr2', missing: true });
  await expect(page.getByText('Preview course: 1 stage is not in the collection', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await openCourseEmbed(page, { format: 'beatoraja', many: true, missing: true });
  await expect(page.getByRole('list', { name: 'Courses' }).getByRole('button').first()).toBeDisabled({
    timeout: 60_000,
  });
});
