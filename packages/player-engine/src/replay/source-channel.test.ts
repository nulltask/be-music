import { expect, test } from 'vite-plus/test';
import { resolveReplaySourceChannel } from './source-channel.ts';

test.each([
  ['11', '11'],
  ['21', '21'],
  ['51', '11'],
  ['62', '22'],
  ['D6', '16'],
  ['E1', '21'],
  ['3A', '1A'],
  ['4O', '2O'],
  ['5Q', '1Q'],
  ['d1', '11'],
])('original event channel %s resolves to playable lane %s', (channel, expected) => {
  expect(resolveReplaySourceChannel({ channel: '15', event: { channel } })).toBe(expected);
});

test('hand-built notes without a lane source event retain their supplied lane', () => {
  expect(resolveReplaySourceChannel({ channel: '14' })).toBe('14');
  expect(resolveReplaySourceChannel({ channel: '14', event: { channel: '01' } })).toBe('14');
});
