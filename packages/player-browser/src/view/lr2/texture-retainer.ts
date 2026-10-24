import type { Texture } from 'pixi.js';
import type { LR2Skin } from '@be-music/skin-lr2';
import { releaseTexturesOnHost, type TextureReleaseHost } from '../../stage/pixi-utils.ts';

/**
 * LR2 play-skin textures kept while a play switches families. PixiJS v8 crashes when the same bytes are decoded again
 * after `texture.destroy(true)`, so a skin's textures stay here until the play itself is disposed. Switching back to
 * a skin adopts the same textures instead of decoding them again.
 */
export class LR2TextureRetainer {
  private readonly kept = new Map<LR2Skin, Map<string, Texture>>();

  /** The textures parked for `skin`, removed from the retainer so the view owns them. */
  public adopt(skin: LR2Skin): Map<string, Texture> | undefined {
    const textures = this.kept.get(skin);
    if (textures === undefined) return undefined;
    this.kept.delete(skin);
    return textures;
  }

  /** Parks `textures` under `skin`. A path already parked keeps its texture; the new one is left for the caller. */
  public keep(skin: LR2Skin, textures: ReadonlyMap<string, Texture>): Map<string, Texture> {
    let kept = this.kept.get(skin);
    if (kept === undefined) {
      kept = new Map();
      this.kept.set(skin, kept);
    }
    const dropped = new Map<string, Texture>();
    for (const [path, texture] of textures) {
      const current = kept.get(path);
      if (current === undefined) kept.set(path, texture);
      else if (current !== texture) dropped.set(path, texture);
    }
    return dropped;
  }

  /** Destroys every parked texture. The play is over, so nothing will decode these bytes again. */
  public destroyAll(host: TextureReleaseHost | undefined): void {
    const textures: Texture[] = [];
    for (const kept of this.kept.values()) textures.push(...kept.values());
    this.kept.clear();
    releaseTexturesOnHost(host, textures);
  }
}
