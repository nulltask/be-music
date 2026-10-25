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

for (const skin of ['plain', 'native'] as const) {
  test(`R-RANDOM is selectable and recorded on ${skin}`, async ({ player }) => {
    await openWithLibrary(player, { 'be-music.built-in-skin': skin });
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Random 1P', 'R-RANDOM');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.browseTo(SONGS, 'Fixture A');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.randomLane?.p1).toBe('R-RANDOM');
    expect(replay?.play.options?.random1P).toBe('R-RANDOM');
    await player.leaveResult();
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    expect(await player.readOption(['Play options'], 'Random 1P')).toBe('OFF');
  });
}

for (const skin of ['plain', 'native'] as const) {
  test(`source seeds and previous arrangements work for fresh input on ${skin}`, async ({ player }) => {
    await openWithLibrary(player, { 'be-music.built-in-skin': skin });
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Random 1P', 'RANDOM');
    await player.setOption(['Play options'], 'Seed 1P (-1=random)', '9223372036854775807');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.browseTo(SONGS, 'Fixture A');
    await player.key('Enter');
    await player.waitForResult(0);
    const first = await player.lastReplay();
    expect(first?.play.options?.randomSeed1P).toBe('9223372036854775807');
    await player.leaveResult();
    await player.pressOption(['Play options'], 'Reuse previous arrangement');
    await player.setOption(['Play options'], 'Auto play', false);
    await player.browseTo(SONGS, 'Fixture A');
    await player.key('Enter');
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 0.1, 'fresh manual play');
    await player.key('z');
    await player.waitForResult(1);
    const fresh = await player.lastReplay();
    expect(fresh?.play.mode).toBe('manual');
    expect(fresh?.chart.notes).toEqual(first?.chart.notes);
    expect(fresh?.inputs.length).toBeGreaterThan(0);
    await player.leaveResult();
    await player.pressOption(['Play options'], 'New arrangement');
    expect(
      await player.page.evaluate(
        () => JSON.parse(localStorage.getItem('be-music.debug-menu-settings')!).settings.randomSeed1P,
      ),
    ).toBe('-1');
  });
}

for (const skin of ['plain', 'native'] as const) {
  for (const containsMine of [false, true]) {
    test(`mine REMOVE records actual changes on ${skin} (${containsMine})`, async ({ player }) => {
      await player.open({ 'be-music.built-in-skin': skin });
      await player.dropText(
        'mine-remove.bme',
        `#TITLE Mine remove\n#BPM 240\n${containsMine ? '#001D1:01\n' : ''}#00211:01\n`,
      );
      await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
      await player.setOption(['Play options'], 'Mines (beatoraja)', 'REMOVE');
      await player.setOption(['Play options'], 'Auto play', true);
      await player.cursorTo((bar) => bar.title === 'Mine remove', 'mine modifier chart');
      await player.key('Enter');
      await player.waitForResult(0);
      const replay = await player.lastReplay();
      expect(replay?.play).toMatchObject({ mineModifier: 'REMOVE', mineModifierChangeCount: containsMine ? 1 : 0 });
      expect(replay?.play.options?.mineModifier).toBe('REMOVE');
      expect(replay?.chart.notes.some((note) => note.type === 'mine')).toBe(false);
    });
  }
}

