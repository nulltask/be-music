import { Graphics, type Container } from 'pixi.js';
import {
  CLEAR_LAMP_COLORS,
  resolveClearLampLight,
  type BeMusicClearLamp,
  type BestRecordSummary,
} from '@be-music/player-skin-sdk';
import type { SkinTextOptions } from '../pixi-kit/index.ts';
import { drawReticle } from './draw.ts';
import { SYN_AMBER, SYN_DIM, SYN_DISPLAY_FONT, SYN_MIST, SYN_VOID, SYN_WHITE } from './style.ts';

/** How long a lit lamp takes to breathe in and out once. */
const LAMP_BREATH_MS = 2400;

type AddText = (text: string, x: number, y: number, options?: SkinTextOptions) => Container;

/**
 * The lit clear lamps of one select rebuild: white shapes and text whose tint and alpha `tick` moves every frame, so a
 * FAILED lamp blinks and a FULL COMBO lamp cycles its hues without rebuilding the chrome. Each lamp keeps the alpha the
 * rebuild left it at (a row fading past the list's edge, the launch outro) and blinks within it.
 */
export class LampLights {
  private lamps: { node: Container; lamp: BeMusicClearLamp; phase: number; base: number }[] = [];

  /** Forgets the last rebuild's lamps: their nodes are destroyed with its layer. */
  public reset(): void {
    this.lamps = [];
  }

  /** Lights `node` (drawn white) as `lamp`, its hue cycle offset by `phase` (0..1). */
  public add(node: Container, lamp: BeMusicClearLamp, phase: number, nowMs: number, still: boolean): void {
    this.lamps.push({ node, lamp, phase, base: 1 });
    const light = lampLight(lamp, nowMs, phase, still);
    node.tint = light.color;
  }

  /** Takes each lamp's alpha as the rebuild left it, before `tick` blinks within it. */
  public settle(): void {
    for (const entry of this.lamps) entry.base = entry.node.alpha;
  }

  public tick(nowMs: number, still: boolean): void {
    for (const entry of this.lamps) {
      if (entry.node.destroyed) continue;
      const light = lampLight(entry.lamp, nowMs, entry.phase, still);
      // The lit lamps breathe gently, rippling down the list with their phase.
      const breath = still ? 1 : 0.86 + 0.14 * Math.sin((nowMs / LAMP_BREATH_MS + entry.phase) * Math.PI * 2);
      entry.node.tint = light.color;
      entry.node.alpha = entry.base * light.alpha * breath;
    }
  }
}

/** A lamp's light, held still (its plain colour, never blinking) with effects off. */
function lampLight(lamp: BeMusicClearLamp, nowMs: number, phase: number, still: boolean) {
  return still ? { color: CLEAR_LAMP_COLORS[lamp], alpha: 1 } : resolveClearLampLight(lamp, nowMs, phase);
}

/** The halo around a lamp's bar, widest and faintest first: [width, alpha], centred on the bar. */
const LAMP_HALO: ReadonlyArray<readonly [width: number, alpha: number]> = [
  [19, 0.06],
  [13, 0.1],
  [8, 0.2],
];
/** The light the lamp spills into its bar, nearest first: [width, alpha] steps running right from the lamp. */
const LAMP_SPILL: ReadonlyArray<readonly [width: number, alpha: number]> = [
  [6, 0.16],
  [8, 0.09],
  [10, 0.045],
  [14, 0.018],
];

/**
 * A select bar's clear lamp: a slim upright bar of light at (`x`, `y`), added to `layer` and lit by `lights`. It glows:
 * a soft halo round the bar and a wash of its light spilling into the bar, all added to what is under it. Nothing for
 * `NO_PLAY` or no record.
 */
export function drawBarLamp(
  layer: Container,
  lights: LampLights,
  lamp: BeMusicClearLamp | undefined,
  x: number,
  y: number,
  h: number,
  phase: number,
  nowMs: number,
  still: boolean,
): void {
  if (lamp === undefined || lamp === 'NO_PLAY') return;
  const node = new Graphics();
  node.label = `synesthesia-select/lamp[${lamp}]`;
  node.blendMode = 'add';
  const centre = x + 1.5;
  for (const [width, alpha] of LAMP_HALO) {
    node.rect(centre - width / 2, y - 1, width, h + 2).fill({ color: SYN_WHITE, alpha });
  }
  let spillX = x + 3;
  for (const [width, alpha] of LAMP_SPILL) {
    node.rect(spillX, y, width, h).fill({ color: SYN_WHITE, alpha });
    spillX += width;
  }
  node.rect(x, y, 3, h).fill({ color: SYN_WHITE, alpha: 1 });
  layer.addChild(node);
  lights.add(node, lamp, phase, nowMs, still);
}

