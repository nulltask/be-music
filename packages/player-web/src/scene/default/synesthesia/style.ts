import { Texture } from 'pixi.js';

/**
 * Synesthesia skin tokens, after Rez Infinite's Area X: a true-black void, a world built from ember / gold particles,
 * electric blue and magenta as the only cool accents, and hairline frames with lock-on corners instead of glass.
 * Type is wide and light — Michroma for Latin labels and numerals, M PLUS 1p Light for Japanese and titles.
 */
export const SYN_VOID = 0x010000;
export const SYN_DEEP = 0x0c0402;
export const SYN_INDIGO = 0x1a0904;
export const SYN_GLASS = 0x060302;
/** Electric blue — the cool accent (black keys, below-clear gauge, FAST). */
export const SYN_CYAN = 0x46c4ff;
export const SYN_MAGENTA = 0xff3d9e;
export const SYN_EMBER = 0xff6a14;
export const SYN_AMBER = 0xffb23a;
export const SYN_FLARE = 0xffe7b8;
export const SYN_VIOLET = 0x9c7cff;
export const SYN_GREEN = 0x7dffb4;
export const SYN_RED = 0xff4a4a;
export const SYN_WHITE = 0xffffff;
export const SYN_MIST = 0xf1dcc8;
export const SYN_DIM = 0x9a7a66;

export const SYN_DISPLAY_FONT = 'Michroma, Exo 2, M PLUS 1p, LINE Seed JP, sans-serif';
export const SYN_TEXT_FONT = 'M PLUS 1p, LINE Seed JP, ui-sans-serif, system-ui, sans-serif';

/**
 * Base hue of the whole scene at `seconds`: a slow drift through the red-orange → amber band (Area X's ember light),
 * nudged forward on each beat so colour literally keeps time with the music.
 */
export function sceneHue(seconds: number, beatPhase = 0): number {
  const drift = 0.075 + 0.025 * Math.sin(seconds * 0.11);
  return drift + 0.015 * (1 - beatPhase) ** 2;
}

let glowTexture: Texture | undefined;

/**
 * Soft radial glow sprite (white core falling off to transparent), generated once on a 2D canvas and tinted per use.
 * Falls back to Pixi's 1x1 white texture where no DOM canvas exists (headless benchmarks).
 */
export function synGlowTexture(): Texture {
  if (glowTexture) return glowTexture;
  if (typeof document === 'undefined') return Texture.WHITE;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return Texture.WHITE;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // A hot, wide core so small sprites still read as sparks, falling off into a soft halo.
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.24, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  glowTexture = Texture.from(canvas);
  return glowTexture;
}

/** Radius (px) of the visible glow for a sprite of `displaySize` px — the texture fades out well before its edge. */
export const SYN_GLOW_SIZE = 64;
