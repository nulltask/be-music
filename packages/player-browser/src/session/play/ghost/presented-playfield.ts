/**
 * A playfield presented over the live play: the play with a few of its members answered in their place, which is how a
 * ghost adds what it draws to the live play without touching it (`SidePlayfieldGhost.present`,
 * `LaneOverlayGhost.present`). The proxy is kept per play, so the view's per-play caches hold across frames.
 */

import type { PlayfieldRuntime } from '../../../view/shared/playfield/context.ts';

/** The members of the live play a presented playfield answers in its place. */
export type PlayfieldOverrides = Partial<Record<keyof PlayfieldRuntime, unknown>>;

/** One cached presented playfield: the overrides are rewritten each frame, the proxy kept while the play is the same. */
export class PresentedPlayfield {
  private presented: { play: PlayfieldRuntime; overrides: PlayfieldOverrides; runtime: PlayfieldRuntime } | undefined;

  /** `play` with `overrides` in place of its members of those names (the same proxy for the same play). */
  public present(play: PlayfieldRuntime, overrides: PlayfieldOverrides): PlayfieldRuntime {
    if (this.presented?.play !== play) {
      const kept: PlayfieldOverrides = {};
      this.presented = { play, overrides: kept, runtime: presentWith(play, kept) };
    }
    Object.assign(this.presented.overrides, overrides);
    return this.presented.runtime;
  }
}

/**
 * `play` with `overrides` in place of its members of those names. Everything else is the live play's own, methods
 * bound to it, so the view's writes (its lanes, its BGA videos) still land on the play.
 */
function presentWith(play: PlayfieldRuntime, overrides: PlayfieldOverrides): PlayfieldRuntime {
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(play, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key as keyof PlayfieldRuntime];
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      let method = bound.get(key);
      if (method === undefined) {
        method = (value as (...args: unknown[]) => unknown).bind(target);
        bound.set(key, method);
      }
      return method;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value, target);
    },
  });
}
