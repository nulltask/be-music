import { createHash } from 'node:crypto';
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
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
    // R-RANDOM is offered under every ruleset (#774), so LR2 rules keep the choice.
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    expect(await player.readOption(['Play options'], 'Random 1P')).toBe('R-RANDOM');
  });
}

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`source-specific options play and record under other judge rules on ${skin}`, async ({ player }) => {
    await openWithLibrary(player, { 'be-music.built-in-skin': skin });
    // beatoraja's SPIRAL and scroll REMOVE under LR2 rules: options that only transform the chart or the view (#774).
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    await player.setOption(['Play options'], 'Random 1P', 'SPIRAL');
    await player.setOption(['Play options'], 'Scroll (beatoraja)', 'REMOVE');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.browseTo(SONGS, 'Fixture A');
    await player.key('Enter');
    const state = await player.waitForResult(0);
    expect(state.results[0]?.judged).toMatchObject({ great: 0, good: 0, bad: 0, poor: 0 });
    const replay = await player.lastReplay();
    expect(replay?.play).toMatchObject({ judgeRuleset: 'lr2', randomLane: { p1: 'SPIRAL' }, scrollModifier: 'REMOVE' });
    await player.leaveResult();
    // Switching rules keeps both choices.
    await player.setOption(['Developer'], 'Judgment windows', '????');
    expect(await player.readOption(['Play options'], 'Random 1P')).toBe('SPIRAL');
    expect(await player.readOption(['Play options'], 'Scroll (beatoraja)')).toBe('REMOVE');
  });
}

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
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
    await player.key('KeyZ');
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`CONTINUE keeps judging after HAZARD death and restores the policy on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('continue.bme', '#TITLE Continue gauge\n#BPM 240\n#00111:01\n#00212:01\n');
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Gauge', 'HAZARD');
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`measured FLOATING HI-SPEED couples cover edits and records mode switches on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('floating.bme', '#TITLE Floating speed\n#BPM 120\n#00103:F0\n#00811:01\n');
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

// Option semantics, not skin drawing: Synesthesia's software rendering on CI misses the timing these need (#792).
for (const skin of ['plain', 'native'] as const) {
  test(`fixed display area ignores cover keys and restores floating time on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('fixed-area.bme', '#TITLE Fixed display area\n#BPM 120\n#00103:F0\n#00811:01\n');
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
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

// Option semantics, not skin drawing: Synesthesia's software rendering on CI misses the timing these need (#792).
for (const skin of ['plain', 'native'] as const) {
  test(`beatoraja automatic display timing is recorded and replayed on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('auto-timing.bms', '#TITLE Auto timing\n#BPM 120\n#RANK 3\n#00111:01\n#00311:01\n');
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Auto judge timing', 'beatoraja');
    await player.setOption(['Play options'], 'Judge timing (ms)', 100);
    await player.cursorTo((bar) => bar.title === 'Auto timing', 'calibration chart');
    await player.key('Enter');
    // The note is at 2 s. Watch the clock in the page and press on the first frame past 2.03 s, so the press is late
    // but within GOOD however busy the test runner is (a poll from the runner can land well past the window).
    await player.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const step = (): void => {
            if ((window.__beMusicTest?.state().play?.seconds ?? 0) < 2.03) {
              requestAnimationFrame(step);
              return;
            }
            for (const type of ['keydown', 'keyup'])
              window.dispatchEvent(
                new KeyboardEvent(type, { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true }),
              );
            resolve();
          };
          step();
        }),
    );
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.options).toMatchObject({ judgeTimingAutoAdjust: 'BEATORAJA', judgeTimingMs: 100 });
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

