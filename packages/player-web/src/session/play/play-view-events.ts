/**
 * The moments of a play a view animates against, in the view contract's words (`PlayViewEvent`, `view/types.ts`): what
 * the play session raises for its view (`PlayMoment`: the scene stages, the exit phases, judgments, the full combo,
 * gauge moves, bombs and the engine's lane commands), handed to the view in each `PlayFrame`.
 */

import type { PlayViewEvent } from '../../view/types.ts';
import type { PlayMoment } from './play-session-theme.ts';

/**
 * `event` as a view reads it, or `undefined` for a judgment without the judge it reports. A judge moment carries the
 * judgment the session reports with it; a lane command maps to a lane, hold, long-note or POOR-image event.
 */
export function playViewEventFromMoment(
  event: PlayMoment,
  judgment?: { judge: Extract<PlayViewEvent, { kind: 'judge' }>['judge']; channel?: string; deltaMs?: number },
): PlayViewEvent | undefined {
  switch (event.kind) {
    case 'scene-start':
    case 'load-end':
    case 'play-start':
    case 'exit-fade-out':
    case 'exit-close':
      return { kind: event.kind, atMs: event.at };
    case 'judge':
      if (judgment === undefined) return undefined;
      return {
        kind: 'judge',
        judge: judgment.judge,
        side: event.side,
        ...(judgment.channel !== undefined ? { channel: judgment.channel } : {}),
        ...(judgment.deltaMs !== undefined ? { deltaMs: judgment.deltaMs } : {}),
        atMs: event.at,
      };
    case 'full-combo':
      return { kind: 'full-combo', atMs: event.at };
    case 'gauge':
      return { kind: 'gauge', previous: event.previous, next: event.next, atMs: event.at };
    case 'bomb':
      return { kind: 'bomb', channel: event.channel, atMs: event.at };
    case 'lane-command': {
      const command = event.command;
      switch (command.kind) {
        case 'flash-lane':
          return { kind: 'lane', channel: command.channel, action: 'flash' };
        case 'press-lane':
          return { kind: 'lane', channel: command.channel, action: 'press' };
        case 'release-lane':
          return { kind: 'lane', channel: command.channel, action: 'release' };
        case 'hold-lane-until-beat':
          return { kind: 'lane-hold', channel: command.channel, untilBeat: command.beat };
        case 'long-note-start':
          return { kind: 'long-note-start', channel: command.channel, beat: command.beat, mode: command.mode };
        case 'long-note-end':
          return { kind: 'long-note-end', channel: command.channel, outcome: command.outcome };
        case 'trigger-poor-bga':
          return { kind: 'poor-bga', shown: true, seconds: command.seconds };
        case 'clear-poor-bga':
          return { kind: 'poor-bga', shown: false };
      }
    }
  }
}