/** The best-record strip's height on the focused-song card. */
export const BEST_RECORD_PANEL_H = 40;

/**
 * The focused chart's (or course's) best record as a strip on the info card, at (`x`, `y`) and `w` wide: the lamp as a
 * lit edge, its name, the play count and the DJ Rank on the first line, then the best EX score, its rate, BP and max
 * combo. `NO PLAY` and dashes without a record. `size` is the facts' text size; the lamp's name and rank run larger.
 */
export function drawBestRecordPanel(
  chrome: Graphics,
  layer: Container,
  addText: AddText,
  lights: LampLights,
  summary: BestRecordSummary | undefined,
  options: { x: number; y: number; w: number; accent: number; nowMs: number; still: boolean; size?: number },
): void {
  const { x, y, w, accent, nowMs, still } = options;
  const h = BEST_RECORD_PANEL_H;
  const size = options.size ?? 9;
  chrome.rect(x, y, w, h).fill({ color: SYN_VOID, alpha: 0.5 });
  chrome.rect(x, y, w, h).stroke({ color: accent, width: 1, alpha: 0.25 });
  drawReticle(chrome, x, y, w, h, SYN_MIST, 0.6, { arm: 5, width: 1 });
  const lamp = summary?.lamp ?? 'NO_PLAY';
  const played = lamp !== 'NO_PLAY';
  drawBarLamp(layer, lights, lamp, x + 1, y + 1, h - 2, 0, nowMs, still);

  const left = x + 12;
  const right = x + w - 10;
  const topY = y + 13;
  // A name and its figure share one size, so their capitals line up; colour and tracking tell them apart.
  const label = { size, fill: SYN_DIM, fontFamily: SYN_DISPLAY_FONT, letterSpacing: 1, anchorY: 0.5 } as const;
  const value = { size, fill: SYN_WHITE, fontFamily: SYN_DISPLAY_FONT, anchorY: 0.5 } as const;

  // The DJ Rank on the right of the first line, then the play count before it.
  const rank = addText(summary?.rank ?? '-', right, topY, {
    size: size + 6,
    fill: summary?.rank !== undefined ? SYN_AMBER : SYN_DIM,
    fontFamily: SYN_DISPLAY_FONT,
    anchorX: 1,
    anchorY: 0.5,
    ...(summary?.rank !== undefined ? { dropShadow: { color: SYN_AMBER, distance: 0, blur: 10, alpha: 0.7 } } : {}),
  });
  const playsRight = right - rank.width - 12;
  const plays = addText(String(summary?.playCount ?? 0), playsRight, topY, { ...value, fill: SYN_MIST, anchorX: 1 });
  const playsLabel = addText('PLAYS', playsRight - plays.width - 5, topY, { ...label, anchorX: 1 });
  const lampText = addText(summary?.lampLabel ?? 'NO PLAY', left, topY, {
    size: size + 2,
    fill: played ? SYN_WHITE : SYN_DIM,
    fontFamily: SYN_DISPLAY_FONT,
    letterSpacing: 2,
    anchorY: 0.5,
    maxWidth: Math.max(24, playsRight - plays.width - 5 - playsLabel.width - 10 - left),
    ...(played ? { dropShadow: { color: CLEAR_LAMP_COLORS[lamp], distance: 0, blur: 8, alpha: 0.7 } } : {}),
  });
  if (played) lights.add(lampText, lamp, 0, nowMs, still);

  // The second line: the best EX score and its rate, BP and max combo, each a dim name and its figure.
  const factsY = y + 29;
  let factX = left;
  const facts: ReadonlyArray<readonly [name: string, figure: string | undefined]> = [
    ['EX', summary?.exScore !== undefined ? String(summary.exScore) : undefined],
    ['', summary?.rateLabel],
    ['BP', summary?.missCount !== undefined ? String(summary.missCount) : undefined],
    ['COMBO', summary?.maxCombo !== undefined ? String(summary.maxCombo) : undefined],
  ];
  for (const [name, figure] of facts) {
    if (name === '' && figure === undefined) continue;
    const nameW = name === '' ? 0 : addText(name, factX, factsY, label).width + 5;
    const figureNode = addText(figure ?? '-', factX + nameW, factsY, {
      ...value,
      fill: name === '' ? SYN_MIST : SYN_WHITE,
      maxWidth: Math.max(8, right - factX - nameW),
    });
    factX += nameW + figureNode.width + (name === 'EX' ? 8 : 14);
  }
}
