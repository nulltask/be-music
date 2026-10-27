import type { CSSResultOrNative } from 'lit';

/**
 * Style sheets a theme adds to every Be-Music element's shadow root, after the element's own structural styles. The
 * elements ship headless: layout, scrolling and sizing only. Colour, borders, backgrounds and type come from a theme
 * (such as `@be-music/player-ui/themes/basecoat`), from inherited custom properties, and from `::part` rules outside.
 */
export type BeMusicTheme = readonly CSSResultOrNative[];

const THEMES = new WeakMap<object, BeMusicTheme>();

/** Sets the theme elements of `registry` take when they render for the first time; elements already shown keep theirs. */
export function setBeMusicTheme(registry: CustomElementRegistry, theme: BeMusicTheme): void {
  THEMES.set(registry, theme);
}

/** The theme set for `registry`, or none. */
export function resolveBeMusicTheme(registry: CustomElementRegistry | undefined): BeMusicTheme {
  return (registry && THEMES.get(registry)) ?? [];
}
