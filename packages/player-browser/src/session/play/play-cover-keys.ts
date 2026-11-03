/**
 * The lane cover keys of a play that takes them (`PlaySessionOptions.coverKeys`, the beatoraja play screen's): PageUp /
 * PageDown move SUDDEN+, Home / End the LIFT, H switches HIDDEN+ and J / K move it. A step is 1 % of the lane, 5 % with
 * Shift. They change the play state's covers like any cover command, so a course that locks the hi-speed locks them
 * too. A key one of the play's lanes takes (H, J and K are 2P lanes of a DP chart) plays the lane instead.
 */

import type { LaneCoverCommand } from '@be-music/player-scene-model';
import { keyboardEventToTokens } from '../../runtime/web-input-runtime.ts';
import { DEFAULT_CONTROL_ACTIONS, type ControlActionMap } from '../controls/control-actions.ts';
import type { PlayViewSetting } from '../../view/types.ts';

/** What a cover key does: the cover command, and the view setting it changes (for the view's feedback). */
export interface PlayCoverKey {
  readonly command: LaneCoverCommand;
  readonly setting: PlayViewSetting;
}

/** A cover key's step: 1 % of the lane, 5 % with Shift. */
function coverStep(shiftKey: boolean): number {
  return shiftKey ? 0.05 : 0.01;
}

const NO_LANE_TOKENS: ReadonlySet<string> = new Set();

/** The input tokens the play's lanes take (`LaneBinding.inputTokens`, lowercase), for {@link resolvePlayCoverKey}. */
export function resolveLaneInputTokens(
  bindings: readonly { readonly inputTokens: readonly string[] }[] | undefined,
): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const binding of bindings ?? []) {
    for (const token of binding.inputTokens) tokens.add(token.toLowerCase());
  }
  return tokens;
}

/**
 * What a key does to the lane covers by the player's keys (`actions`), or `undefined` for a key that is not a cover key:
 * PageUp raises SUDDEN+ (less of the lane covered) and PageDown lowers it; End raises the LIFT and Home lowers it; H
 * switches HIDDEN+ on (at a quarter of the lane without a height) or off; K raises HIDDEN+ and J lowers it, by default.
 * A key whose input token (from its `code`, as the lane input reads it) is one of `laneTokens`
 * ({@link resolveLaneInputTokens}) is a lane's, not a cover key.
 */
export function resolvePlayCoverKey(
  event: { readonly key: string; readonly code?: string; readonly shiftKey: boolean },
  laneTokens: ReadonlySet<string> = NO_LANE_TOKENS,
  actions: ControlActionMap = DEFAULT_CONTROL_ACTIONS.lr2,
): PlayCoverKey | undefined {
  if (event.code === undefined) return undefined;
  if (laneTokens.size > 0 && keyboardEventToTokens({ code: event.code }).some((token) => laneTokens.has(token))) {
    return undefined;
  }
  const keyEvent = { code: event.code, key: event.key, shiftKey: event.shiftKey };
  const step = coverStep(event.shiftKey);
  if (actions.is('play.sudden-up', keyEvent)) {
    return { command: { type: 'cover-adjust', part: 'sudden', delta: -step }, setting: 'sudden' };
  }
  if (actions.is('play.sudden-down', keyEvent)) {
    return { command: { type: 'cover-adjust', part: 'sudden', delta: step }, setting: 'sudden' };
  }
  if (actions.is('play.lift-down', keyEvent)) {
    return { command: { type: 'cover-adjust', part: 'lift', delta: -step }, setting: 'lift' };
  }
  if (actions.is('play.lift-up', keyEvent)) {
    return { command: { type: 'cover-adjust', part: 'lift', delta: step }, setting: 'lift' };
  }
  if (actions.is('play.hidden-toggle', keyEvent)) {
    return { command: { type: 'cover-toggle', part: 'hidden' }, setting: 'hidden-toggle' };
  }
  if (actions.is('play.hidden-down', keyEvent)) {
    return { command: { type: 'cover-adjust', part: 'hidden', delta: -step }, setting: 'hidden' };
  }
  if (actions.is('play.hidden-up', keyEvent)) {
    return { command: { type: 'cover-adjust', part: 'hidden', delta: step }, setting: 'hidden' };
  }
  return undefined;
}
