import type { IndexedImage } from './png.ts';

/**
 * RGBA pixels (alpha ignored) as a palette image of at most `maxColors` colours, for the chart card's background that
 * scripts/build-icons.ts renders. Colours are grouped by their top 6 bits per channel; the most common groups become
 * the palette (each the average of its pixels), and every other group takes the nearest of them. Good enough for a
 * dark gradient with antialiased text, which is all the background holds.
 */
export function quantize(rgba: Uint8Array, width: number, height: number, maxColors: number): IndexedImage {
  const count = width * height;
  const keys = new Uint32Array(count);
  const groups = new Map<number, { pixels: number; r: number; g: number; b: number }>();
  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    keys[i] = key;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { pixels: 1, r, g, b });
    else {
      group.pixels++;
      group.r += r;
      group.g += g;
      group.b += b;
    }
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].pixels - a[1].pixels || a[0] - b[0]);
  const kept = ranked.slice(0, maxColors);
  const palette = new Uint8Array(kept.length * 3);
  kept.forEach(([, group], i) => {
    palette[i * 3] = Math.round(group.r / group.pixels);
    palette[i * 3 + 1] = Math.round(group.g / group.pixels);
    palette[i * 3 + 2] = Math.round(group.b / group.pixels);
  });
  const indexOf = new Map<number, number>(kept.map(([key], i) => [key, i]));
  for (const [key, group] of ranked.slice(maxColors)) {
    const [r, g, b] = [group.r / group.pixels, group.g / group.pixels, group.b / group.pixels];
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < kept.length; i++) {
      const distance =
        (r - (palette[i * 3] ?? 0)) ** 2 + (g - (palette[i * 3 + 1] ?? 0)) ** 2 + (b - (palette[i * 3 + 2] ?? 0)) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    indexOf.set(key, best);
  }
  const pixels = new Uint8Array(count);
  for (let i = 0; i < count; i++) pixels[i] = indexOf.get(keys[i] ?? 0) ?? 0;
  return { width, height, palette, pixels };
}
