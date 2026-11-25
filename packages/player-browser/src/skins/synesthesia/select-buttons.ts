import type { Container, Graphics } from 'pixi.js';
import type { SkinTextOptions } from '../pixi-kit/index.ts';
import { drawReticle } from './draw.ts';
import { SYN_DISPLAY_FONT, SYN_MIST, SYN_VOID, SYN_WHITE } from './style.ts';

type AddText = (text: string, x: number, y: number, options?: SkinTextOptions) => Container;

/**
 * Whether PLAY and AUTO can start something from the bar under the cursor: a chart or a course. A folder, or no bar at
 * all, starts nothing, so the buttons are drawn faint and take no click, as PRACTICE is without a chart. A course whose
 * stages are missing stays enabled: starting it says why it cannot run.
 */
export function canStartFocusedEntry(focused: { readonly chart?: unknown; readonly course?: unknown }): boolean {
  return focused.chart !== undefined || focused.course !== undefined;
}

/**
 * PLAY: a glowing pill in the accent colour with corner reticles, at (`x`, `y`) `w` × `h` with the fill inset by 4. A
 * disabled one is a faint outline, like a disabled secondary button.
 */
export function drawPlayButton(
  chrome: Graphics,
  addText: AddText,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: number,
  enabled: boolean,
): void {
  if (enabled) {
    chrome.rect(x, y, w, h).fill({ color: accent, alpha: 0.16 });
    chrome.rect(x + 4, y + 4, w - 8, h - 8).fill({ color: accent, alpha: 0.88 });
    drawReticle(chrome, x, y, w, h, SYN_WHITE, 0.95, { arm: 8, width: 1.5 });
  } else {
    chrome.rect(x + 4, y + 4, w - 8, h - 8).stroke({ color: SYN_MIST, width: 1, alpha: 0.15 });
    drawReticle(chrome, x, y, w, h, SYN_MIST, 0.25, { arm: 8, width: 1.5 });
  }
  addText('PLAY', x + w / 2, y + h / 2, {
    size: 14,
    fill: enabled ? SYN_VOID : SYN_MIST,
    fontFamily: SYN_DISPLAY_FONT,
    letterSpacing: 6,
    anchorX: 0.5,
    anchorY: 0.5,
    alpha: enabled ? 1 : 0.3,
  });
}

/**
 * A secondary button (PRACTICE, AUTO, README): an outline with corner reticles and its label centred in the display
 * face. A disabled one (nothing to start, a chart with no README) is drawn faint.
 */
export function drawSecondaryButton(
  chrome: Graphics,
  addText: AddText,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  enabled: boolean,
  letterSpacing = 3,
): void {
  chrome.rect(x, y, w, h).stroke({ color: SYN_MIST, width: 1, alpha: enabled ? 0.45 : 0.15 });
  drawReticle(chrome, x, y, w, h, SYN_MIST, enabled ? 0.8 : 0.25, { arm: 5, width: 1 });
  addText(label, x + w / 2, y + h / 2, {
    size,
    fill: SYN_MIST,
    fontFamily: SYN_DISPLAY_FONT,
    letterSpacing,
    anchorX: 0.5,
    anchorY: 0.5,
    alpha: enabled ? 1 : 0.3,
  });
}