for (const skin of ['plain', 'native'] as const) {
  for (const modifier of ['ADD RANDOM', 'ADD NEAR', 'ADD ALL'] as const) {
    test(`mine ${modifier} records and restores its generated population on ${skin}`, async ({ player }) => {
      await player.open({ 'be-music.built-in-skin': skin });
      await player.dropText('mine-add.bme', `#TITLE Mine addition\n#BPM 240\n#00001:${'01'.repeat(32)}\n#00111:01\n`);
      await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
      await player.setOption(['Play options'], 'Mines (beatoraja)', modifier);
      await player.setOption(['Play options'], 'Auto play', true);
      await player.cursorTo((bar) => bar.title === 'Mine addition', 'mine addition chart');
      await player.key('Enter');
      await player.waitForResult(0);
      const replay = await player.lastReplay();
      expect(replay?.play.mineModifier).toBe(modifier === 'ADD ALL' ? 'ADD_BLANK' : modifier.replace(' ', '_'));
      expect(replay?.play.mineModifierChangeCount).toBeGreaterThan(0);
      const mines = replay?.chart.notes.filter((note) => note.type === 'mine');
      expect(mines?.length).toBe(replay?.play.mineModifierChangeCount);
      expect(mines?.every((note) => note.silent && note.damage === 10)).toBe(true);
      await player.leaveResult();
      await player.pressOption(['Play options'], 'Reuse previous arrangement');
      await player.cursorTo((bar) => bar.title === 'Mine addition', 'same mine addition chart');
      await player.key('Enter');
      await player.waitForResult(1);
      expect((await player.lastReplay())?.chart.notes).toEqual(replay?.chart.notes);
      await player.leaveResult();
      await player.setOption(['Play options'], 'Mines (beatoraja)', 'OFF');
      await player.dropText('mine-add.bmplay.json', JSON.stringify(replay));
      await player.waitFor(
        (state) => state.scene.kind === 'play' && state.play?.replay === true,
        'generated mine replay',
      );
      await player.waitForResult(2);
    });
  }
}

for (const skin of ['plain', 'native'] as const) {
  test(`CONTINUE keeps judging after HAZARD death and restores the policy on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('continue.bme', '#TITLE Continue gauge\n#BPM 240\n#00111:01\n#00212:01\n');
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Gauge', 'DEATH');
    await player.setOption(['Play options'], 'Gauge auto-shift (beatoraja)', 'CONTINUE');
    await player.cursorTo((bar) => bar.title === 'Continue gauge', 'continue chart');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.gaugeAutoShift).toBe('CONTINUE');
    expect(replay?.play.options?.gaugeAutoShift).toBe('CONTINUE');
    expect(replay?.play.endOnFailure).not.toBe(true);
    expect(replay?.results?.native?.judge.poor).toBe(2);
    expect(replay?.results?.native?.gauge).toMatchObject({
      type: 'HAZARD',
      final: 0,
      cleared: false,
      failedMidPlay: true,
    });
    await player.leaveResult();
    await player.setOption(['Play options'], 'Gauge auto-shift (beatoraja)', 'NONE');
    await player.dropText('continue.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'CONTINUE replay');
    await player.waitForResult(1);
  });
}

for (const skin of ['plain', 'native'] as const) {
  test(`measured FLOATING HI-SPEED couples cover edits and records mode switches on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('floating.bme', '#TITLE Floating speed\n#BPM 120\n#00103:F0\n#00411:01\n');
    await player.setOption(['Developer'], 'Judgment windows', '????');
    await player.setOption(['Play options'], 'FLOATING HI-SPEED (AC 32 measured)', true);
    await player.setOption(['Play options'], 'Floating speed', 2.25);
    await player.setOption(['Play options'], 'Effect 1P', 'SUDDEN');
    await player.setOption(['Play options'], 'Lane cover', true);
    await player.setOption(['Play options'], 'Cover height', 0.25);
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'Floating speed', 'floating speed chart');
    await player.key('Enter');
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 0.1, 'floating play');
    await player.key('ArrowUp');
    await player.waitFor((state) => state.play?.hiSpeed === 2.75, 'source half-step');
    await player.key('PageDown');
    await player.waitFor((state) => (state.play?.hiSpeed ?? 0) < 2.25, 'cover-coupled source speed');
    await player.key('Numpad0');
    await player.key('Numpad0');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.options?.floatingHiSpeed).toBe(true);
    expect(replay?.play.options?.floatingHiSpeedProfile).toBe('AC32-measured');
    expect(replay?.play.optionChanges?.some((change) => change.values.floatingHiSpeed === false)).toBe(true);
    expect(replay?.play.optionChanges?.some((change) => change.values.floatingHiSpeed === true)).toBe(true);
    expect(replay?.play.viewChanges?.some((change) => change.covers !== undefined)).toBe(true);
    await player.leaveResult();
    await player.setOption(['Play options'], 'FLOATING HI-SPEED (AC 32 measured)', false);
    await player.dropText('floating.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'floating replay');
    await player.waitForResult(1);
  });
}

