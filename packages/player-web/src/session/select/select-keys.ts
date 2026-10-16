/**
 * The select screen's keyboard. ↑ / ↓ move the cursor, Enter opens the folder or starts the bar under it, and Escape,
 * Backspace or ← back out of a folder. Space opens and closes the play-options panel; while it is open the 1P lane keys
 * step its options, and Escape closes an open panel. While the README overlay is open, the keys scroll or close it.
 *
 * The keyboard reads and drives the select scene through {@link SelectKeysContext}; the scene passes it.
 */

import { GAUGE_TYPES } from '@be-music/player/ruleset';
import { BOOLEAN_CYCLE, RANDOM_CYCLE } from '@be-music/scene-model';
import type { PixiPlayOptions } from '../../scene/core/select.ts';

/**
 * Pixel scroll step for the readtext modal's arrow-key nudge — roughly two lines at the body's 14px / 18px line-height.
 * Wheel input uses the browser's native `deltaY` (already in pixels) so it doesn't need this constant.
 */
const READTEXT_LINE_SCROLL = 36;
/**
 * PageUp / PageDown / Space scroll step — most of a viewport, leaving a couple of lines of overlap so the user can
 * re-find their place after the jump.
 */
const READTEXT_PAGE_SCROLL = 360;

/** What the keyboard reads and drives on the select scene: its fields and methods of these names. */
export interface SelectKeysContext {
  /** When a launch whose be-music outro is still playing started, else `undefined`; the keys wait for it. */
  readonly launchAt: number | undefined;
  /** Whether the select is the scene showing; the keys are ignored while it is off stage. */
  readonly visible: boolean;
  /** Whether the README overlay is open; the keys then scroll or close it. */
  readonly readTextOpen: boolean;
  /** The LR2 option panels open. */
  readonly panelStates: ReadonlySet<number>;
  startSelectBgm(): Promise<void>;
  togglePanel(which: number): void;
  closeReadText(): void;
  scrollReadText(delta: number): void;
  cyclePlayOption<K extends keyof PixiPlayOptions>(key: K, cycle: readonly PixiPlayOptions[K][]): void;
  adjustHiSpeed(direction: 1 | -1): void;
  /** Moves the cursor one bar, wrapping past either end (`SelectSession.stepCursor`). */
  stepCursor(direction: 1 | -1): void;
  /** Opens the folder or starts the bar under the cursor (`SelectSession.activateFocused`). */
  activateFocused(): void;
  /** Backs out of the folder shown; `false` at the root (`SelectSession.leaveFolder`). */
  leaveFolder(): boolean;
}

/** The select screen's keyboard. See the module comment. */
export class SelectKeys {
  private readonly ctx: SelectKeysContext;

  public constructor(ctx: SelectKeysContext) {
    this.ctx = ctx;
  }