test('LR2 automatic judge timing steps 1 ms after ten late hits, is recorded and is kept', async ({ player }) => {
  await player.open();
  // Twelve notes, half a second apart from 2 s.
  await player.dropText(
    'lr2-auto-timing.bms',
    '#TITLE LR2 auto timing\n#BPM 120\n#RANK 3\n#00111:01010101\n#00211:01010101\n#00311:01010101\n',
  );
  await player.setOption(['Developer'], 'Judgment windows', 'LR2');
  await player.setOption(['Play options'], 'Auto judge timing', 'LR2 ON');
  await player.setOption(['Play options'], 'Judge timing (ms)', 100);
  expect(
    await player.page.evaluate(
      () => JSON.parse(localStorage.getItem('be-music.debug-menu-settings')!).settings.judgeTimingAutoAdjust,
    ),
  ).toBe('LR2-ON');
  await player.cursorTo((bar) => bar.title === 'LR2 auto timing', 'LR2 auto-timing chart');
  await player.key('Enter');
  // Press every note on the first frame 20 ms or more past it, so each hit is late however busy the runner is.
  await player.page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let next = 0;
        const step = (): void => {
          if ((window.__beMusicTest?.state().play?.seconds ?? 0) >= 2.02 + next * 0.5) {
            for (const type of ['keydown', 'keyup'])
              window.dispatchEvent(
                new KeyboardEvent(type, { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true }),
              );
            next += 1;
          }
          if (next < 12) requestAnimationFrame(step);
          else resolve();
        };
        step();
      }),
  );
  await player.waitForResult(0);
  const replay = await player.lastReplay();
  expect(replay?.play.options).toMatchObject({ judgeTimingAutoAdjust: 'LR2-ON', judgeTimingMs: 100 });
  // Twelve late hits fill one window of ten: a single 1 ms step, later.
  expect(replay?.play.optionChanges?.map((change) => change.values.judgeTimingMs)).toEqual([101]);
  await player.leaveResult();
  // The adjusted timing is kept for the next play.
  expect(await player.readOption(['Play options'], 'Judge timing (ms)')).toBe(101);
  expect(await player.readOption(['Play options'], 'Auto judge timing')).toBe('LR2 ON');
});

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`SURVIVAL TO GROOVE switches to the parallel NORMAL gauge on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('survival-to-groove.bms', '#TITLE Survival to groove\n#BPM 240\n#00111:01\n#00212:01\n');
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Gauge', 'HAZARD');
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
      // A key-6 note makes the chart 7KEY: 5KEY's EX-HARD scales its damage up on a sparse chart, past a POOR.
      await player.dropText(
        'gauge-selection.bms',
        '#TITLE Gauge selection\n#BPM 240\n#00111:01\n#00212:01\n#00318:01\n',
      );
      await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
      await player.setOption(['Play options'], 'Gauge', 'NORMAL');
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
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

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`scroll ADD parameters and generated curve are recorded and replayed on ${skin}`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText(
      'scroll-add.bms',
      '#TITLE Scroll ADD\n#BPM 240\n#BPM01 480\n#STOP01 192\n#00111:01\n#00108:01\n#00209:01\n#00312:01',
    );
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'Scroll (beatoraja)', 'ADD');
    await player.setOption(['Play options'], 'Scroll section lines', 1);
    await player.setOption(['Play options'], 'Scroll rate', 1);
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'Scroll ADD', 'scroll ADD chart');
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2, 'scroll ADD play');
    await player.key('Space');
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`scroll-add-${skin}.png`) });
    await player.key('Space');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play).toMatchObject({ scrollModifier: 'ADD', scrollSection: 1, scrollRate: 1 });
    expect(replay?.play.options).toMatchObject({ scrollModifier: 'ADD', scrollSection: 1, scrollRate: 1 });
    expect(replay?.play.scrollModifierTimeline).toHaveLength(5);
    expect(replay?.play.scrollModifierTimeline?.every((point) => point.speed >= 0 && point.speed <= 2)).toBe(true);
    expect(replay?.chart.notes.map((note) => note.timeUs)).toEqual([1000000, 2500000]);
    await player.leaveResult();
    await player.setOption(['Play options'], 'Scroll rate', 0);
    await player.setOption(['Play options'], 'Scroll (beatoraja)', 'OFF');
    await player.dropText('scroll-add.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'scroll ADD replay');
    await player.waitForResult(1);
  });
}

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`LR2 P.ATTACK is selectable, remembered and replayed on ${skin}`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('perfect-attack.bms', '#TITLE Perfect attack\n#BPM 240\n#00111:01\n#00212:01');
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    await player.setOption(['Play options'], 'Gauge', 'P.ATTACK');
    await player.setOption(['Play options'], 'Auto play', true);
    expect(
      await player.page.evaluate(
        () => JSON.parse(localStorage.getItem('be-music.debug-menu-settings')!).settings.gauge,
      ),
    ).toBe('P-ATTACK');
    await player.cursorTo((bar) => bar.title === 'Perfect attack', 'P.ATTACK chart');
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2, 'P.ATTACK play');
    await player.key('Space');
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`perfect-attack-${skin}.png`) });
    await player.key('Space');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.gauge).toBe('P-ATTACK');
    expect(replay?.results?.native?.gauge).toMatchObject({
      type: 'P-ATTACK',
      final: 100,
      cleared: true,
    });
    await player.leaveResult();
    await player.setOption(['Play options'], 'Gauge', 'GROOVE');
    await player.dropText('perfect-attack.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'P.ATTACK replay');
    await player.waitForResult(1);
    await player.leaveResult();
    await player.setOption(['Play options'], 'Gauge', 'P.ATTACK');
    await player.page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
    expect(await player.readOption(['Play options'], 'Gauge')).toBe('P.ATTACK');
  });
}

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`LR2 G.ATTACK is selectable, remembered and replayed on ${skin}`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText('good-attack.bms', '#TITLE Good attack\n#BPM 240\n#00111:01\n#00212:01');
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    await player.setOption(['Play options'], 'Gauge', 'G.ATTACK');
    await player.setOption(['Play options'], 'Auto play', true);
    expect(
      await player.page.evaluate(
        () => JSON.parse(localStorage.getItem('be-music.debug-menu-settings')!).settings.gauge,
      ),
    ).toBe('G-ATTACK');
    await player.cursorTo((bar) => bar.title === 'Good attack', 'G.ATTACK chart');
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2, 'G.ATTACK play');
    await player.key('Space');
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`good-attack-${skin}.png`) });
    await player.key('Space');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play.gauge).toBe('G-ATTACK');
    expect(replay?.results?.native?.gauge).toMatchObject({ type: 'G-ATTACK', final: 0, failedMidPlay: true });
    await player.leaveResult();
    await player.setOption(['Play options'], 'Gauge', 'GROOVE');
    await player.dropText('good-attack.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'G.ATTACK replay');
    await player.waitForResult(1);
    await player.leaveResult();
    await player.setOption(['Play options'], 'Gauge', 'G.ATTACK');
    await player.page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
    expect(await player.readOption(['Play options'], 'Gauge')).toBe('G.ATTACK');
  });
}

for (const skin of ['plain', 'native', 'synesthesia'] as const)
  for (const gauge of ['P.ATTACK', 'G.ATTACK'] as const) {
    test(`${gauge} course selection and grade reset remain scoped on ${skin}`, async ({ player }) => {
      await player.open({ 'be-music.built-in-skin': skin });
      const texts = ['#TITLE Attack A\n#BPM 240\n#00111:01', '#TITLE Attack B\n#BPM 240\n#00112:01'];
      for (const [index, text] of texts.entries()) await player.dropText(`attack-stage-${index}.bms`, text);
      const hashes = texts.map((text) => createHash('md5').update(text).digest('hex')).join('');
      const title = `${gauge} course`;
      await player.dropText(
        'Attack courses.lr2crs',
        `<courselist><course><title>${title}</title><type>${gauge === 'G.ATTACK' ? 2 : 0}</type><hash>${'0'.repeat(32)}${hashes}</hash></course></courselist>`,
      );
      await player.setOption(['Developer'], 'Judgment windows', 'LR2');
      await player.setOption(['Play options'], 'Gauge', gauge);
      await player.setOption(['Play options'], 'Auto play', true);
      await player.openFolder('Attack courses');
      await player.cursorTo((bar) => bar.title === title, 'attack course');
      await player.key('Enter');
      await player.waitForResult(0);
      expect((await player.lastReplay())?.play.gauge).toBe(gauge === 'G.ATTACK' ? 'GROOVE' : 'P-ATTACK');
      await player.leaveResult();
      const state = await player.waitForResult(1);
      expect(state.results[1]).toMatchObject({
        run: 'course',
        title,
        cleared: true,
        lamp: 'FULL_COMBO',
        course: { stagesPlayed: 2 },
      });
      await player.leaveResult();
      expect(await player.readOption(['Play options'], 'Gauge')).toBe(gauge);
    });
  }

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`EXTRA converts BGM, persists and records the effective population on ${skin}`, async ({ player }) => {
    await openWithLibrary(player, { 'be-music.built-in-skin': skin });
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], 'EXTRA depth (beatoraja)', 2);
    await player.setOption(['Play options'], 'EXTRA scratch (beatoraja)', true);
    await player.setOption(['Play options'], 'Auto play', true);
    await player.dropText(
      'extra/extra.bms',
      '#TITLE Extra fixture\n#BPM 240\n#00101:01\n#00101:01\n#00201:02\n#00212:03',
    );
    await player.openFolder('extra');
    await player.cursorTo((bar) => bar.title === 'Extra fixture', 'EXTRA chart');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play).toMatchObject({ extraNoteDepth: 2, extraNoteScratch: true, extraNoteChangeCount: 3 });
    expect(replay?.chart.notes.filter((note) => note.type !== 'mine' && note.type !== 'invisible')).toHaveLength(3);
    expect(replay?.play.options).toMatchObject({ extraNoteDepth: 2, extraNoteScratch: true });
    await player.page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
    expect(await player.readOption(['Play options'], 'EXTRA depth (beatoraja)')).toBe(2);
    expect(await player.readOption(['Play options'], 'EXTRA scratch (beatoraja)')).toBe(true);
  });
}

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`LR2 EXTRA records normalised holds and restores its source settings on ${skin}`, async ({ player }) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText(
      'lr2-extra.bme',
      '#TITLE LR2 Extra fixture\n#BPM 240\n#LNOBJ ZZ\n#00111:01\n#00211:ZZ\n#00201:02\n#00312:01',
    );
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    await player.setOption(['Play options'], 'EXTRA MODE (LR2)', true);
    await player.setOption(['Play options'], 'EXTRA minimum level (LR2)', 'LEVEL 2');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'LR2 Extra fixture', 'LR2 EXTRA chart');
    await player.key('Enter');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play).toMatchObject({
      lr2ExtraMode: true,
      lr2ExtraLevel: 1,
      lr2ExtraEffectiveLevel: 1,
      lr2ExtraConvertedObjectCount: 1,
      lr2ExtraTempo: 1,
    });
    expect(replay?.play.options).toMatchObject({ lr2ExtraMode: true, lr2ExtraLevel: 1 });
    expect(replay?.chart.notes).toHaveLength(3);
    expect(replay?.chart.notes.every((note) => note.type === 'normal')).toBe(true);
    await player.leaveResult();
    await player.setOption(['Play options'], 'EXTRA MODE (LR2)', false);
    await player.dropText('lr2-extra.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'LR2 EXTRA replay');
    await player.waitForResult(1);
    await player.leaveResult();
    await player.setOption(['Play options'], 'EXTRA MODE (LR2)', true);
    await player.page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
    expect(await player.readOption(['Play options'], 'EXTRA MODE (LR2)')).toBe(true);
    expect(await player.readOption(['Play options'], 'EXTRA minimum level (LR2)')).toBe('LEVEL 2');
  });
}

for (const skin of ['plain', 'native', 'synesthesia'] as const)
  for (const sourceKeys of [5, 7] as const) {
    test(`SP TO DP renders and replays ${sourceKeys === 5 ? 10 : 14}KEY with holds on ${skin}`, async ({
      player,
    }, info) => {
      await player.open({ 'be-music.built-in-skin': skin });
      const title = `SP TO DP ${sourceKeys}`;
      await player.dropText(
        'sp-to-dp.bme',
        `#TITLE ${title}\n#BPM 240\n#LNOBJ ZZ\n#00111:01\n#00112:02\n#00212:ZZ\n#00311:01${sourceKeys === 7 ? '\n#00418:01' : ''}`,
      );
      await player.setOption(['Developer'], 'Judgment windows', 'LR2');
      await player.setOption(['Play options'], 'Battle', 'SP TO DP');
      await player.setOption(['Play options'], 'Auto play', true);
      await player.cursorTo((bar) => bar.title === title, 'SP TO DP source chart');
      await player.key('Enter');
      await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2, 'DP play');
      await player.key('Space');
      await player.page.locator('#stage').screenshot({ path: info.outputPath(`sp-to-dp-${sourceKeys}-${skin}.png`) });
      await player.key('Space');
      await player.waitForResult(0);
      const replay = await player.lastReplay();
      expect(replay?.play).toMatchObject({
        battleMode: 'SP-TO-DP',
        battleSourceVariant: String(sourceKeys),
        battleTempo: 1,
      });
      expect(replay?.play.options?.battleMode).toBe('SP-TO-DP');
      expect(replay?.chart.laneMode).toBe(sourceKeys === 5 ? '5 KEY DP' : '14 KEY DP');
      expect(replay?.chart.notes).toHaveLength(sourceKeys === 5 ? 3 : 4);
      expect(replay?.chart.notes.some((note) => note.channel.startsWith('2'))).toBe(true);
      expect(replay?.chart.notes.some((note) => note.type === 'long')).toBe(true);
      await player.leaveResult();
      await player.setOption(['Play options'], 'Battle', 'OFF');
      await player.dropText('sp-to-dp.bmplay.json', JSON.stringify(replay));
      await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'SP TO DP replay');
      await player.waitForResult(1);
      await player.leaveResult();
      await player.setOption(['Play options'], 'Battle', 'SP TO DP');
      await player.page.reload();
      await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
      expect(await player.readOption(['Play options'], 'Battle')).toBe('SP TO DP');
    });
  }

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`7-to-9 renders nine lanes, retains holds and restores its replay on ${skin}`, async ({ player }, info) => {
    await player.open({ 'be-music.built-in-skin': skin });
    await player.dropText(
      'seven-to-nine.bme',
      '#TITLE Seven to nine\n#BPM 240\n#LNOBJ ZZ\n#00111:01\n#00116:0001\n#00218:01\n#00318:ZZ',
    );
    await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
    await player.setOption(['Play options'], '7-to-9 (beatoraja)', 'SC2 KEY3–9');
    await player.setOption(['Play options'], '7-to-9 scratch', 'Alternate');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === 'Seven to nine', '7-to-9 source');
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.2, 'nine-key play');
    await player.key('Space');
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`seven-to-nine-${skin}.png`) });
    await player.key('Space');
    await player.waitForResult(0);
    const replay = await player.lastReplay();
    expect(replay?.play).toMatchObject({ sevenToNinePattern: 3, sevenToNineType: 2, sevenToNineApplied: true });
    expect(replay?.chart.laneMode).toContain('9 KEY');
    expect(replay?.chart.notes).toHaveLength(3);
    expect(replay?.chart.notes.some((note) => note.type === 'long')).toBe(true);
    await player.leaveResult();
    await player.setOption(['Play options'], '7-to-9 (beatoraja)', 'OFF');
    await player.dropText('seven-to-nine.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, '7-to-9 replay');
    await player.waitForResult(1);
    await player.leaveResult();
    await player.setOption(['Play options'], '7-to-9 (beatoraja)', 'SC2 KEY3–9');
    await player.page.reload();
    await player.waitFor((state) => state.scene.kind === 'select', 'select after reload');
    expect(await player.readOption(['Play options'], '7-to-9 (beatoraja)')).toBe('SC2 KEY3–9');
    expect(await player.readOption(['Play options'], '7-to-9 scratch')).toBe('Alternate');
  });
}

