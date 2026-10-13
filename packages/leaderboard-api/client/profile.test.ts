import { describe, expect, test } from 'vite-plus/test';
import { centerSquare, describeAccountError } from './profile.ts';

describe('describeAccountError', () => {
  test('explains each error the account API answers', () => {
    expect(describeAccountError('invalid-handle', 'format')).toBe('Handles are 3 to 15 letters, digits or _.');
    expect(describeAccountError('invalid-handle', 'reserved')).toBe('That handle is reserved. Pick another.');
    expect(describeAccountError('invalid-display-name', 'length')).toBe('Names are at most 32 characters.');
    expect(describeAccountError('handle-taken')).toBe('That handle is taken.');
    expect(describeAccountError('unsupported-image')).toBe('Use a PNG, JPEG or WebP image.');
    expect(describeAccountError('http-500')).toBe('Something went wrong (http-500).');
  });
});

describe('centerSquare', () => {
  test('keeps the largest centred square', () => {
    expect(centerSquare(400, 300)).toEqual({ x: 50, y: 0, size: 300 });
    expect(centerSquare(300, 401)).toEqual({ x: 0, y: 50, size: 300 });
    expect(centerSquare(256, 256)).toEqual({ x: 0, y: 0, size: 256 });
  });
});
