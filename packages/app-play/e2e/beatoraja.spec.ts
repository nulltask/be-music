import { courseFlowTests } from './course-flow.ts';
import { type Demo, expect, openWithLibrary, test } from './support.ts';

/**
 * The fixture beatoraja skin (`scripts/course-checklist/skins/beatoraja`): its select skin is 640 × 480 with AUTO
 * (act 16) at x 160-300, y 10-90 from the bottom, and one skin option, so the theme shows its Skin Config panel too.
 */
const SELECT_SKIN = { width: 640, height: 480 };
const AUTO_BUTTON = { x: 230, y: 430 };

async function openBeatoraja(demo: Demo): Promise<void> {
  await openWithLibrary(demo);
  await demo.drop('skins/beatoraja');
  await demo.waitFor(
    (state) => state.scene.kind === 'select' && state.scene.family === 'beatoraja',
    'the beatoraja select',
  );
}

courseFlowTests({
  name: 'beatoraja',
  family: 'beatoraja',
  open: openBeatoraja,
  startAuto: (demo) => demo.clickSkin(AUTO_BUTTON.x, AUTO_BUTTON.y, SELECT_SKIN.width, SELECT_SKIN.height),
  // beatoraja has no NONSTOP course of its own: the stitched play and its result show on the theme's play and result
  // skins, with the theme's clear / fail jingles.
  nonstop: { play: 'beatoraja', result: 'beatoraja' },
  jingles: { courseClear: 'beatoraja:courseClear', courseFail: 'beatoraja:courseFail', clear: 'beatoraja:clear' },
  playTime: false,
});

test('the Debug Menu helpers find their controls past the Skin Config panel of a beatoraja theme', async ({ demo }) => {
  await openBeatoraja(demo);
  // The theme's Skin Config panel is another Tweakpane root, ahead of the Debug Menu's.
  await expect(
    demo.page.locator('[data-pane=skin-config] > .tp-rotv_b .tp-rotv_t', { hasText: 'Skin Config (Select)' }),
  ).toHaveCount(1);
  await demo.setOption(['Play options'], 'Auto play', true);
  expect(await demo.readOption(['Play options'], 'Auto play')).toBe(true);
  await demo.setOption(['Play options'], 'Auto play', false);
  expect(await demo.readOption(['Play options'], 'Auto play')).toBe(false);
});

test('skin configuration uses tabs and native position controls, with a working reset', async ({ demo }, info) => {
  demo.page.setDefaultTimeout(15_000);
  await openBeatoraja(demo);
  const pane = demo.page.locator('[data-pane=skin-config]');
  await pane.locator(':scope > .tp-rotv_b').click();
  await pane.getByRole('button', { name: 'Timing & offsets', exact: true }).click();
  const position = pane.locator('.tp-lblv').filter({ has: demo.page.locator('.tp-lblv_l', { hasText: /^Position$/ }) });
  const fields = position.locator('input');
  await expect(fields).toHaveCount(2);
  await expect(fields.nth(0)).toBeVisible();
  await fields.nth(0).fill('30');
  await fields.nth(0).press('Tab');
  await expect(fields.nth(0)).toHaveValue('30');
  await pane.getByRole('button', { name: 'Reset all to 0', exact: true }).click();
  await expect(fields.nth(0)).toHaveValue('0');
  await expect(fields.nth(1)).toHaveValue('0');
  await expect(pane.locator('input').first()).toBeVisible();
  await pane.screenshot({ path: info.outputPath('skin-config.png') });
});