for (const skin of ['plain', 'native', 'synesthesia'] as const) {
  test(`LR2 BATTLE plays two players on ${skin}, each with its own gauge, and replays both`, async ({
    player,
  }, info) => {
    await player.open({ 'be-music.built-in-skin': skin });
    const title = `Two players ${skin}`;
    await player.dropText('two-players.bme', `#TITLE ${title}\n#BPM 240\n#00111:01010101\n#00116:0001\n#00212:01`);
    await player.setOption(['Developer'], 'Judgment windows', 'LR2');
    await player.setOption(['Play options'], 'Battle', 'BATTLE');
    await player.setOption(['Play options'], 'Gauge 2P', 'HARD');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.cursorTo((bar) => bar.title === title, 'two-player chart');
    await player.key('Enter');
    await player.waitFor((state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 0.6, 'BATTLE play');
    await player.key('Space');
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`battle-${skin}.png`) });
    if (skin === 'native') await expect(player.page.locator('[part~="second-player"]').first()).toBeAttached();
    await player.key('Space');
    await player.waitForResult(0);
    await player.page.locator('#stage').screenshot({ path: info.outputPath(`battle-result-${skin}.png`) });
    const replay = await player.lastReplay();
    expect(replay?.play).toMatchObject({ battleMode: 'TWO-PLAYER', gauge2P: 'HARD' });
    expect(replay?.results?.secondPlayer).toMatchObject({ judge: { pgreat: 6 }, gauge: { type: 'HARD' } });
    expect(replay?.results?.native).toMatchObject({ judge: { pgreat: 6 } });
    await player.leaveResult();
    await player.setOption(['Play options'], 'Battle', 'OFF');
    await player.dropText('two-players.bmplay.json', JSON.stringify(replay));
    await player.waitFor((state) => state.scene.kind === 'play' && state.play?.replay === true, 'BATTLE replay');
    await player.waitForResult(1);
  });
}

