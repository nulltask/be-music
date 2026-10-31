import type { BeMusicJSON } from '@be-music/chart-source';
import { parseBMSExBMP, type BmsARGB } from './bmp-directives.ts';

/** Resolve a selected EXBMP image's strict decimal color key, without the legacy tint parser's defaults/clamping. */
export function resolveBMSExBMPColorKey(chart: BeMusicJSON, slot: string): BmsARGB | undefined {
  const definition = parseBMSExBMP(chart.bms.exBMP[slot] ?? '');
  if (!definition) return undefined;
  const explicit = chart.resources.bmp[slot];
  if (explicit && explicit !== definition.filename) return undefined;
  const fields = definition.argbRaw.split(',').map((field) => field.trim());
  if (fields.length !== 4 || fields.some((field) => !/^\d+$/u.test(field) || Number(field) > 255)) return undefined;
  const [a, r, g, b] = fields.map(Number);
  return { a: a!, r: r!, g: g!, b: b! };
}

/**
 * Remove EXBMP's transparent-color region from owned RGBA8 pixels in place. RGB matches within ±8 per component;
 * a source alpha channel must match exactly. Images without an alpha channel compare against alpha zero, rather
 * than the opaque 255 inserted by an RGBA decoder. The all-zero tuple disables color keying. Other pixels retain
 * their RGB and source alpha; this operation never multiplies colors or applies whole-image opacity.
 */
export function applyBMSColorKey(rgba: Uint8Array | Uint8ClampedArray, key: BmsARGB, hasAlphaChannel: boolean): void {
  if (![key.a, key.r, key.g, key.b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return;
  if (key.a === 0 && key.r === 0 && key.g === 0 && key.b === 0) return;
  if (!hasAlphaChannel && key.a !== 0) return;
  for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
    if (hasAlphaChannel && rgba[offset + 3] !== key.a) continue;
    if (
      Math.abs(rgba[offset]! - key.r) <= 8 &&
      Math.abs(rgba[offset + 1]! - key.g) <= 8 &&
      Math.abs(rgba[offset + 2]! - key.b) <= 8
    )
      rgba[offset + 3] = 0;
  }
}
