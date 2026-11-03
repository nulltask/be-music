// Keeps the last text textures no `Text` uses any more, so a string that comes back draws without rasterizing again.
//
// Pixi's text system shares one rasterized texture per text, style and resolution, and returns it to the pool the moment
// its last `Text` lets go. A HUD whose digits change every frame lets go of a digit each time it leaves the readout and
// rasterizes it again when it comes back: on Safari, whose canvas text (with a blurred glow above all) is several times
// slower than Chromium's, that alone took a large share of a gameplay frame. Wrapped here, a texture whose last user
// lets go stays registered at zero users, and only the oldest of them go back to the pool once more than `capacity`
// wait.

/** One shared text texture, as Pixi's text system tracks it. */
interface ActiveTextTexture {
  texture: unknown;
  usageCount: number;
}

/** The members of Pixi's text system (`renderer.canvasText`) this wraps. */
export interface RetainableTextSystem {
  _activeTextures: Record<string, ActiveTextTexture | null>;
  decreaseReferenceCount: (textKey: string) => void;
  _increaseReferenceCount: (textKey: string) => void;
  returnTexture: (texture: unknown) => void;
}

/** Released textures kept by default: a HUD's digits and labels in a few styles, at a few hundred KB. */
export const RETAINED_TEXT_TEXTURES = 128;

/**
 * Makes `system` keep up to `capacity` textures no text uses any more (the least recently released go first). Returns
 * a function that puts the original methods back and releases what is kept. A system without the members it relies on
 * is left alone.
 */
export function retainReleasedTextTextures(
  system: Partial<RetainableTextSystem> | undefined,
  capacity: number = RETAINED_TEXT_TEXTURES,
): () => void {
  if (
    system === undefined ||
    typeof system.decreaseReferenceCount !== 'function' ||
    typeof system._increaseReferenceCount !== 'function' ||
    typeof system.returnTexture !== 'function' ||
    typeof system._activeTextures !== 'object' ||
    system._activeTextures === null
  ) {
    return () => undefined;
  }
  const target = system as RetainableTextSystem;
  const decrease = target.decreaseReferenceCount;
  const increase = target._increaseReferenceCount;
  /** Keys held at zero users, oldest release first. */
  const retained = new Map<string, true>();

  const release = (key: string): void => {
    retained.delete(key);
    const entry = target._activeTextures?.[key];
    if (entry && entry.usageCount === 0) {
      target.returnTexture(entry.texture);
      target._activeTextures[key] = null;
    }
  };

  target.decreaseReferenceCount = function (this: RetainableTextSystem, textKey: string): void {
    const entry = this._activeTextures[textKey];
    if (!entry || entry.usageCount > 1) {
      decrease.call(this, textKey);
      return;
    }
    // The last user let go: keep the texture registered, at zero users, for a string that comes back.
    entry.usageCount = 0;
    retained.delete(textKey);
    retained.set(textKey, true);
    while (retained.size > capacity) {
      const oldest = retained.keys().next().value;
      if (oldest === undefined) break;
      release(oldest);
    }
  };
  target._increaseReferenceCount = function (this: RetainableTextSystem, textKey: string): void {
    // A kept texture is in use again.
    retained.delete(textKey);
    increase.call(this, textKey);
  };

  return () => {
    target.decreaseReferenceCount = decrease;
    target._increaseReferenceCount = increase;
    for (const key of retained.keys()) release(key);
  };
}
