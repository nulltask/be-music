import { describe, expect, test } from 'vite-plus/test';
import { clientMessages } from './messages.ts';
import { centerSquare, describeAccountError } from './profile.ts';

describe('describeAccountError', () => {
  test('explains each error the account API answers', () => {
    expect(describeAccountError('invalid-handle', 'format')).toBe('Handles are 3 to 15 letters, digits or _.');
    expect(describeAccountError('invalid-handle', 'reserved')).toBe('That handle is reserved. Pick another.');
    expect(describeAccountError('invalid-display-name', 'length')).toBe('Names are at most 32 characters.');
    expect(describeAccountError('handle-taken')).toBe('That handle is taken.');
    expect(describeAccountError('not-your-score')).toBe('Only the player of this play can change it.');
    expect(describeAccountError('unsupported-image')).toBe('Use a PNG, JPEG or WebP image.');
    expect(describeAccountError('http-500')).toBe('Something went wrong (http-500).');
  });

  test('answers in the page language', () => {
    const ja = clientMessages('ja');
    expect(describeAccountError('handle-taken', undefined, ja)).toBe('そのハンドルは使われています。');
    expect(describeAccountError('http-500', undefined, ja)).toBe('問題が発生しました（http-500）。');
  });
});

describe('clientMessages', () => {
  test('picks Japanese for ja and its regional tags, English otherwise', () => {
    expect(clientMessages('ja').linkCopied).toBe('リンクをコピーしました。');
    expect(clientMessages('ja-JP').linkCopied).toBe('リンクをコピーしました。');
    expect(clientMessages('en').linkCopied).toBe('Link copied.');
    expect(clientMessages('fr').linkCopied).toBe('Link copied.');
    expect(clientMessages('').linkCopied).toBe('Link copied.');
  });
});

describe('centerSquare', () => {
  test('keeps the largest centred square', () => {
    expect(centerSquare(400, 300)).toEqual({ x: 50, y: 0, size: 300 });
    expect(centerSquare(300, 401)).toEqual({ x: 0, y: 50, size: 300 });
    expect(centerSquare(256, 256)).toEqual({ x: 0, y: 0, size: 256 });
  });
});
