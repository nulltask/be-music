import { describe, expect, it } from 'vitest';
import { defaultNoteTone } from './playfield.ts';

describe('defaultNoteTone', () => {
  it('paints scratch gold, odd keys ice, even keys cyan', () => {
    expect(defaultNoteTone('16', 0, '7').body).toBe(0xffd056);
    expect(defaultNoteTone('11', 1, '7').body).toBe(0xe8f4fb);
    expect(defaultNoteTone('12', 2, '7').body).toBe(0x2fd4f0);
  });

  it('treats 9K channel 16 as a key, not scratch', () => {
    expect(defaultNoteTone('16', 6, '9').body).not.toBe(0xffd056);
  });
});
