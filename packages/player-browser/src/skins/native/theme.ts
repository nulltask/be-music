/**
 * Native's look on top of `@be-music/player-ui`'s neutral defaults: its spacing scale and type, set through the
 * elements' documented custom properties and parts. Colours stay the page's Basecoat tokens.
 */
export const NATIVE_THEME_CSS = `
[data-native-screen] {
  --be-music-screen-padding: clamp(16px, 3cqi, 36px);
  --be-music-section-gap: 24px;
  --be-music-gap: 8px;
  --be-music-panel-padding: 16px;
  --be-music-title-size: clamp(22px, 3cqi, 36px);
  --be-music-title-weight: 700;
  --be-music-title-tracking: -0.035em;
  --be-music-stat-size: clamp(28px, 4cqi, 44px);
}
[data-native-screen]::part(eyebrow) {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
`;

/** The product line over the collection's title. */
export const NATIVE_EYEBROW = 'Be-Music / Native';

const THEMED = new WeakMap<Node, { style: HTMLStyleElement; users: number }>();

/** Puts Native's theme in `container` for as long as one of its screens is mounted there; call the result to release. */
export function adoptNativeTheme(container: HTMLElement): () => void {
  let entry = THEMED.get(container);
  if (!entry) {
    const style = container.ownerDocument.createElement('style');
    style.dataset.nativeTheme = '';
    style.textContent = NATIVE_THEME_CSS;
    container.prepend(style);
    entry = { style, users: 0 };
    THEMED.set(container, entry);
  }
  entry.users += 1;
  const adopted = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    adopted.users -= 1;
    if (adopted.users === 0) {
      adopted.style.remove();
      THEMED.delete(container);
    }
  };
}
