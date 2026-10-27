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

test('draws a RANDOM MIX from its bar, plays it and keeps it as the folder newest course', async ({ player }) => {
  test.setTimeout(360_000);
  await openWithLibrary(player);
  await player.openFolder('MY COURSES');
  await player.cursorTo((bar) => bar.course?.randomMix === true, 'the RANDOM MIX bar');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.key('Enter');
  const play = await player.waitFor((s) => s.scene.kind === 'play', 'the drawn RANDOM MIX');
  expect(play.play?.course?.name).toBe('RANDOM MIX');
  const stageCount = play.play?.course?.stageCount ?? 0;
  expect(stageCount).toBeGreaterThan(0);
  // The last stage's result, then the course result.
  await player.waitForResult(0, 300_000);
  await player.leaveResult();
  await player.waitFor((s) => s.scene.kind === 'result' && s.results.at(-1)?.course !== undefined, 'the course result');
  await player.leaveResult();
  const select = await player.waitFor((s) => s.scene.kind === 'select', 'the kept RANDOM MIX');
  expect(select.cursor?.bar?.title).toBe('RANDOM MIX');
  expect(select.cursor?.bar?.course).toMatchObject({ kind: 'expert', randomMix: false, playable: true });
  expect(select.cursor?.bar?.course?.stages).toHaveLength(stageCount);
});
