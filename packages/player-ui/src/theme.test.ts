import { css } from 'lit';
import { describe, expect, it } from 'vite-plus/test';
import { resolveBeMusicTheme, setBeMusicTheme } from './theme.ts';

describe('Be-Music themes', () => {
  it('are headless until a theme is set for the registry', () => {
    const registry = {} as CustomElementRegistry;
    expect(resolveBeMusicTheme(registry)).toEqual([]);
    expect(resolveBeMusicTheme(undefined)).toEqual([]);
  });

  it('keep each registry’s theme apart', () => {
    const page = {} as CustomElementRegistry;
    const other = {} as CustomElementRegistry;
    const theme = [
      css`
        :host {
          color: red;
        }
      `,
    ];
    setBeMusicTheme(page, theme);
    expect(resolveBeMusicTheme(page)).toBe(theme);
    expect(resolveBeMusicTheme(other)).toEqual([]);
  });
});
