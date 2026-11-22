import { afterEach, expect, test, vi } from 'vite-plus/test';
import { InlineSearch, type InlineSearchHost } from './inline-search.ts';

function mount(options: Partial<InlineSearchHost> = {}) {
  const shell = document.createElement('main');
  const input = document.createElement('input');
  const error = document.createElement('p');
  shell.append(input, error);
  document.body.append(shell);
  const applied: string[] = [];
  const search = new InlineSearch({
    shell,
    input,
    error,
    canvas: () => undefined,
    fieldRect: () => undefined,
    touch: () => false,
    setEditing: () => {},
    setQuery: (query) => applied.push(query),
    searchError: () => (applied.at(-1) === '?bpm >' ? 'Expected a number after >' : undefined),
    ...options,
  });
  return { search, shell, input, error, applied };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

test('commits a Japanese search only when IME composition ends and leaves it in place on Enter', () => {
  const { search, input, applied } = mount();
  search.open();
  expect(document.activeElement).toBe(input);
  input.value = 'おんがく';
  input.dispatchEvent(new InputEvent('input', { isComposing: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true }));
  expect(applied).toEqual([]);
  expect(document.activeElement).toBe(input);

  input.value = '音楽';
  input.dispatchEvent(new CompositionEvent('compositionend', { data: '音楽' }));
  expect(applied).toEqual(['音楽']);
  const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
  input.dispatchEvent(enter);
  expect(enter.defaultPrevented).toBe(true);
  expect(document.activeElement).not.toBe(input);
  expect(input.value).toBe('音楽');
});

test('shows why an invalid chart filter fails and clears the query and error on Escape', () => {
  const { search, input, error, applied } = mount();
  vi.useFakeTimers();
  search.openFromPointer();
  expect(document.activeElement).not.toBe(input);
  vi.runOnlyPendingTimers();
  expect(document.activeElement).toBe(input);
  input.value = '?bpm >';
  input.dispatchEvent(new InputEvent('input'));
  expect(applied).toEqual(['?bpm >']);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('Expected a number after >');

  const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  input.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(applied).toEqual(['?bpm >', '']);
  expect(input.value).toBe('');
  expect(input.getAttribute('aria-invalid')).toBe('false');
  expect(error.hidden).toBe(true);
  expect(document.activeElement).not.toBe(input);
});

test('follows the skin’s search box while editing and restores the page field after blur', () => {
  vi.useFakeTimers();
  const canvas = document.createElement('canvas');
  const field = { x: 120, y: 35, width: 260, height: 40 };
  const editing: boolean[] = [];
  const { search, shell, input } = mount({
    canvas: () => canvas,
    fieldRect: () => field,
    setEditing: (active) => editing.push(active),
  });
  shell.style.cssText = 'position: fixed; left: 20px; top: 40px; width: 900px; height: 500px';
  canvas.style.cssText = 'position: absolute; left: 30px; top: 30px; width: 800px; height: 450px';
  input.style.position = 'absolute';
  shell.append(canvas);

  search.open();
  expect(input.offsetParent).toBe(shell);
  expect(editing).toEqual([true]);
  expect([input.style.left, input.style.top, input.style.width]).toEqual(['150px', '65px', '260px']);

  field.x = 145;
  vi.advanceTimersToNextFrame();
  expect(input.style.left).toBe('175px');

  input.blur();
  field.x = 190;
  vi.advanceTimersToNextFrame();
  expect(editing).toEqual([true, false]);
  expect([input.style.left, input.style.top, input.style.width]).toEqual(['', '', '']);
});