for (const skin of ['plain', 'native'] as const) {
  test(`fixed display area ignores cover keys and restores floating time on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('fixed-area.bme', '#TITLE Fixed display area\n#BPM 120\n#00103:F0\n#00411:01\n');
    await player.setOption(['Developer'], 'Judgment windows', '????');
    await player.setOption(['Play options'], 'FLOATING HI-SPEED (AC 32 measured)', true);
    await player.setOption(['Play options'], 'Floating speed', 2);
    await player.setOption(['Play options'], 'Fixed display area (AC 34)', true);
    await player.setOption(['Play options'], 'Effect 1P', 'SUDDEN');
    await player.setOption(['Play options'], 'Lane cover', true);
    await player.setOption(['Play options'], 'Cover height', 0.25);
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'Fixed display area', 'fixed area chart');
    await player.key('Enter');
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 2.1, 'BPM change');
    await player.key('PageDown');
    await player.key('End');
    await player.key('ArrowUp');
    await player.waitFor((state) => state.play?.hiSpeed === 2.5, 'speed remains adjustable');
    await player.key('Enter');
    await player.key('Enter');
    await player.waitFor((state) => state.play?.hiSpeed === 1, 'initial time restored without moving covers');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.options?.fixedDisplayArea).toBe(true);
    const initialCovers = replay?.play.view?.covers;
    expect(
      replay?.play.viewChanges?.every(
        (change) => change.covers === undefined || JSON.stringify(change.covers) === JSON.stringify(initialCovers),
      ),
    ).toBe(true);
    await player.leaveResult();
    await player.setOption(['Play options'], 'Fixed display area (AC 34)', false);
    await player.dropText('fixed-area.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'fixed-area replay');
    await player.waitForResult(1);
  });
}

for (const skin of ['plain', 'native'] as const) {
  for (const [longNoteModifier, lnMode] of [
    ['ADD_LN', 1],
    ['ADD_CN', 2],
    ['ADD_HCN', 3],
    ['ADD_ALL', 0],
  ] as const) {
    test(`${longNoteModifier} generates and reopens recorded long notes on ${skin}`, async ({ player }) => {
      await player.open({ 'be-music.built-in-skin': skin });
      await player.dropText('add-ln.bme', '#TITLE Add long notes\n#BPM 240\n#00111:01\n#00101:0001\n#00212:01\n');
      await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
      await player.setOption(['Play options'], 'Long notes', `${longNoteModifier.replaceAll('_', ' ')} (beatoraja)`);
      await player.setOption(['Play options'], 'Long-note add rate (beatoraja)', 1);
      await player.setOption(['Play options'], 'Auto play', true);
      await player.cursorTo((bar) => bar.title === 'Add long notes', 'long-note addition chart');
      await player.key('Enter');
      await player.waitForResult(0);
      const replay = await player.lastReplay();
      expect(replay?.play).toMatchObject({ longNoteModifier, longNoteRate: 1, longNoteModifierChangeCount: 1 });
      expect(replay?.chart.notes.filter((note) => note.generatedLongNote)).toEqual([
        expect.objectContaining({
          type: 'long',
          lnMode: lnMode || expect.any(Number),
          timeUs: 1_000_000,
          endTimeUs: 1_500_000,
        }),
      ]);
      await player.leaveResult();
      await player.setOption(['Play options'], 'Long notes', 'OFF');
      await player.dropText('add-ln.bmplay.json', JSON.stringify(replay));
      await player.waitFor(
        (state) => state.scene.kind === 'play' && state.play?.replay === true,
        'generated-LN replay',
      );
      await player.waitForResult(1);
    });
  }
}

for (const skin of ['plain', 'native'] as const) {
  test(`beatoraja automatic display timing is recorded and replayed on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('auto-timing.bms', '#TITLE Auto timing\n#BPM 120\n#RANK 3\n#00111:01\n#00311:01\n');
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Auto judge timing (beatoraja)', true);
    await player.setOption(['Play options'], 'Judge timing (beatoraja, ms)', 100);
    await player.cursorTo((bar) => bar.title === 'Auto timing', 'calibration chart');
    await player.key('Enter');
    await player.waitFor((state) => (state.play?.seconds ?? 0) >= 2.04, 'a late manual key press');
    await player.key('z');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.options).toMatchObject({ judgeTimingAutoAdjust: true, judgeTimingMs: 100 });
    expect(
      replay?.play.optionChanges?.some(
        (change) => typeof change.values.judgeTimingMs === 'number' && change.values.judgeTimingMs > 100,
      ),
    ).toBe(true);
    await player.leaveResult();
    await player.dropText('auto-timing.bmplay.json', JSON.stringify(replay));
    await player.waitForResult(1);
    // Playback consumes the recorded timeline; it must not run the calibration algorithm again.
    expect((await player.state()).results[1]?.judged).toEqual((await player.state()).results[0]?.judged);
  });
}

