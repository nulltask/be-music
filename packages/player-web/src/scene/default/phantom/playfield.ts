import { Color, FillGradient, type Graphics } from 'pixi.js';
import type {
  BeMusicBombsContext,
  BeMusicLaneKind,
  BeMusicLanesContext,
  BeMusicLongNoteContext,
  BeMusicNoteContext,
} from '../../../skin/be-music/types.ts';

/** Colours for one lane class: note highlight / body / shade, and the key cap at rest / pressed. */
interface LaneTone {
  top: number;
  body: number;
  bottom: number;
  cap: number;
  capLit: number;
}

// IIDX-convention tones: white keys white, black keys blue, scratch red. Notes stay plain so reading is never traded
// for style; the poster styling lives in the surrounding chrome.
const TONES: Record<BeMusicLaneKind, LaneTone> = {
  white: { top: 0xffffff, body: 0xecebf0, bottom: 0xa9a7b0, cap: 0x1a1a1d, capLit: 0xf4f1ea },
  black: { top: 0xa8d8ff, body: 0x3d8bff, bottom: 0x1a4fa8, cap: 0x0e1626, capLit: 0x6fa8ff },
  scratch: { top: 0xff9aa6, body: 0xe60019, bottom: 0x7a0010, cap: 0x24090d, capLit: 0xff2b45 },
};

const NOTE_HEIGHT = 10;
export const PHANTOM_BOMB_DURATION_MS = 150;

export function renderPhantomLanes({ graphics, lanes, beatPhase }: BeMusicLanesContext): void {
  const beatDecay = 1 - beatPhase;
  let gridTop = Number.POSITIVE_INFINITY;
  let gridBottom = 0;
  let gridRight = 0;
  for (const lane of lanes) {
    const { x, w, top, bottom } = lane;
    const tone = TONES[lane.kind];
    const laneHeight = Math.max(1, bottom - top);
    gridTop = Math.min(gridTop, top);
    gridBottom = Math.max(gridBottom, bottom);
    gridRight = Math.max(gridRight, x + w);

    // Lane bed — a faint wash of the lane's colour, plus a charcoal hairline on the left edge.
    graphics.rect(x, top, w, laneHeight).fill({ color: tone.body, alpha: lane.kind === 'scratch' ? 0.06 : 0.035 });
    graphics.rect(x, top, 1, laneHeight).fill({ color: 0x2c2c31, alpha: 0.9 });

    // Key beam — a smooth gradient in the lane's colour fading toward the top, with a soft white base. Ease the release
    // so the beam dims quickly at first and lingers softly instead of fading linearly.
    if (lane.beam > 0) {
      const beamHeight = Math.min(laneHeight, 190);
      const beamAlpha = lane.beam * lane.beam * (3 - 2 * lane.beam);
      graphics
        .rect(x + 1, bottom - beamHeight, w - 2, beamHeight)
        .fill({ fill: resolveBeamGradient(tone.body), alpha: beamAlpha });
      graphics
        .rect(x + 1, bottom - 22, w - 2, 22)
        .fill({ fill: resolveBeamGradient(0xffffff), alpha: beamAlpha * 0.7 });
    }

    // Judgement line — blood red with a paper-white edge, its glow flaring on each downbeat.
    graphics.rect(x, bottom - 16, w, 14).fill({ color: 0xe60019, alpha: 0.1 + 0.16 * beatDecay });
    graphics.rect(x, bottom - 4, w, 4).fill(0xe60019);
    graphics.rect(x, bottom - 5, w, 1).fill({ color: 0xffffff, alpha: 0.9 });
    graphics.rect(x, bottom, w, 1).fill(0x000000);

    // Key caps under the line — dark blocks with a white rim at rest, lit in the lane's colour on press.
    const pressed = lane.beam > 0.6;
    const capTop = bottom + 3;
    const capW = Math.max(2, w - 2);
    graphics.rect(x + 1, capTop, capW, 14).fill(pressed ? tone.capLit : tone.cap);
    graphics.rect(x + 1, capTop, capW, 2).fill({ color: 0xffffff, alpha: pressed ? 0.9 : 0.55 });
    if (pressed) {
      graphics.rect(x + 1, capTop - 2, capW, 2).fill({ color: 0xffffff, alpha: 0.95 });
    }
  }
  // Close the grid on the right-most lane — each lane only draws its LEFT hairline.
  if (lanes.length > 0) {
    graphics.rect(gridRight - 1, gridTop, 1, Math.max(1, gridBottom - gridTop)).fill({ color: 0x2c2c31, alpha: 0.9 });
  }
}

