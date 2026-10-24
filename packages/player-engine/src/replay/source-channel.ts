import { normalizeChannel } from '@be-music/chart-source';

/** Original playable lane, retained by the source event while lane transforms mutate the timed note's channel. */
export function resolveReplaySourceChannel(note: { channel: string; event?: { channel: string } }): string {
  const raw = normalizeChannel(note.event?.channel ?? note.channel);
  if (!/^[123456DE][0-9A-Z]$/.test(raw)) return note.channel;
  return `${'135D'.includes(raw[0]!) ? '1' : '2'}${raw[1]}`;
}