  readonly handleKeyDown = (event: KeyboardEvent): void => {
    // A launch outro is playing — the chart is already chosen.
    if (this.ctx.launchAt !== undefined) {
      return;
    }
    // Same gesture-retry as `handlePointerDown` — most users will arrive at the select view via the keyboard rather
    // than a mouse on macOS / touchpad-only devices, so we hook here too.
    void this.ctx.startSelectBgm();
    // Don't navigate while the view is hidden — e.g. when gameplay is on top. Both views attach `keydown` to the window
    // so they can capture input without canvas focus, but only the visible one should react.
    if (!this.ctx.visible) {
      return;
    }
    // Skip when the user is typing into a form / contenteditable element so arrow keys / Enter aren't hijacked from
    // text input.
    if (isEditableTarget(event.target)) {
      return;
    }
    // Space toggles LR2 panel 1 (the play-options panel by convention — LR2SkinHelp line 9101: only the song-select skin
    // supports invoking panel 1 via the start button). We bind it to Space rather than Enter because Enter is already the song-pick /
    // folder-enter accelerator on this view.
    if (event.code === 'Space') {
      event.preventDefault();
      this.ctx.togglePanel(1);
      return;
    }
    // While the README modal is open it owns the keyboard. LR2's canonical close key is Enter (the decide / confirm
    // key); from the keyboard: - Enter / Backspace close it. Enter is the LR2-faithful shortcut hinted in the modal
    // footer; Backspace is a secondary "go back" alias. Esc is intentionally NOT bound — LR2 doesn't use it for panel
    // close, and reusing it here would diverge from the host's skin-faithful interaction model. - ↑ / ↓ / PageUp /
    // PageDown / Home / End / Space scroll the body. Falling through to the cursor-move handlers would defeat the modal
    // — the bar cursor would race past songs while the user is just trying to read the note.
    if (this.ctx.readTextOpen) {
      if (event.key === 'Backspace' || event.key === 'Enter') {
        event.preventDefault();
        this.ctx.closeReadText();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.ctx.scrollReadText(READTEXT_LINE_SCROLL);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.ctx.scrollReadText(-READTEXT_LINE_SCROLL);
        return;
      }
      if (event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        this.ctx.scrollReadText(READTEXT_PAGE_SCROLL);
        return;
      }
      if (event.key === 'PageUp') {
        event.preventDefault();
        this.ctx.scrollReadText(-READTEXT_PAGE_SCROLL);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        this.ctx.scrollReadText(-Number.MAX_SAFE_INTEGER);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        this.ctx.scrollReadText(Number.MAX_SAFE_INTEGER);
        return;
      }
      // Any other key — swallow so it doesn't leak through to the panel / cursor handlers below.
      return;
    }
    // While any panel is open, Escape closes it instead of popping a folder. Mirrors LR2: right-click on a panel (or
    // re-clicking its launcher button) closes it; here we accept Escape too so keyboard-only users have a back-out
    // shortcut.
    if (event.key === 'Escape' && this.ctx.panelStates.size > 0) {
      event.preventDefault();
      // Close panels in numeric order — picking the lowest-numbered open panel matches "Esc closes the topmost /
      // most-recent" expectation on the common case where only panel 1 is open.
      const sorted = [...this.ctx.panelStates].sort((a, b) => a - b);
      const target = sorted[0];
      if (target !== undefined) this.ctx.togglePanel(target);
      return;
    }
    // HS adjustment via the 1P 5 / 7 lane keys (LR2 convention: pressing the 5-key inside the play-options panel
    // decreases HiSpeed, the 7-key increases it). Bindings follow the common gameplay lane convention — PLAY
    // OPTIONS panel (panel 1) keyboard shortcuts. While the panel is open, each 7K lane key cycles a corresponding play
    // option — same "adjacent-key shortcuts" family LR2 hardcodes for option panels. The mapping mirrors the panel's
    // visible button layout:
    //
    // LANE 1 (KeyZ) → PLAY STYLE (`dpFlip` toggle) LANE 2 (KeyS) → RANDOM (`random1P` cycle) LANE 3 (KeyX) → BATTLE
    // (`random2P` cycle — DP-side independent random is the canonical "battle" effect) LANE 4 (KeyD) → GAUGE (`gauge1P`
    // cycle) LANE 5 (KeyC) → HI-SPD ↓ (`adjustHiSpeed(-1)`) LANE 6 (KeyF) → ASSIST (`autoScratch1P` toggle) LANE 7
    // (KeyV) → HI-SPD ↑ (`adjustHiSpeed(+1)`)
    //
    // Only fires while panel 1 is open so the keys remain free outside the play-options context.
    if (this.ctx.panelStates.has(1)) {
      if (event.code === 'KeyZ') {
        event.preventDefault();
        this.ctx.cyclePlayOption('dpFlip', BOOLEAN_CYCLE);
        return;
      }
      if (event.code === 'KeyS') {
        event.preventDefault();
        this.ctx.cyclePlayOption('random1P', RANDOM_CYCLE);
        return;
      }
      if (event.code === 'KeyX') {
        event.preventDefault();
        this.ctx.cyclePlayOption('random2P', RANDOM_CYCLE);
        return;
      }
      if (event.code === 'KeyD') {
        event.preventDefault();
        this.ctx.cyclePlayOption('gauge1P', GAUGE_TYPES);
        return;
      }
      if (event.code === 'KeyC') {
        event.preventDefault();
        this.ctx.adjustHiSpeed(-1);
        return;
      }
      if (event.code === 'KeyF') {
        event.preventDefault();
        this.ctx.cyclePlayOption('autoScratch1P', BOOLEAN_CYCLE);
        return;
      }
      if (event.code === 'KeyV') {
        event.preventDefault();
        this.ctx.adjustHiSpeed(1);
        return;
      }
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Wrap past the end → first entry. Matches LR2's circular bar list (the rail keeps scrolling forever in either
      // direction). The slide always follows the key, even where the cursor wraps on a short list: the user pressed
      // down, so the bars slide as if going down.
      this.ctx.stepCursor(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.ctx.stepCursor(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.ctx.activateFocused();
    } else if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'ArrowLeft') {
      // Pop one level up — Esc / Backspace / ← all back out of the current folder. No-op at the root so the user
      // doesn't get stuck on an "empty list" view by accident.
      if (!this.ctx.leaveFolder()) return;
      event.preventDefault();
    }
  };
}

/**
 * Returns `true` when the keydown target is a text-editable element (`<input>` / `<textarea>` / `<select>` /
 * `contenteditable`). The select view's keyboard handlers use this to bail so the user can type into form fields
 * without arrow keys hijacking the bar list.
 *
 * `<input type="checkbox">` / `<input type="file">` pass through — those don't capture text input and the user expects
 * arrow keys to still drive the song list while a checkbox happens to be focused.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type.toLowerCase();
    // text-like input types we want to leave alone.
    return (
      type === 'text' ||
      type === 'search' ||
      type === 'url' ||
      type === 'email' ||
      type === 'password' ||
      type === 'number' ||
      type === 'tel' ||
      type === ''
    );
  }
  return false;
}
