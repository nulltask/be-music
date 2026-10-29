/**
 * The keys a play handles itself rather than the engine's web input runtime, kept apart from the input handling
 * (`play-input.ts`) so the engine side (`play-engine.ts`) can hand the runtime its filter without importing the input.
 */

import { QUIT_HOLD_KEY_CODE } from './quit-hold.ts';

/**
 * The keys the play scene handles itself (`handleSharedEngineExitKey` and the quit hold in `play-input.ts`): ESC, F5, Space,
 * Backspace and the hi-speed arrows. The engine's web input runtime skips them ({@link shouldSkipPlayKey}), so it
 * pushes no `interrupt` / `toggle-pause` of its own.
 */
export const PLAY_SCENE_KEY_CODES: ReadonlySet<string> = new Set([
  'Escape',
  'F5',
  'Space',
  QUIT_HOLD_KEY_CODE,
  'ArrowUp',
  'ArrowDown',
]);

/**
 * The `shouldSkipKey` filter of the engine's web input runtime for a play: a key typed into a text field, or one of
 * {@link PLAY_SCENE_KEY_CODES}, is not a lane.
 */
export function shouldSkipPlayKey(event: KeyboardEvent, laneTokens: ReadonlySet<string> = new Set()): boolean {
  // Suppress lane-input dispatch when the user is typing into a focused text input (search box, etc.).
  const target = event.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable === true) return true;
  }
  // ESC and F5 are handled by the view's own listener (set up in `enter`) so the LR2 `#FADEOUT` animation
  // runs to completion BEFORE the engine's `PlayerInterruptedError` flow disposes the audio session. If
  // we let the runtime push `interrupt(escape)` directly, the engine's `dispose()` would `node.stop()`
  // every in-flight BufferSource immediately, killing the chart audio mid-fade. Same idea for Space:
  // routing the toggle through the view's `togglePause` keeps the view's `paused` flag, the audio bus's
  // suspend, the BGA video pause, and the engine's playback clock all on the same single entry-point.
  // Backspace is the view's hold-to-quit key (`QuitHoldController`), never a lane.
  if (event.code === 'F5' && laneTokens.has('f5')) return false;
  return PLAY_SCENE_KEY_CODES.has(event.code);
}
