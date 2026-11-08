import { expect, test } from 'vite-plus/test';
import { setHidden, setStyle } from './dom-style.ts';

/** An element whose style and `hidden` count their writes. */
function fakeElement() {
  const writes: string[] = [];
  const values: Record<string, string> = { left: '' };
  const style = new Proxy(values, {
    set(target, key, value) {
      writes.push(String(key));
      target[key as string] = value;
      return true;
    },
  });
  let hidden = false;
  const element = {
    style,
    get hidden() {
      return hidden;
    },
    set hidden(value: boolean) {
      writes.push('hidden');
      hidden = value;
    },
  } as unknown as HTMLElement;
  return { element, writes };
}

test('writes a style property only when it changes', () => {
  const { element, writes } = fakeElement();
  setStyle(element, 'left', '10px');
  setStyle(element, 'left', '10px');
  expect(element.style.left).toBe('10px');
  setStyle(element, 'left', '12px');
  expect(writes).toEqual(['left', 'left']);
});

test('writes hidden only when it changes', () => {
  const { element, writes } = fakeElement();
  setHidden(element, false);
  setHidden(element, true);
  setHidden(element, true);
  expect(element.hidden).toBe(true);
  expect(writes).toEqual(['hidden']);
});
