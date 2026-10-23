import { expect, openWithLibrary, test } from './support.ts';

test('keeps a successful random course draw and replays its fixed stages', async ({ demo }) => {
  await openWithLibrary(demo);
  await demo.dropText(
    'folder/default.json',
    JSON.stringify([{ name: 'Draws', rcourse: [{ name: 'Random A', stage: [{ sql: "title = 'Fixture A'" }] }] }]),
  );
  await demo.openFolder('Draws');
  await demo.setOption(['Play options'], 'Auto play', true);
  await demo.key('Enter');
  const play = await demo.waitFor((s) => s.scene.kind === 'play', 'the drawn course');
  const name = play.play?.course?.name;
  expect(name).toMatch(/^Random A \d{8}_\d{6}$/);
  await demo.waitForResult(0);
  await demo.leaveResult();
  await demo.waitFor((s) => s.scene.kind === 'result' && s.results.at(-1)?.course !== undefined, 'the course result');
  await demo.leaveResult();
  const select = await demo.waitFor((s) => s.scene.kind === 'select', 'the retained course bar');
  expect(select.cursor?.bar?.title).toBe(name);
  expect(select.cursor?.bar?.course?.random).toBeFalsy();
  await demo.key('Enter');
  const replayed = await demo.waitFor((s) => s.scene.kind === 'play', 'the fixed draw to play again');
  expect(replayed.play?.title).toBe('Fixture A');
  expect(replayed.play?.course?.name).toBe(name);
});
