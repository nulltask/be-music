import { expect, openWithLibrary, test } from './support.ts';

test('keeps a successful random course draw and replays its fixed stages', async ({ player }) => {
  await openWithLibrary(player);
  await player.dropText(
    'folder/default.json',
    JSON.stringify([{ name: 'Draws', rcourse: [{ name: 'Random A', stage: [{ sql: "title = 'Fixture A'" }] }] }]),
  );
  await player.openFolder('Draws');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.key('Enter');
  const play = await player.waitFor((s) => s.scene.kind === 'play', 'the drawn course');
  const name = play.play?.course?.name;
  expect(name).toMatch(/^Random A \d{8}_\d{6}$/);
  await player.waitForResult(0);
  await player.leaveResult();
  await player.waitFor((s) => s.scene.kind === 'result' && s.results.at(-1)?.course !== undefined, 'the course result');
  await player.leaveResult();
  const select = await player.waitFor((s) => s.scene.kind === 'select', 'the retained course bar');
  expect(select.cursor?.bar?.title).toBe(name);
  expect(select.cursor?.bar?.course?.random).toBeFalsy();
  await player.key('Enter');
  const replayed = await player.waitFor((s) => s.scene.kind === 'play', 'the fixed draw to play again');
  expect(replayed.play?.title).toBe('Fixture A');
  expect(replayed.play?.course?.name).toBe(name);
});
