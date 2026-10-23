/**
 * The moments of a play a view animates against, in the view contract's words (`PlayViewEvent`, `view/types.ts`): what
 * the play session raises for its view (`PlayMoment`: the scene stages, the exit phases, judgments, the full combo,
 * gauge moves, bombs, the engine's lane commands and the view settings the player's keys change), handed to the view in
 * each `PlayFrame`.
 */

import { isJudgmentKind } from '@be-music/player-scene-model';
import type { PlayViewEvent } from '../../view/types.ts';
import type { PlayMoment } from './play-session-theme.ts';

/**
 * `event` as a view reads it, or `undefined` for a judgment the view has no word for (the engine's READY). A judge
 * moment carries its judgment, lane, timing and combo; a lane command maps to a lane, hold, long-note or POOR-image
 * event.
 */
export function playViewEventFromMoment(event: PlayMoment): PlayViewEvent | undefined {
  switch (event.kind) {
    case 'scene-start':
    case 'input-start':
    case 'load-end':
    case 'play-start':
    case 'music-end':
    case 'exit-fade-out':
    case 'exit-close':
      return { kind: event.kind, atMs: event.at };
    case 'judge':
      if (!isJudgmentKind(event.judge)) return undefined;
      return {
        kind: 'judge',
        judge: event.judge,
        side: event.side,
        ...(event.channel !== undefined ? { channel: event.channel } : {}),
        ...(event.deltaMs !== undefined ? { deltaMs: event.deltaMs } : {}),
        combo: event.combo,
        atMs: event.at,
      };
    case 'full-combo':
      return { kind: 'full-combo', atMs: event.at };
    case 'gauge':
      return { kind: 'gauge', previous: event.previous, next: event.next, atMs: event.at };
    case 'bomb':
      return { kind: 'bomb', channel: event.channel, atMs: event.at };
    case 'view-setting':
      return { kind: 'view-setting', setting: event.setting, atMs: event.at };
    case 'seek':
      return { kind: 'seek', seconds: event.seconds, gauge: event.gauge, judgments: event.judgments, atMs: event.at };
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