for (const skin of ['plain', 'native'] as const) {
  test(`SURVIVAL TO GROOVE switches to the parallel NORMAL gauge on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('survival-to-groove.bms', '#TITLE Survival to groove\n#BPM 240\n#00111:01\n#00212:01\n');
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Gauge', 'DEATH');
    await player.setOption(['Play options'], 'Gauge auto-shift (beatoraja)', 'SURVIVAL TO GROOVE');
    await player.cursorTo((bar) => bar.title === 'Survival to groove', 'survival chart');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.gauge).toBe('DEATH');
    expect(replay?.play.gaugeAutoShift).toBe('SURVIVAL_TO_GROOVE');
    expect(replay?.play.options?.gaugeAutoShift).toBe('SURVIVAL_TO_GROOVE');
    expect(replay?.results?.native?.judge.poor).toBe(2);
    expect(replay?.results?.native?.gauge).toMatchObject({ type: 'NORMAL', cleared: false });
    expect(replay?.results?.native?.gauge.failedMidPlay).not.toBe(true);
    await player.leaveResult();
    await player.dropText('survival-to-groove.bmplay.json', JSON.stringify(replay));
    await player.waitForResult(1);
    const results = (await player.state()).results;
    expect(results[1]?.judged).toEqual(results[0]?.judged);
  });
}

for (const [label, policy, effective] of [
  ['BEST CLEAR', 'BEST_CLEAR', 'EX-HARD'],
  ['SELECT TO UNDER', 'SELECT_TO_UNDER', 'EASY'],
] as const) {
  for (const skin of ['plain', 'native'] as const) {
    test(`${label} selects and replays a parallel gauge on ${skin}`, async ({ player }) => {
      await player.open({ 'be-music.built-in-skin': skin });
      await player.dropText('gauge-selection.bms', '#TITLE Gauge selection\n#BPM 240\n#00111:01\n#00212:01\n');
      await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
      await player.setOption(['Play options'], 'Gauge', 'GROOVE');
      await player.setOption(['Play options'], 'Gauge auto-shift (beatoraja)', label);
      await player.setOption(['Play options'], 'Lowest auto-shift gauge', 'EASY');
      await player.cursorTo((bar) => bar.title === 'Gauge selection', 'gauge selection chart');
      await player.key('Enter');
      await player.waitForResult(0);
      const replay = await player.lastReplay();
      expect(replay?.play.gaugeAutoShift).toBe(policy);
      expect(replay?.play.bottomShiftableGauge).toBe('EASY');
      expect(Object.keys(replay?.results?.native?.gauge.values ?? {})).toHaveLength(6);
      expect(replay?.results?.native?.gauge.type).toBe(effective);
      await player.leaveResult();
      await player.dropText('gauge-selection.bmplay.json', JSON.stringify(replay));
      await player.waitForResult(1);
      const results = (await player.state()).results;
      expect(results[1]?.judged).toEqual(results[0]?.judged);
    });
  }
}

for (const skin of ['plain', 'native'] as const) {
  test(`LR2 CONSTANT preserves STOP and replay geometry on ${skin}`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText(
      'lr2-constant.bme',
      '#TITLE LR2 constant\n#BPM 120\n#BPM01 240\n#STOP01 192\n#LNOBJ AA\n#00012:0001\n#00108:01\n#00109:01\n#00212:AA\n#00311:01\n',
    );
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    await player.setOption(['Play options'], 'HS-FIX', 'CONSTANT');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'LR2 constant', 'constant chart');
    await player.key('Enter');
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 2.2, 'the STOP window');
    await player.key('Space');
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`constant-stop-${skin}.png`) });
    await player.key('Space');
    await player.waitFor((state) => (state.play?.seconds ?? 0) > 3.4, 'the faster BPM after STOP');
    await player.key('ArrowUp');
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`constant-after-stop-${skin}.png`) });
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.view?.hsFix).toBe('CONSTANT');
    expect(replay?.play.options?.hsFix).toBe('CONSTANT');
    expect(replay?.play.optionChanges?.some((change) => change.values.hiSpeed === 2.1)).toBe(true);
    await player.leaveResult();
    await player.setOption(['Play options'], 'HS-FIX', 'OFF');
    await player.dropText('lr2-constant.bmplay.json', JSON.stringify(replay));
    await player.waitForResult(1);
    const results = (await player.state()).results;
    expect(results[1]?.judged).toEqual(results[0]?.judged);
  });
}

for (const skin of ['plain', 'native'] as const) {
  for (const mode of ['SCATTER', 'SCATTER-CORRECTED'] as const) {
    test(`${mode} is separately selectable and replayable on ${skin}`, async ({ player }) => {
      await player.open({ 'be-music.built-in-skin': skin });
      await player.dropText('scatter.pms', '#TITLE SCATTER PMS\n#BPM 240\n#00111:01\n#00222:01\n#00325:01\n');
      await player.setOption(['Developer'], 'Judgment windows', 'LR2');
      await player.setOption(
        ['Play options'],
        'Random 1P',
        mode === 'SCATTER' ? 'SCATTER (LR2 beta3)' : 'SCATTER (9KEY corrected)',
      );
      await player.cursorTo((bar) => bar.title === 'SCATTER PMS', 'PMS chart');
      await player.key('Enter');
      await player.waitForResult(0);
      const replay = await player.lastReplay();
      expect(replay?.play.options?.random1P).toBe(mode);
      const channels = replay!.chart.notes.filter((note) => note.type !== 'mine').map((note) => note.channel);
      expect(channels).toHaveLength(3);
      if (mode === 'SCATTER-CORRECTED')
        expect(
          channels.every((channel) => ['11', '12', '13', '14', '15', '22', '23', '24', '25'].includes(channel)),
        ).toBe(true);
      await player.leaveResult();
      await player.setOption(['Play options'], 'Random 1P', 'OFF');
      await player.dropText('scatter.bmplay.json', JSON.stringify(replay));
      await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'SCATTER replay');
      await player.waitForResult(1);
    });
  }
}

for (const skin of ['plain', 'native'] as const) {
  test(`scroll REMOVE preserves note times and records its effect on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText(
      'scroll.bms',
      '#TITLE Scroll REMOVE\n#BPM 240\n#BPM01 480\n#STOP01 192\n#00111:01\n#00108:01\n#00209:01\n#00312:01',
    );
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Scroll (beatoraja)', 'REMOVE');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'Scroll REMOVE', 'scroll chart');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.scrollModifier).toBe('REMOVE');
    expect(replay?.play.scrollModifierChanged).toBe(true);
    expect(replay?.play.options?.scrollModifier).toBe('REMOVE');
    expect(replay?.chart.notes.map((note) => note.timeUs)).toEqual([1000000, 2500000]);
    await player.leaveResult();
    await player.setOption(['Play options'], 'Scroll (beatoraja)', 'OFF');
    await player.dropText('scroll.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'scroll REMOVE replay');
    await player.waitForResult(1);
  });
}
