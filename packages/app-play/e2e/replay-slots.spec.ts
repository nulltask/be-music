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
  await expect(player.page.locator('.replay-slots-card')).toBeHidden();
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
