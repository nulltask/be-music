/**
 * Discovers individual LR2 themes inside a dropped file list, scoped to the canonical
 * `LR2files/Theme/<name>/` layout. Used by hosts that want to present a "which theme?" picker when the user drops
 * the whole `LR2files/Theme/` tree (e.g. someone unzipping the LR2 distribution and dropping the parent folder so
 * both `default/` and `LITONE4/` come along).
 *
 * Scope (intentional): only `LR2files/Theme/<name>/` direct children with at least one `.lr2skin` file under them
 * count as a theme. Themes nested deeper, or LR2 sound packs / BGM packs under sibling directories, are NOT
 * surfaced. The host can fall back to "treat the whole drop as one bundle" when this helper finds zero or one
 * theme.
 */

/**
 * Browser-shaped file descriptor — same shape as `Lr2SkinInputFile`'s `name` + `webkitRelativePath`. Re-typed here
 * to keep the discovery helper independent of `file-lookup.ts`'s `arrayBuffer()` requirement (we only need the
 * paths, not the bytes).
 */
export interface Lr2ThemeDiscoveryFile {
  readonly name: string;
  readonly webkitRelativePath?: string;
}

export interface Lr2DiscoveredTheme<TFile extends Lr2ThemeDiscoveryFile = Lr2ThemeDiscoveryFile> {
  /** Human-readable theme name — the subdirectory name (e.g. `"LITONE4"`, `"default"`). */
  readonly name: string;
  /** All files that belong to this theme's subtree (= every entry whose path starts with `LR2files/Theme/<name>/`). */
  readonly files: ReadonlyArray<TFile>;
}

/**
 * Case-insensitive prefix the helper matches against each file's path. Anchored to the start of the path so an
 * accidental nested `inner/LR2files/Theme/...` directory doesn't get treated as a theme root.
 */
const THEME_ROOT_PREFIX = 'lr2files/theme/';

/**
 * Walks `files` and groups them by their `LR2files/Theme/<name>/` parent directory. Returns one entry per detected
 * theme, sorted alphabetically by name.
 *
 * Each entry's `files` array is a strict subset of the input — the same File instances, not copies — so callers can
 * hand them straight to {@link loadLr2ThemeSkinsFromFiles}.
 *
 * Files that don't live under `LR2files/Theme/<name>/` at all (chart packs, song audio, etc.) are silently dropped.
 * That's the right behaviour for the picker UI: the caller already separated theme files from song files via
 * `splitDroppedSongAndThemeFiles` before invoking this.
 */
export function discoverLr2Themes<TFile extends Lr2ThemeDiscoveryFile>(
  files: Iterable<TFile>,
): ReadonlyArray<Lr2DiscoveredTheme<TFile>> {
  const themesByName = new Map<string, TFile[]>();
  // Tracks themes that contain at least one `.lr2skin`. A subdirectory with only `Screenshot/*.bmp` and no
  // `.lr2skin` isn't a theme — exclude it from the picker so the user doesn't see decorative-only folders as
  // selectable options.
  const themesWithSkin = new Set<string>();
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const lower = path.toLowerCase();
    const themeRootStart = lower.indexOf(THEME_ROOT_PREFIX);
    if (themeRootStart === -1) continue;
    // Require the prefix to be at the path root OR after a single segment (browsers prepend the dropped folder's
    // own name as the first path segment via `webkitRelativePath`, so `MyDrop/LR2files/Theme/...` is valid). Reject
    // deeper nesting to keep the contract tight.
    const beforePrefix = path.slice(0, themeRootStart);
    const slashesBefore = beforePrefix.split('/').filter((segment) => segment !== '').length;
    if (slashesBefore > 1) continue;
    const afterPrefix = path.slice(themeRootStart + THEME_ROOT_PREFIX.length);
    const slashIndex = afterPrefix.indexOf('/');
    if (slashIndex <= 0) continue; // `LR2files/Theme/foo` (file directly under Theme/, no subdir) — skip
    // The name is the subfolder under `Theme/` — preserve the original casing from the source path rather than the
    // lowercased lookup string so the picker UI shows the user's exact folder name.
    const originalAfterPrefix = path.slice(themeRootStart + THEME_ROOT_PREFIX.length);
    const themeName = originalAfterPrefix.slice(0, slashIndex);
    const key = themeName.toLowerCase();
    let bucket = themesByName.get(key);
    if (!bucket) {
      bucket = [];
      themesByName.set(key, bucket);
    }
    bucket.push(file);
    if (lower.endsWith('.lr2skin')) {
      themesWithSkin.add(key);
    }
  }
  const result: Array<Lr2DiscoveredTheme<TFile>> = [];
  // Iterate in alphabetical order so the picker dropdown is stable across drops.
  const orderedNames = [...themesWithSkin].sort((a, b) => a.localeCompare(b));
  for (const key of orderedNames) {
    const bucket = themesByName.get(key);
    if (!bucket || bucket.length === 0) continue;
    // Recover the original-cased theme name from the first file in the bucket.
    const sample = bucket[0]!;
    const samplePath = sample.webkitRelativePath || sample.name;
    const lowerSample = samplePath.toLowerCase();
    const themeRootStart = lowerSample.indexOf(THEME_ROOT_PREFIX);
    const afterPrefix = samplePath.slice(themeRootStart + THEME_ROOT_PREFIX.length);
    const slashIndex = afterPrefix.indexOf('/');
    const displayName = slashIndex > 0 ? afterPrefix.slice(0, slashIndex) : afterPrefix;
    result.push({ name: displayName, files: bucket });
  }
  return result;
}
