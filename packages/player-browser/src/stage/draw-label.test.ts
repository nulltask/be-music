import { expect, test } from 'vite-plus/test';
import { drawLabel } from './draw-label.ts';

test('preserves exact debug label spellings and separates every input', () => {
  const owner = {};
  for (const kind of [
    'note',
    'note-fallback',
    'mine',
    'mine-fallback',
    'ln-body',
    'ln-body-fallback',
    'ln-end',
    'ln-start',
  ] as const) {
    expect(drawLabel(owner, kind, 2, '19')).toBe(`${kind}[lane=2,ch=19]`);
    expect(drawLabel(owner, kind, 2, '19')).toBe(`${kind}[lane=2,ch=19]`);
    expect(drawLabel(owner, kind, 3, '29')).toBe(`${kind}[lane=3,ch=29]`);
  }
  for (const kind of ['invisible-note', 'invisible-note-fallback', 'bomb'] as const)
    expect(drawLabel(owner, kind, '19')).toBe(`${kind}[ch=19]`);
  expect(drawLabel(owner, 'measure-line', 1, 3.5)).toBe('measure-line[idx=1,beat=3.5]');
  expect(drawLabel(owner, 'image', 'folder/a.png')).toBe('image[folder/a.png]');
  expect(drawLabel(owner, 'number', 100, 2)).toBe('number[num=100,cell=2]');
  expect(drawLabel(owner, 'number', 100, 3)).toBe('number[num=100,cell=3]');
  expect(drawLabel(owner, 'judgeline', 1)).toBe('judgeline[idx=1]');
  expect(drawLabel(owner, 'text', 12)).toBe('text[st=12]');
  for (const kind of ['bargraph', 'slider'] as const) expect(drawLabel(owner, kind, 3)).toBe(`${kind}[type=3]`);
  expect(drawLabel(owner, 'nowcombo', 9)).toBe('nowcombo[digit=9]');
  expect(drawLabel({}, 'image', 'other.png')).toBe('image[other.png]');
});
