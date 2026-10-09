import { validateBeMusicSkin, type BeMusicSelectLayout, type BeMusicSkin } from '@be-music/skin-sdk';
import { logger } from '../../logger.ts';

export { resolveBeMusicLaneKind } from '@be-music/skin-sdk';

const log = logger('be-music-skin');

export interface BeMusicSkinRegistry {
  /** Every registered skin, in registration order (a skin added later with a known id keeps its place). */
  readonly skins: readonly BeMusicSkin[];
  /** The skin with `id`, or the first registered skin when `id` is unknown / undefined. */
  resolve(id: string | undefined): BeMusicSkin;
  /**
   * Registers another skin — a third-party one, or an optional built-in such as `latticeSkin`. The skin is validated
   * like the initial ones (see `validateBeMusicSkin`); a skin with an id already registered replaces that one (handy
   * when reloading a skin under development). Returns the problems that kept the skin out, empty when it was added.
   */
  add(skin: BeMusicSkin): string[];
  /** Calls `listener` after every successful {@link add}; returns the function that stops it. */
  subscribe(listener: () => void): () => void;
}

export interface BeMusicSkinRegistryOptions {
  /**
   * Called for each skin left out because its declaration is invalid or written for an unsupported API revision (see
   * `validateBeMusicSkin`). Defaults to a logged warning.
   */
  onRejected?: (skin: BeMusicSkin, problems: readonly string[]) => void;
}

/**
 * Registry over a skin list that hosts can extend with {@link BeMusicSkinRegistry.add}. Skins whose declaration doesn't validate (an unsupported `apiVersion`, a malformed
 * id or version, …) are left out, so a third-party skin built for another player release can't break the host. The
 * first accepted entry is the fallback for unknown ids; at least one must be accepted.
 */
export function createBeMusicSkinRegistry(
  candidates: readonly BeMusicSkin[],
  options: BeMusicSkinRegistryOptions = {},
): BeMusicSkinRegistry {
  const onRejected =
    options.onRejected ??
    ((skin: BeMusicSkin, problems: readonly string[]) =>
      log.warn(`skipping skin "${skin.id}": ${problems.join('; ')}`));
  const skins = candidates.filter((skin) => {
    const problems = validateBeMusicSkin(skin);
    if (problems.length > 0) onRejected(skin, problems);
    return problems.length === 0;
  });
  const first = skins[0];
  if (!first) {
    throw new Error('createBeMusicSkinRegistry: at least one valid skin is required');
  }
  const byId = new Map<string, BeMusicSkin>();
  for (const skin of skins) {
    if (byId.has(skin.id)) {
      throw new Error(`createBeMusicSkinRegistry: duplicate skin id "${skin.id}"`);
    }
    byId.set(skin.id, skin);
  }
  const listeners = new Set<() => void>();
  return {
    get skins() {
      return [...byId.values()];
    },
    resolve: (id) => (id !== undefined ? byId.get(id) : undefined) ?? byId.values().next().value ?? first,
    add(skin) {
      const problems = validateBeMusicSkin(skin);
      if (problems.length > 0) return problems;
      byId.set(skin.id, skin);
      for (const listener of listeners) listener();
      return [];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The slice of the entry list the select renderer draws: keeps the focused row near the vertical centre, clamped so
 * the window never scrolls past either end. Shared by rendering and row hit-testing so both agree on row positions.
 */
export function resolveSelectListWindow(
  layout: BeMusicSelectLayout,
  designHeight: number,
  selectedIndex: number,
  entryCount: number,
): { firstVisibleIndex: number; visibleRows: number } {
  const listBottom = designHeight - layout.listBottomInset;
  const visibleRows = Math.max(1, Math.floor((listBottom - layout.listTop) / layout.rowHeight));
  const firstVisibleIndex = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, entryCount - visibleRows)),
  );
  return { firstVisibleIndex, visibleRows };
}
