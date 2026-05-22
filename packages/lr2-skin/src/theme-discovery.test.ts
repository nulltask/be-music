import { describe, expect, it } from 'vitest';
import { discoverLr2Themes, type Lr2ThemeDiscoveryFile } from './theme-discovery.ts';

function file(path: string): Lr2ThemeDiscoveryFile {
  return { name: path.split('/').pop() ?? path, webkitRelativePath: path };
}

describe('discoverLr2Themes', () => {
  it('returns a single theme entry when the drop contains one LR2files/Theme/<name>/ subtree', () => {
    const themes = discoverLr2Themes([
      file('LR2files/Theme/default/Select/select.lr2skin'),
      file('LR2files/Theme/default/Play/play_7.lr2skin'),
      file('LR2files/Theme/default/Decide/decide.lr2skin'),
    ]);
    expect(themes).toHaveLength(1);
    expect(themes[0]!.name).toBe('default');
    expect(themes[0]!.files).toHaveLength(3);
  });

  it('separates multiple sibling themes alphabetically', () => {
    const themes = discoverLr2Themes([
      // Sample of LITONE4's tree, plus another theme.
      file('LR2files/Theme/LITONE4/Play/AC7.lr2skin'),
      file('LR2files/Theme/LITONE4/Select/select.lr2skin'),
      file('LR2files/Theme/default/Play/play_7.lr2skin'),
      file('LR2files/Theme/default/Select/select.lr2skin'),
    ]);
    expect(themes.map((t) => t.name)).toEqual(['default', 'LITONE4']);
    expect(themes[0]!.files).toHaveLength(2);
    expect(themes[1]!.files).toHaveLength(2);
  });

  it('handles a single leading folder segment from the drop root', () => {
    // Browsers prepend the dropped folder's name to every `webkitRelativePath`. `MyDrop/LR2files/Theme/foo/...`
    // should still classify as theme `foo`. Two-deep prefixes (`a/b/LR2files/Theme/...`) are rejected by design.
    const themes = discoverLr2Themes([
      file('LR2/LR2files/Theme/foo/Select/select.lr2skin'),
      file('LR2/LR2files/Theme/foo/Play/play_7.lr2skin'),
    ]);
    expect(themes).toHaveLength(1);
    expect(themes[0]!.name).toBe('foo');
  });

  it('drops files outside LR2files/Theme/ entirely', () => {
    const themes = discoverLr2Themes([
      file('LR2files/Theme/default/Select/select.lr2skin'),
      // Decoys that should not be picked up.
      file('LR2files/Bgm/default/select.wav'),
      file('LR2files/Sound/scratch.wav'),
      file('Songs/foo/bar.bms'),
      file('readme.txt'),
    ]);
    expect(themes).toHaveLength(1);
    expect(themes[0]!.files).toHaveLength(1);
  });

  it('excludes subdirectories that have NO .lr2skin (theme-less helper folders)', () => {
    // A `Theme/Screenshots/` folder ships only thumbnails — not a real theme. The picker should hide it so the user
    // never sees a non-selectable option.
    const themes = discoverLr2Themes([
      file('LR2files/Theme/Screenshots/foo.bmp'),
      file('LR2files/Theme/LITONE4/Play/AC7.lr2skin'),
    ]);
    expect(themes.map((t) => t.name)).toEqual(['LITONE4']);
  });

  it('treats theme-name matching case-insensitively but preserves original casing in output', () => {
    // Drop with mixed-case path components must group correctly AND surface the user's original casing back via
    // `name` — the picker UI should display `"LITONE4"` not `"litone4"`.
    const themes = discoverLr2Themes([
      file('LR2files/theme/LITONE4/Play/AC7.lr2skin'),
      file('LR2FILES/THEME/litone4/Select/select.lr2skin'),
    ]);
    expect(themes).toHaveLength(1);
    expect(themes[0]!.files).toHaveLength(2);
    // Display name comes from the FIRST encountered casing.
    expect(themes[0]!.name).toBe('LITONE4');
  });

  it('returns an empty list when nothing matched', () => {
    expect(discoverLr2Themes([])).toEqual([]);
    expect(discoverLr2Themes([file('Songs/foo/bar.bms')])).toEqual([]);
  });

  it('rejects themes whose prefix is nested deeper than one extra segment', () => {
    // Pathological drop where `LR2files/Theme/` appears under multiple parent dirs — only the shallow one counts.
    const themes = discoverLr2Themes([
      file('LR2files/Theme/default/Select/select.lr2skin'), // 0 extra segments — valid
      file('drop/LR2files/Theme/extra/Select/select.lr2skin'), // 1 extra segment — valid (browser drop prefix)
      file('a/b/LR2files/Theme/buried/Select/select.lr2skin'), // 2 extra segments — rejected
    ]);
    expect(themes.map((t) => t.name).sort()).toEqual(['default', 'extra']);
  });
});
