import { expect, test } from './support.ts';
import type { CollapsiblePanelElement } from '../src/ui/collapsible-panel.ts';

test('the shared panel opens by default, folds by keyboard and supports surface positions', async ({ player }) => {
  await player.open();
  await player.page.evaluate(async () => {
    const panel = document.createElement('be-music-collapsible-panel');
    panel.id = 'panel-placement-test';
    panel.heading = 'Panel placement';
    panel.textContent = 'Panel content';
    document.querySelector('#main')!.append(panel);
    await panel.updateComplete;
  });
  const panel = player.page.locator('#panel-placement-test');
  await expect(panel).toHaveAttribute('open', '');
  await panel.locator('summary').press('Enter');
  await expect(panel).not.toHaveAttribute('open', '');
  expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(48);
  await panel.locator('summary').press('Space');
  await expect(panel).toHaveAttribute('open', '');
  const surface = (await player.page.locator('#main').boundingBox())!;
  for (const position of [
    'top',
    'bottom',
    'left',
    'right',
    'center',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ] as const) {
    await panel.evaluate(async (element, position) => {
      const component = element as CollapsiblePanelElement;
      component.position = position;
      await component.updateComplete;
    }, position);
    const box = (await panel.boundingBox())!;
    const x = position.includes('left')
      ? surface.x
      : position.includes('right')
        ? surface.x + surface.width - box.width
        : surface.x + (surface.width - box.width) / 2;
    const y = position.includes('top')
      ? surface.y
      : position.includes('bottom')
        ? surface.y + surface.height - box.height
        : surface.y + (surface.height - box.height) / 2;
    expect(box.x).toBeCloseTo(x, 0);
    expect(box.y).toBeCloseTo(y, 0);
  }
});
