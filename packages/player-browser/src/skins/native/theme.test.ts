import { describe, expect, it, vi } from 'vite-plus/test';
import { NATIVE_THEME_CSS, adoptNativeTheme } from './theme.ts';

function fakeContainer() {
  const styles: { dataset: Record<string, string>; textContent: string; remove: ReturnType<typeof vi.fn> }[] = [];
  const container = {
    ownerDocument: {
      createElement: () => {
        const style = { dataset: {}, textContent: '', remove: vi.fn() };
        styles.push(style);
        return style;
      },
    },
    prepend: vi.fn(),
  };
  return { container: container as unknown as HTMLElement, styles };
}

describe('adoptNativeTheme', () => {
  it('adds one theme style per container and removes it when the last screen releases it', () => {
    const { container, styles } = fakeContainer();
    const releaseSelect = adoptNativeTheme(container);
    const releaseHUD = adoptNativeTheme(container);
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(NATIVE_THEME_CSS);
    releaseSelect();
    releaseSelect();
    expect(styles[0]!.remove).not.toHaveBeenCalled();
    releaseHUD();
    expect(styles[0]!.remove).toHaveBeenCalledTimes(1);
    adoptNativeTheme(container);
    expect(styles).toHaveLength(2);
  });

  it('sets the spacing and type only through player-ui custom properties and parts', () => {
    const properties = [...NATIVE_THEME_CSS.matchAll(/(--[\w-]+):/g)].map((match) => match[1]);
    expect(properties.length).toBeGreaterThan(0);
    expect(properties.every((name) => name!.startsWith('--be-music-'))).toBe(true);
    expect(NATIVE_THEME_CSS).toContain('::part(eyebrow)');
  });
});
