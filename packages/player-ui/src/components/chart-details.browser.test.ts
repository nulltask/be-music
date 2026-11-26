import type { LibraryChart, LibraryEntry } from '@be-music/player-skin-sdk';
import { afterEach, expect, test } from 'vite-plus/test';
import { defineBeMusicElements } from '../register.ts';

defineBeMusicElements();

afterEach(() => document.body.replaceChildren());

const chart = { id: 's', title: 'Song', playLevel: 12, bpm: 150 } as unknown as LibraryChart;

async function actions(entry: LibraryEntry | undefined) {
  const details = document.createElement('be-music-chart-details');
  details.entry = entry;
  document.body.append(details);
  await details.updateComplete;
  return [...details.shadowRoot!.querySelectorAll('button')].map((button) => ({
    label: button.textContent!.trim(),
    disabled: button.disabled,
    variant: button.dataset.variant,
  }));
}

test('PLAY is filled and enabled on a chart', async () => {
  expect(await actions({ kind: 'chart', chart })).toEqual([
    { label: 'Play', disabled: false, variant: undefined },
    { label: 'Auto play', disabled: false, variant: 'outline' },
    { label: 'Readme', disabled: false, variant: 'outline' },
  ]);
});

test('PLAY turns into a disabled outline, like the other buttons, on a folder or with nothing selected', async () => {
  const disabled = [
    { label: 'Play', disabled: true, variant: 'outline' },
    { label: 'Auto play', disabled: true, variant: 'outline' },
    { label: 'Readme', disabled: true, variant: 'outline' },
  ];
  expect(await actions({ kind: 'folder', folder: { label: 'pack', charts: [chart] } } as LibraryEntry)).toEqual(
    disabled,
  );
  document.body.replaceChildren();
  expect(await actions(undefined)).toEqual(disabled);
});