test('That-Which-Must-Not-Be-Named 2P PLAY with M-RAN mirrors one player of a shared RANDOM', async ({ player }) => {
  await player.open({ 'be-music.built-in-skin': 'plain' });
  const title = 'M-RAN';
  await player.dropText('m-ran.bme', `#TITLE ${title}\n#BPM 240\n#00111:01\n#00112:0001\n#00113:000001`);
  await player.setOption(['Developer'], 'Judgment windows', '????');
  await player.setOption(['Play options'], 'Battle', '2P PLAY');
  await player.setOption(['Play options'], 'Random 1P', 'RANDOM');
  await player.setOption(['Play options'], 'Random 2P', 'RANDOM');
  await player.setOption(['Play options'], 'M-RAN 2P', true);
  await player.setOption(['Play options'], 'Auto play', true);
  await player.cursorTo((bar) => bar.title === title, 'M-RAN chart');
  await player.key('Enter');
  await player.waitForResult(0);
  const replay = await player.lastReplay();
  expect(replay?.play.battleMode).toBe('TWO-PLAYER');
  const lanes = (side: string): string[] =>
    (replay?.chart.notes ?? [])
      .filter((note) => note.channel.startsWith(side))
      .sort((a, b) => a.timeUs - b.timeUs)
      .map((note) => note.channel.slice(1));
  // A 5KEY chart: MIRROR swaps keys 1↔5 and 2↔4.
  const mirror: Record<string, string> = { '1': '5', '2': '4', '3': '3', '4': '2', '5': '1' };
  expect(lanes('2')).toEqual(lanes('1').map((lane) => mirror[lane]));
});

test('a lane option that does not fit the chart names itself in a dialog and goes back to select (#771)', async ({
  player,
}) => {
  await openWithLibrary(player);
  // beatoraja's CONVERGE is a PMS arrangement; Fixture A is a 7KEY chart.
  await player.setOption(['Developer'], 'Judgment windows', 'beatoraja');
  await player.setOption(['Play options'], 'Random 1P', 'CONVERGE');
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  const dialog = player.page.locator('dialog#play-option-mismatch');
  // A Basecoat dialog is an empty box; its panel, the child, is what shows.
  await expect(dialog.locator(':scope > form')).toBeVisible();
  await expect(dialog.locator('li')).toHaveText(['Random 1P: CONVERGE']);
  expect((await player.state()).status).toBe('Cannot play Fixture A with Random 1P: CONVERGE');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog.locator(':scope > form')).toBeHidden();
  await player.waitFor((state) => state.scene.kind === 'select', 'select after the dialog');
  // The option stays as the player set it, to change on the select screen.
  expect(await player.readOption(['Play options'], 'Random 1P')).toBe('CONVERGE');
});
