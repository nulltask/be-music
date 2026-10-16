const BASE62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Base-62 object keys a stitched chart can name (`01`-`zz`), the most a two-character key reaches. */
export const NONSTOP_KEY_SPACE: number = 62 * 62 - 1;

/**
 * Hands out two-character base-62 object keys (`01`, `02`, … `zz`) for one resource table of a stitched chart, one per
 * distinct source key of each stage. Returns `undefined` once the key space is used up.
 */
export class NonstopKeyAllocator {
  private next = 1;
  private readonly keys = new Map<string, string>();

  /** The stitched key for `sourceKey` of `stage`, allocating it on first use. */
  keyFor(stage: number, sourceKey: string): string | undefined {
    const id = `${stage}:${sourceKey}`;
    const known = this.keys.get(id);
    if (known !== undefined) return known;
    if (this.next > NONSTOP_KEY_SPACE) return undefined;
    const key = `${BASE62_DIGITS[Math.floor(this.next / 62)]}${BASE62_DIGITS[this.next % 62]}`;
    this.next += 1;
    this.keys.set(id, key);
    return key;
  }

  /** A fresh key not tied to a source key (stitched STOP lengths). */
  fresh(): string | undefined {
    return this.keyFor(-1, String(this.next));
  }
}
