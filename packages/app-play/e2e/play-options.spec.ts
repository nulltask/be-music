import { expect, openWithLibrary, SONGS, test } from './support.ts';

test('START BPM is selectable in Debug Menu, remembered and recorded in a play', async ({ player }) => {
  await openWithLibrary(player);
  await player.setOption(['Play options'], 'HS-FIX', 'STARTBPM');
  expect(await player.readOption(['Play options'], 'HS-FIX')).toBe('STARTBPM');
  expect(
    await player.page.evaluate(() => JSON.parse(localStorage.getItem('be-music.debug-menu-settings')!).settings.hsFix),
  ).toBe('STARTBPM');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  await player.waitFor((state) => (state.play?.seconds ?? 0) > 0.2, 'the chart to start');
  await player.key('ArrowUp');
  await player.waitForResult(0);
  const replay = await player.lastReplay();
  expect(replay?.play.view?.hsFix).toBe('STARTBPM');
  expect(replay?.play.options?.hsFix).toBe('STARTBPM');
  expect(replay?.play.options?.displayAreaInfo).toBe('OFF');
  expect(replay?.play.optionChanges?.some((change) => change.values.hiSpeed === 2.1)).toBe(true);
  await player.page.reload();
  await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
  expect(await player.readOption(['Play options'], 'HS-FIX')).toBe('STARTBPM');
});

for (const skin of ['native', 'plain', 'lr2', 'beatoraja'] as const) {
  test(`persistent display-area information renders on ${skin}`, async ({ player }, info) => {
    await openWithLibrary(player, { 'be-music.built-in-skin': skin === 'native' ? 'native' : 'plain' });
    if (skin === 'lr2' || skin === 'beatoraja') {
      await player.drop(`skins/${skin}`);
      await player.waitFor((state) => state.scene.kind === 'select' && state.scene.family === skin, `${skin} select`);
    }
    await player.setOption(['Play options'], 'Display area info', 'ON');
    await player.setOption(['Play options'], 'Effect 1P', 'SUDDEN');
    await player.setOption(['Play options'], 'Lane cover', true);
    await player.setOption(['Play options'], 'Cover height', 0.25);
    await player.setOption(['Play options'], 'Auto play', true);
    await player.browseTo(SONGS, 'Fixture A');
    await player.key('Enter');
    await player.waitFor(
      (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.1,
      'the chart to start',
    );
    await player.key('Space');
    await player.page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    if (skin === 'native') {
      const readout = player.page.locator('[data-display-area-info] [data-side="1P"][data-edge="sudden"]');
      await expect(readout).toBeVisible();
      await expect(readout).toContainText('SUD-LENGTH 250');
    }
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`display-area-${skin}.png`) });
  });
}

test('DP AUTO SCRATCH keeps the other side manual and records the side mask', async ({ player }) => {
  await player.open();
  await player.dropText('dp-scratches.bme', '#PLAYER 3\n#TITLE DP scratch sides\n#BPM 240\n#00116:01\n#00126:01\n');
  await player.setOption(['Play options'], 'Auto scratch 1P', true);
  await player.setOption(['Play options'], 'Auto scratch 2P', false);
  await player.cursorTo((bar) => bar.title === 'DP scratch sides', 'DP scratch chart');
  await player.key('Enter');
  const result = await player.waitForResult(0);
  expect(result.results[0]?.judged).toMatchObject({ pgreat: 1, poor: 1 });
  const replay = await player.lastReplay();
  expect(replay?.play).toMatchObject({ autoScratch: true, autoScratch1P: true, autoScratch2P: false });
  expect(replay?.play.options).toMatchObject({ autoScratch1P: true, autoScratch2P: false });
});

for (const modifier of ['LEGACY NOTE (AC 34)', 'LN REMOVE (beatoraja)'] as const) {
  test(`${modifier} records head-only notes and reopens its replay`, async ({ player }) => {
    await player.open();
    await player.dropText('charge-note.bme', '#TITLE Charge note modifier\n#BPM 240\n#LNMODE 2\n#00151:0101\n');
    await player.setOption(['Play options'], 'Long notes', modifier);
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'Charge note modifier', 'charge-note chart');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.longNoteModifier).toBe(modifier.startsWith('LEGACY') ? 'LEGACY' : 'REMOVE');
    expect(replay?.chart.notes).toEqual([expect.objectContaining({ type: 'normal' })]);
    expect(replay?.chart.notes[0]?.endTimeUs).toBeUndefined();
    await player.leaveResult();
    await player.waitFor((state) => state.scene.kind === 'select', 'select');
    await player.setOption(['Play options'], 'Long notes', 'OFF');
    await player.dropText('charge-note.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'head-only replay');
    await player.waitForResult(1);
  });
}

test('A-SCR & LEGACY NOTE applies and records both operations together', async ({ player }) => {
  await player.open();
  await player.dropText('combined-assist.bme', '#TITLE Combined assist\n#BPM 240\n#LNMODE 2\n#00156:0101\n');
  await player.pressOption(['Play options'], 'A-SCR & LEGACY NOTE (AC 34)');
  expect(await player.readOption(['Play options'], 'Auto scratch 1P')).toBe(true);
  expect(await player.readOption(['Play options'], 'Long notes')).toBe('LEGACY NOTE (AC 34)');
  await player.cursorTo((bar) => bar.title === 'Combined assist', 'combined assist chart');
  await player.key('Enter');
  const result = await player.waitForResult(0);
  expect(result.results[0]?.judged).toMatchObject({ pgreat: 1, poor: 0 });
  const replay = await player.lastReplay();
  expect(replay?.play).toMatchObject({ longNoteModifier: 'LEGACY', autoScratch1P: true, autoScratch2P: true });
  expect(replay?.chart.notes[0]?.type).toBe('normal');
});

for (const ruleset of ['beatoraja', '????'] as const) {
  test(`EX-HARD is an independent recorded gauge with ${ruleset} rules`, async ({ player }) => {
    await player.open();
    await player.dropText('ex-hard.bme', '#TITLE EX-HARD gauge\n#BPM 240\n#00111:01\n');
    await player.setOption(['Developer'], 'Judgment windows', ruleset);
    await player.setOption(['Play options'], 'Gauge', 'EX-HARD');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'EX-HARD gauge', 'EX-HARD chart');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.gauge).toBe('EX-HARD');
    expect(replay?.results?.native?.gauge.type).toBe('EX-HARD');
    await player.leaveResult();
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    expect(await player.readOption(['Play options'], 'Gauge')).toBe('GROOVE');
  });
}

for (const [ruleset, label, effectiveGauge] of [
  ['beatoraja', 'ASSIST EASY', 'ASSIST-EASY'],
  ['????', 'ASSISTED EASY', 'ASSISTED-EASY'],
] as const) {
  test(`${label} records its source gauge independently of input assists`, async ({ player }) => {
    await player.open();
    await player.dropText('assist-easy.bme', '#TITLE Assist easy gauge\n#BPM 240\n#00111:01\n');
    await player.setOption(['Developer'], 'Judgment windows', ruleset);
    await player.setOption(['Play options'], 'Gauge', label);
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'Assist easy gauge', 'ASSIST EASY chart');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play).toMatchObject({ gauge: 'ASSIST-EASY', autoScratch: false });
    expect(replay?.results?.native?.gauge.type).toBe(effectiveGauge);
    expect(replay?.play.options?.longNoteModifier).toBe('OFF');
  });
}
