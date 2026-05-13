/**
 * Skin family abstraction. Each "family" describes one of the three rendering paths the web player supports:
 *
 * - `'lr2'` — Lunatic Rave 2 skins (`.lr2skin` + bitmap atlases). Loaded via `@be-music/lr2-skin`.
 * - `'beatoraja'` — beatoraja Lua skins (`.luaskin` + texture atlases). Loaded via `@be-music/beatoraja-skin`.
 * - `'default'` — the built-in chrome used when neither LR2 nor beatoraja is supplied. Has no theme to load.
 *
 * Before this abstraction the demo branched ad-hoc on `canPlaySongBeatoraja(song)` / `decideSkin !== undefined` /
 * `selectSkin !== undefined` at every transition point (drop routing, scene construction, theme detection). Funnelling
 * those checks through a single registry makes the policy explicit (which family takes precedence when both themes are
 * loaded? answer: the registry's iteration order) and adding a fourth family in the future a localised change instead
 * of an N-place edit.
 *
 * **Note on scope:** This module deliberately does **not** include scene-factory methods. The four scene kinds
 * (`select` / `decide` / `gameplay` / `result`) take very different construction arguments between families (LR2 takes
 * `Lr2Skin`; beatoraja takes a pre-decoded texture cache + Lua-evaluated skin config; default takes neither) so a
 * single union-typed factory would push complexity onto every caller. The host instead picks the family via the
 * registry and then constructs the family's scene classes directly — they live in `scene/{lr2,beatoraja,default}/` and
 * are exported from the package root.
 */
export type SkinFamilyId = 'lr2' | 'beatoraja' | 'default';

export interface SkinFamily {
  /** Stable identifier — used by the host for routing decisions and debug logging. */
  readonly id: SkinFamilyId;
  /** Human-readable label for status text / error messages. Not used in routing logic. */
  readonly label: string;
  /**
   * Predicate over a dropped file's normalized path. Returns `true` when the file looks like an entry for this
   * family's theme (e.g. `.lr2skin` for LR2, `.luaskin` / `skin/*.json` for beatoraja).
   *
   * Optional — the default family is the fallthrough and never matches a dropped file directly; the host falls back
   * to it when no other family claims the drop.
   */
  matchesThemeFile?(path: string): boolean;
}

/**
 * Look-up surface over a fixed list of registered families. The iteration order of `families` defines the priority
 * when multiple families could theoretically claim a drop (today none overlap, but the contract documents the
 * tie-break for future additions).
 */
export interface SkinFamilyRegistry {
  readonly families: readonly SkinFamily[];
  /** Returns the family with the given id, or `undefined` if not registered. */
  byId(id: SkinFamilyId): SkinFamily | undefined;
  /**
   * Returns the first registered family whose `matchesThemeFile` returns `true` for this path, or `undefined` if
   * none claims it. The default family is intentionally NEVER returned from this method — it owns no theme files.
   */
  detectThemeFile(path: string): SkinFamily | undefined;
  /**
   * Inspects an entire dropped file list and returns the set of family ids whose `matchesThemeFile` matched any
   * entry. Used by hosts that want to know "does this drop carry an LR2 theme, a beatoraja theme, or both?"
   * before dispatching to the per-family loader.
   */
  detectThemeFamilies(paths: Iterable<string>): Set<SkinFamilyId>;
}

export function createSkinFamilyRegistry(families: readonly SkinFamily[]): SkinFamilyRegistry {
  return {
    families,
    byId(id) {
      return families.find((family) => family.id === id);
    },
    detectThemeFile(path) {
      for (const family of families) {
        if (family.matchesThemeFile?.(path) === true) return family;
      }
      return undefined;
    },
    detectThemeFamilies(paths) {
      const matched = new Set<SkinFamilyId>();
      for (const path of paths) {
        for (const family of families) {
          if (matched.has(family.id)) continue;
          if (family.matchesThemeFile?.(path) === true) {
            matched.add(family.id);
          }
        }
      }
      return matched;
    },
  };
}
