import { expect, test } from 'vite-plus/test';
import { clientMessages, describeClientError } from './client-messages.ts';

test('uses Japanese for a ja page and English otherwise', () => {
  expect(clientMessages('ja').requestFailed).toBe('リクエストに失敗しました');
  expect(clientMessages('ja-JP').tryAgain).toContain('もう一度');
  expect(clientMessages('en').requestFailed).toBe('Request failed');
  expect(clientMessages(null).continueFailed).toContain('Sign-in could not be continued');
});

test('turns account API codes into sentences and leaves library messages', () => {
  const ja = clientMessages('ja');
  expect(describeClientError('handle-taken', ja.profileFailed, ja)).toBe('このユーザー名はすでに使われています。');
  expect(describeClientError('avatar-too-large', ja.profileFailed, ja)).toContain('大きすぎます');
  expect(describeClientError('Passkeys are not supported', ja.profileFailed, ja)).toBe('Passkeys are not supported');
  expect(describeClientError(undefined, ja.profileFailed, ja)).toBe(ja.profileFailed);
});
