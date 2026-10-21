import { expect, openWithLibrary, test } from './support.ts';

test('native monitors stay read-only and folder persistence keeps the existing keys', async ({ demo }, info) => {
  await openWithLibrary(demo, {
    'be-music-demo.debug-menu-folders': JSON.stringify({ Audio: false, Developer: true }),
  });
  const pane = demo.page.locator('[data-pane=debug]');
  await expect(pane).not.toHaveClass(/tp-rotv-expanded/);
  await pane.locator(':scope > .tp-rotv_b').click();
  const status = pane.locator('.status-row textarea');
  expect(await status.evaluate((element: HTMLTextAreaElement) => element.readOnly)).toBe(true);
  const audioButton = pane.getByRole('button', { name: 'Audio', exact: true });
  await expect(audioButton.locator('..')).not.toHaveClass(/tp-fldv-expanded/);
  await audioButton.click();
  await expect(audioButton.locator('..')).toHaveClass(/tp-fldv-expanded/);
  const developer = pane.getByRole('button', { name: 'Developer', exact: true }).locator('..');
  await expect(developer).toHaveClass(/tp-fldv-expanded/);
  const graph = developer.locator('polyline');
  await expect(graph).toHaveAttribute('points', /\d/);
  expect(await graph.getAttribute('points')).not.toContain('NaN');
  const remembered = await demo.page.evaluate(() =>
    JSON.parse(localStorage.getItem('be-music-demo.debug-menu-folders')!),
  );
  expect(remembered.Audio).toBe(true);
  expect(remembered.Developer).toBe(true);
  expect(remembered['Debug Menu']).toBeUndefined();
  await developer.scrollIntoViewIfNeeded();
  await demo.page.locator('.debug-pane-container').screenshot({ path: info.outputPath('debug-pane.png') });
});