export function renderPhantomNote({ graphics, kind, x, w, y }: BeMusicNoteContext): void {
  drawNoteBody(graphics, x, y, Math.max(4, w), TONES[kind]);
}

export function renderPhantomLongNote({ graphics, kind, x, w, top, bottom }: BeMusicLongNoteContext): void {
  const tone = TONES[kind];
  const bodyX = x;
  const bodyW = Math.max(4, w);
  const bodyTop = top - NOTE_HEIGHT;
  const bodyH = Math.max(1, bottom - top);
  // Translucent core with solid side rails — reads as "hold the lane", not a solid wall of colour.
  graphics.rect(bodyX + 1, bodyTop, bodyW - 2, bodyH).fill({ color: tone.body, alpha: 0.35 });
  graphics.rect(bodyX, bodyTop, 2, bodyH).fill({ color: tone.body, alpha: 0.9 });
  graphics.rect(bodyX + bodyW - 2, bodyTop, 2, bodyH).fill({ color: tone.body, alpha: 0.9 });
  drawNoteBody(graphics, bodyX, bottom, bodyW, tone);
  drawNoteBody(graphics, bodyX, top, bodyW, tone);
}

/** Plain IIDX-style hit flash: an expanding ring over a white core. */
export function renderPhantomBombs({ pool, bombs }: BeMusicBombsContext): void {
  for (const bomb of bombs) {
    const progress = Math.max(0, Math.min(1, bomb.elapsedMs / PHANTOM_BOMB_DURATION_MS));
    const eased = 1 - (1 - progress) * (1 - progress);
    const centerX = bomb.x + bomb.w / 2;
    const centerY = bomb.y - Math.max(4, bomb.w * 0.16);
    const outer = Math.max(8, bomb.w * (0.55 + 0.6 * eased));
    const inner = outer * 0.52;
    const graphic = pool.acquireGraphics();
    graphic.label = `default-bomb[ch=${bomb.channel}]`;
    graphic.blendMode = 'add';
    graphic.alpha = 1 - progress;
    graphic.circle(centerX, centerY, outer).stroke({ color: 0xff6a3d, width: Math.max(1.5, bomb.w * 0.1) });
    graphic.circle(centerX, centerY, inner).fill({ color: 0xffb070, alpha: 0.35 });
    graphic.circle(centerX, centerY, inner * 0.5).fill({ color: 0xffffff, alpha: 0.85 });
  }
}

/** Flat bar with a thin top highlight and a bottom shade; `y` is the bottom edge (just-timing line). */
function drawNoteBody(graphics: Graphics, x: number, y: number, w: number, tone: LaneTone): void {
  graphics.rect(x, y - NOTE_HEIGHT, w, NOTE_HEIGHT).fill(tone.body);
  graphics.rect(x, y - NOTE_HEIGHT, w, 1).fill({ color: tone.top, alpha: 0.9 });
  graphics.rect(x, y - 2, w, 2).fill({ color: tone.bottom, alpha: 0.9 });
}

const BEAM_GRADIENTS = new Map<number, FillGradient>();

/**
 * Vertical beam gradient for `color`: transparent at the top, easing into a translucent base. Built in `'local'`
 * texture space so one cached gradient stretches to any lane rect.
 */
function resolveBeamGradient(color: number): FillGradient {
  let gradient = BEAM_GRADIENTS.get(color);
  if (!gradient) {
    const rgb = new Color(color);
    gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: rgb.setAlpha(0).toRgbaString() },
        { offset: 0.45, color: rgb.setAlpha(0.08).toRgbaString() },
        { offset: 0.8, color: rgb.setAlpha(0.28).toRgbaString() },
        { offset: 1, color: rgb.setAlpha(0.55).toRgbaString() },
      ],
    });
    BEAM_GRADIENTS.set(color, gradient);
  }
  return gradient;
}
