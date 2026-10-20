/**
 * The select screen's empty-library hint: the line a theme's select draws in the middle of its frame while no chart is
 * loaded, with the count of files that failed to parse.
 *
 * It draws into the scene's skin layer and reads the library through {@link SelectEmptyHintContext}; the select scene
 * passes it.
 */

import { Color, type Container, Text, TextStyle } from 'pixi.js';
import type { BrowserChartCollection } from '../../collection/types.ts';
import { CORE_TEXT_FONT } from '../shared/fonts.ts';

const TEXT = new Color('#f6f2e8');
const MUTED = new Color('#a9a39a');

/** What the empty-library hint reads and draws into on the select scene: its fields of these names. */
export interface SelectEmptyHintContext {
  readonly skinLayer: Container;
  readonly collection: BrowserChartCollection;
}

/**
 * Renders a centered hint over the skin layer when no songs are loaded so the user understands the empty bar list
 * isn't a bug. Drawn straight onto `skinLayer` — same coordinate space as the static frame — so it scales with the
 * rest of the skin. Themes call this from {@link renderTheme}; the be-music path leaves the empty-library callout to
 * the host's drop overlay.
 */
export function renderEmptyStateHint(ctx: SelectEmptyHintContext, designWidth: number, designHeight: number): void {
  const text = new Text({
    text: 'Drop a BMS folder or ZIP onto this window',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 16,
      fontWeight: '700',
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  text.label = 'empty-state/hint';
  text.anchor.set(0.5, 0.5);
  text.position.set(designWidth / 2, designHeight / 2);
  ctx.skinLayer.addChild(text);
  if (ctx.collection.errors.length > 0) {
    const errorText = new Text({
      text: `${ctx.collection.errors.length} parse error${ctx.collection.errors.length === 1 ? '' : 's'} — see console`,
      style: new TextStyle({
        fill: MUTED,
        fontSize: 11,
        fontFamily: CORE_TEXT_FONT,
      }),
    });
    errorText.label = 'empty-state/errors';
    errorText.anchor.set(0.5, 0);
    errorText.position.set(designWidth / 2, designHeight / 2 + 18);
    ctx.skinLayer.addChild(errorText);
  }
}
