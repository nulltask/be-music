import { resolveChart } from '@be-music/chart-model';
import { parseBMS } from '@be-music/chart-parser';
import { afterEach, expect, test } from 'vite-plus/test';
import { layoutChartScore } from '../chart-score/layout.ts';
import { defineBeMusicElements } from '../register.ts';

defineBeMusicElements();

async function mount() {
  const sheet = document.createElement('be-music-chart-score');
  sheet.layout = layoutChartScore(
    resolveChart(
      parseBMS(
        [
          '#BPM 120',
          '#BPM01 180',
          '#STOP01 96',
          '#WAV01 keysound.wav',
          '#00011:01',
          '#00109:01',
          '#00108:0001',
          '#00153:0001',
          '#00253:0001',
          '#00212:0001',
        ].join('\n'),
      ),
    ),
  );
  document.body.append(sheet);
  await sheet.updateComplete;
  const bar = (measure: string) => sheet.shadowRoot!.querySelector<SVGElement>(`[aria-label^="Bar ${measure},"]`)!;
  return { sheet, bar };
}

afterEach(() => document.body.replaceChildren());

test('keyboard navigation keeps its anchor and reports the selected range to the practice picker', async () => {
  const { sheet, bar } = await mount();
  const changes: unknown[] = [];
  sheet.addEventListener('bar-selection-change', (event) => changes.push((event as CustomEvent).detail));
  const type = async (measure: string, key: string, shiftKey = false) => {
    bar(measure).dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, composed: true }));
    await sheet.updateComplete;
  };

  await type('000', ' ');
  await type('000', 'ArrowRight', true);
  await type('001', 'End', true);
  await type('002', 'ArrowLeft', true);
  await type('001', 'End');
  expect(bar('002').getAttribute('tabindex')).toBe('0');
  expect(['000', '001', '002'].map((measure) => bar(measure).getAttribute('aria-pressed'))).toEqual([
    'true',
    'true',
    'false',
  ]);
  expect(changes).toEqual([
    { first: 0, last: 0, bar: 0, extend: false },
    { first: 0, last: 1, bar: 1, extend: true },
    { first: 0, last: 2, bar: 2, extend: true },
    { first: 0, last: 1, bar: 1, extend: true },
  ]);

  sheet.disabled = true;
  await sheet.updateComplete;
  await type('002', ' ');
  expect(bar('002').getAttribute('aria-pressed')).toBe('false');
  expect(changes).toHaveLength(4);
});

test('renders a hold across bars and labels BPM and STOP at the selected playback tempo', async () => {
  const { sheet, bar } = await mount();
  sheet.tempo = 2;
  sheet.previewing = { first: 1, last: 2 };
  await sheet.updateComplete;

  const root = sheet.shadowRoot!;
  expect([...root.querySelectorAll('text.tempo')].map((label) => label.textContent)).toEqual(['240', '360']);
  expect([...root.querySelectorAll('text.stop')].map((label) => label.textContent)).toEqual(['S500']);
  expect(bar('000').parentElement?.querySelectorAll('.ln-body')).toHaveLength(0);
  expect(bar('001').parentElement?.querySelectorAll('.ln-body')).toHaveLength(1);
  expect(bar('002').parentElement?.querySelectorAll('.ln-body')).toHaveLength(1);
  expect(bar('001').parentElement?.querySelectorAll('.previewing')).toHaveLength(3);
  expect(bar('002').parentElement?.querySelectorAll('.previewing')).toHaveLength(3);
  expect(bar('000').parentElement?.querySelectorAll('.previewing')).toHaveLength(0);
});

test('a mouse drag extends from the pressed bar and stops extending when released', async () => {
  const { sheet, bar } = await mount();
  const changes: unknown[] = [];
  sheet.addEventListener('bar-selection-change', (event) => changes.push((event as CustomEvent).detail));
  const point = (measure: string, type: string, pointerId: number) => {
    bar(measure).dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'mouse', bubbles: true }));
  };

  point('002', 'pointerdown', 1);
  point('000', 'pointerover', 2);
  point('001', 'pointerover', 1);
  point('001', 'pointerup', 1);
  point('000', 'pointerover', 1);
  await sheet.updateComplete;

  expect(changes).toEqual([
    { first: 2, last: 2, bar: 2, extend: false },
    { first: 1, last: 2, bar: 1, extend: true },
  ]);
  expect(['000', '001', '002'].map((measure) => bar(measure).getAttribute('aria-pressed'))).toEqual([
    'false',
    'true',
    'true',
  ]);
});
