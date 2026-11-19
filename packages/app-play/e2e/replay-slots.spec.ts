import { expect, openWithLibrary, SONGS, test, type Player } from './support.ts';

/**
 * The replay slots: a live play saved into a slot on its result screen, then replayed from the select screen. The
 * built-in skin has no replay-slot UI of its own, so the card stands in for it; a beatoraja skin takes beatoraja's keys
 * (1-4 on the result, V on the select screen).
 */

/** Plays Fixture A by hand without pressing a key (its record counts), and waits for its result. */
async function playFixtureA(player: Player): Promise<void> {
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  await player.waitForResult(await player.resultCount(), 180_000);
}

/** Presses `code` on the result screen until the status line says the play was saved (input opens after a delay). */
async function saveOnResult(player: Player, code: string, slot: number): Promise<void> {
  const saved = `Saved the replay to replay slot ${slot}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await player.key(code);
    const state = await player
      .waitFor((current) => current.statusLog.includes(saved), 'the save', 500)
      .catch((): undefined => undefined);
    if (state !== undefined) return;
  }
  throw new Error(`the play was not saved to slot ${slot}`);
}

test('a play saved to a slot on the built-in result replays from the card on the select screen', async ({ player }) => {
  await openWithLibrary(player);
  await playFixtureA(player);
  const card = player.page.locator('.replay-slots-card');
  await expect(card).toHaveAttribute('data-mode', 'result');
  await expect(card.locator('be-music-collapsible-panel').locator('details')).toHaveAttribute('open', '');
  // The default rules: a first play (failed, with no key pressed) updates the lamp and the BP (slots 2 and 3), and
  // slot 4 keeps every play; slot 1 waits for a better EX score.
  for (const slot of ['2', '3', '4']) await expect(card.locator(`button[data-slot="${slot}"]`)).toHaveText('Saved');
  await expect(card.locator('button[data-slot="1"]')).toHaveText('Save');
  await saveOnResult(player, 'Digit1', 1);
  await expect(card.locator('button[data-slot="1"]')).toHaveText('Saved');
  // A slot takes one save per result.
  await expect(card.locator('button[data-slot="1"]')).toBeDisabled();

  await player.leaveResult();
  await player.waitFor((state) => state.scene.kind === 'select', 'the select screen');
  await expect(card).toHaveAttribute('data-mode', 'select');
  await expect(card.locator('.replay-slots-row')).toHaveCount(4);
  await card.getByText('Replay slots and history', { exact: true }).click();
  await card.locator('button[data-slot="2"]').click();
  const state = await player.waitFor(
    (current) => current.scene.kind === 'play' && current.play?.replay === true,
    'the replay to start',
  );
  // The route names the slot, then the play screen its own replay line.
  expect(state.statusLog).toContain('Replaying slot 2: Fixture A');
  expect(state.status).toMatch(/^Replaying.*: Fixture A$/);
  await expect(card).toBeHidden();
  await player.key('Escape');
  await player.waitFor((current) => current.scene.kind === 'select', 'the select screen');

  await card.getByText('Replay slots and history', { exact: true }).click();
  const disclosure = card.locator('.replay-history');
  const summary = disclosure.locator('summary');
  const chevron = () => summary.evaluate((element) => getComputedStyle(element, '::before').transform);
  await expect(disclosure).not.toHaveAttribute('open');
  const closedChevron = await chevron();
  expect(closedChevron).not.toBe('none');
  await summary.click();
  await expect(disclosure).toHaveAttribute('open', '');
  expect(await chevron()).not.toBe(closedChevron);
  const history = card.locator('.replay-history-list');
  await expect(history.locator('li')).toHaveCount(1);
  await expect(history.locator('li')).toContainText('Fixture A');
  const downloading = player.page.waitForEvent('download');
  await history.getByRole('button', { name: 'Download' }).click();
  expect((await downloading).suggestedFilename()).toMatch(/^Fixture_A-\d+\.bmplay\.json$/);
  await history.getByRole('button', { name: 'Replay', exact: true }).click();
  await player.waitFor(
    (current) => current.scene.kind === 'play' && current.play?.replay === true,
    'the history replay to start',
  );
});

test('a beatoraja skin saves into a slot on 1-4 and replays the slot picked on V', async ({ player }) => {
  await openWithLibrary(player);
  await player.drop('skins/beatoraja');
  await player.waitFor(
    (state) => state.scene.kind === 'select' && state.scene.family === 'beatoraja',
    'the beatoraja select',
  );
  await playFixtureA(player);
  expect((await player.state()).scene.family).toBe('beatoraja');
  // The skin draws its own slots: no card.
  await expect(player.page.locator('.replay-slots-card')).toBeHidden();
  await saveOnResult(player, 'Digit1', 1);
  await player.leaveResult();
  await player.waitFor((state) => state.scene.kind === 'select', 'the select screen');
  await expect(player.page.locator('.replay-slots-card')).toContainText('Replay history');
  // The cursor is back on Fixture A, whose first slot holding a replay (slot 1) is picked.
  await player.key('KeyV');
  const state = await player.waitFor(
    (current) => current.scene.kind === 'play' && current.play?.replay === true,
    'the replay to start',
  );
  // The route names the slot, then the play screen its own replay line.
  expect(state.statusLog).toContain('Replaying slot 1: Fixture A');
  expect(state.status).toMatch(/^Replaying.*: Fixture A$/);
});

test('legacy slots migrate into the scrollable history and keep their replay data', async ({ player }) => {
  await openWithLibrary(player);
  const page = player.page;
  await page.evaluate(async () => {
    const body = new Blob(['{"format":"be-music-replay"}']);
    const data = await new Response(body.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('be-music-replays', 2);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const write = db.transaction(['meta', 'replaySlots', 'replaySlotData'], 'readwrite');
        write.oncomplete = () => {
          db.close();
          resolve();
        };
        write.onabort = () => {
          db.close();
          reject(write.error);
        };
        write.objectStore('meta').put(0, 'revision');
        for (let index = 0; index < 12; index++) {
          const target = { kind: 'chart', id: `bmfp0:fixture-${index}` };
          const key = `chart:${target.id}#0`;
          write.objectStore('replaySlots').put(
            {
              version: 0,
              key,
              target,
              slot: 0,
              title: `Legacy ${index}`,
              savedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
              size: data.size,
              exScore: 10,
              exRate: 0.5,
              lamp: 'NORMAL',
            },
            key,
          );
          write.objectStore('replaySlotData').put(data, key);
        }
      };
    });
  });

  await page.reload();
  await player.waitFor((state) => state.scene.kind === 'select', 'the select screen after migration');
  const card = page.locator('.replay-slots-card');
  await card.getByText('Replay slots and history', { exact: true }).click();
  await card
    .locator('summary')
    .filter({ hasText: /^Replay history$/ })
    .click();
  const history = card.locator('.replay-history-list');
  const scope = card.getByRole('checkbox', { name: 'Show all charts and courses' });
  await expect(scope).toBeChecked();
  await expect(history.locator('li')).toHaveCount(12);
  await expect(history.locator('li').first()).toContainText('Legacy 11');
  await expect(history.locator('li').last()).toContainText('Legacy 0');
  await history.locator('li').last().scrollIntoViewIfNeeded();
  expect(await history.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  const downloading = page.waitForEvent('download');
  await history.locator('li').last().getByRole('button', { name: 'Download' }).click();
  expect((await downloading).suggestedFilename()).toMatch(/^Legacy_0-\d+\.bmplay\.json$/);
});
