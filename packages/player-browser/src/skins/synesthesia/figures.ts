import type { Container } from 'pixi.js';
import { addSkinNumber, addSkinText, type SkinTextOptions } from '../pixi-kit/index.ts';
import { SYN_DISPLAY_FONT } from './style.ts';

const DIGIT = /\d/u;

/**
 * Skin text in Synesthesia's faces, with Orbitron's figures tabular: Orbitron's digits are proportional (a 1 is half
 * as wide as a 0), so a display-face text holding a digit is laid out in tabular cells ({@link addSkinNumber}) and
 * lines up down a list. Other text is drawn as it is.
 */
export function addSynesthesiaText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  options: SkinTextOptions = {},
): Container {
  return options.fontFamily === SYN_DISPLAY_FONT && DIGIT.test(text)
    ? addSkinNumber(layer, text, x, y, options)
    : addSkinText(layer, text, x, y, options);
}
