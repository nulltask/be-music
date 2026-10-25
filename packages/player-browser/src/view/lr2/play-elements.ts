import { drawLabel } from '../../stage/draw-label.ts';
/**
 * The elements of an LR2 play skin, drawn for one frame: `#DST_IMAGE` (with the scratch turntable and the key-beam and
 * long-note-hold release fades), `#DST_JUDGELINE`, numbers, the groove gauge, bar graphs, sliders, texts (bitmap fonts
 * and system-font fallback), the judge and combo assembly, and the parts the LR2 view gives the shared playfield (lane
 * rects, note cells, measure lines, BGA rects). The values come from the frame's LR2 state (`resolveLR2PlayState`) and
 * the LR2 timers (`LR2PlayTimers`), which gate each element's destination.
 *
 * The functions read the view through {@link LR2PlayElementsContext}; the LR2 play view passes itself.
 */

import {
  isLR2SpecialGraphic,
  type LR2BarGraphElement,
  type LR2DestinationRect,
  type LR2ImageElement,
  type LR2ImageRect,
  type LR2JudgeLineElement,
  type LR2Skin,
  type LR2SliderElement,
  type LR2TextElement,
} from '@be-music/skin-lr2';
import { LR2_LANE_TIMER_BANK_SIZE, LR2_NUM, LR2_OP, LR2_TIMER } from '@be-music/skin-lr2/ids';
import { isLR2AutoLane, resolveLR2JudgeCombo, type LR2PlayState } from '@be-music/skin-lr2/state';
import type { CourseView } from '@be-music/player-scene-model';
import { PLAYFIELD } from '@be-music/player-skin-sdk';
import { Container, TextStyle, type Texture } from 'pixi.js';
import { BLUE } from '../shared/play-constants.ts';
import { LR2_JUDGE_FALLBACK_FONT, LR2_TEXT_FALLBACK_FONT } from '../shared/fonts.ts';
import type { ChildPool } from '../../stage/pixi-utils.ts';
import { makeLR2BitmapTextSprite, type LR2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import {
  applyDestinationToSprite,
  createCroppedTexture,
  evaluateElementDestination,
  evaluateKeyframes,
  normalizeRect,
  pickAnimatedCell,
  renderNumberElement,
} from '../../skin/lr2/render.ts';
import type { PlayfieldRuntime } from '../shared/playfield/context.ts';
import type {
  PlayfieldBGATarget,
  PlayfieldCell,
  PlayfieldLaneRect,
  PlayfieldMeasureLine,
  PlayfieldNoteKind,
  PlayfieldStage,
} from '../types.ts';
import {
  isLR2OverlayImage,
  lastJudgeToNowComboKind,
  renderGrooveGaugeElement,
  renderNowComboElement,
  resolveJudgeSkinKind,
} from './play-hud.ts';
import type { LR2PlayTimers } from './play-timers.ts';
import type { LR2Turntable } from './play-turntable.ts';

/** What the elements read and draw into: the LR2 play view's members of these names. */
export interface LR2PlayElementsContext {
  readonly skin: LR2Skin;
  /** The 9-keys play skin whose `notes.note[3]` draws invisible notes. */
  readonly invisibleNoteSkin: LR2Skin | undefined;
  readonly play: PlayfieldRuntime;
  /** The skin's images by path, and the chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` under LR2's special paths. */
  readonly textures: ReadonlyMap<string, Texture>;
  readonly timers: LR2PlayTimers;
  readonly turntable: LR2Turntable;
  /** The frame's LR2 state: its ops gate the skin's `#DST_*`, its values fill it. */
  readonly lr2State: LR2PlayState | undefined;
  /** The course's kind, for the combo an expert or grade course shows. */
  readonly courseKind: CourseView['kind'] | undefined;
  readonly skinLayer: Container;
  readonly overlayLayer: Container;
  readonly bgaLayer: Container;
  readonly skinLayerPool: ChildPool;
  readonly overlayLayerPool: ChildPool;
  readonly textLayerPool: ChildPool;
  readonly text: LR2PlayText;
}

/** Whether `op` holds this frame: op 0 always; op 999 is a `#CUSTOMOPTION` op like 900-998 (OpenLR2 `GetOptionFlag_dst`). */
function isOpActive(ctx: LR2PlayElementsContext, op: number): boolean {
  if (op === 0) return true;
  return ctx.lr2State?.ops.has(op) === true;
}

function evaluateOps(ctx: LR2PlayElementsContext, ops: ReadonlyArray<number>): boolean {
  for (const op of ops) {
    if (op > 0) {
      if (!isOpActive(ctx, op)) return false;
    } else if (isOpActive(ctx, -op)) {
      return false;
    }
  }
  return true;
}

/** Whether a destination shows this frame: its timer runs and its ops hold. */
export function isLR2DestinationVisible(ctx: LR2PlayElementsContext, destination: LR2DestinationRect): boolean {
  if (!ctx.timers.isActive(destination.timer)) return false;
  return evaluateOps(ctx, destination.ops);
}

/** An element's destination now: its keyframes interpolated against its timer, or its static destination. */
export function evaluateLR2ElementDst(
  ctx: LR2PlayElementsContext,
  element: { destination: LR2DestinationRect; keyframes: LR2DestinationRect[] },
): LR2DestinationRect {
  return evaluateElementDestination(element, (timer) => ctx.timers.elapsed(timer));
}

/**
 * `#DST_NOTE`'s rect of the lane at LR2 lane index `laneIndex` on a stage of `stage` (the skin scaled to fit it,
 * centred), or `undefined` when the skin places no note there. 1P lanes are indices 0-9 and 2P lanes 10-19, so a DP
 * chart's 2P notes land on the 2P rects the skin authored. `y` is the top of the judgement-line bar; the judgement line
 * a note lands on is its bottom edge (`y + h`: y = 321 in the LR2 default 7-keys skin, where the keys begin).
 */
export function resolveLR2LaneRect(
  skin: LR2Skin,
  laneIndex: number,
  stage: PlayfieldStage,
): PlayfieldLaneRect | undefined {
  const lane = skin.laneRects[laneIndex];
  if (!lane) return undefined;
  const scale = Math.min(stage.width / skin.width, stage.height / skin.height);
  const skinX = (stage.width - skin.width * scale) / 2;
  const skinY = (stage.height - skin.height * scale) / 2;
  const judgeBottom = lane.y + Math.abs(lane.h);
  return {
    x: skinX + lane.x * scale,
    w: Math.max(4, lane.w * scale),
    top: skinY,
    bottom: skinY + judgeBottom * scale,
  };
}

/**
 * The skin's cell for one part of a note on LR2 lane index `laneIndex`, or `undefined` for the playfield's own shape.
 * An invisible note is the 9-keys play skin's `notes.note[3]` (the Pop'n green wide note of LR2's POP layout). Animated
 * notes pick their cell from `divx * divy / cycle`; an LN cap whose image is still loading has no texture (the cap is
 * skipped), as a missing image leaves a tap note or mine to the playfield.
 */
export function resolveLR2NoteCell(
  ctx: LR2PlayElementsContext,
  kind: PlayfieldNoteKind,
  laneIndex: number,
): PlayfieldCell | undefined {
  if (kind === 'invisible') {
    const greenNoteSrc = ctx.invisibleNoteSkin?.notes.note?.[3];
    const greenBaseTexture = greenNoteSrc ? ctx.textures.get(greenNoteSrc.imagePath) : undefined;
    if (!greenNoteSrc || !greenBaseTexture) return undefined;
    const cell = pickAnimatedCell(greenNoteSrc, ctx.timers.elapsed(greenNoteSrc.timer));
    return { texture: createCroppedTexture(greenBaseTexture, cell), width: cell.w, height: cell.h };
  }
  const src = resolveNoteSource(ctx, kind, laneIndex);
  if (!src) return undefined;
  if (kind === 'lnstart' || kind === 'lnend') {
    const cell = pickAnimatedCell(src, ctx.timers.elapsed(src.timer));
    return { texture: createCroppedTexture(ctx.textures.get(src.imagePath), cell), width: cell.w, height: cell.h };
  }
  const baseTexture = ctx.textures.get(src.imagePath);
  if (!baseTexture) return undefined;
  const cell = pickAnimatedCell(src, ctx.timers.elapsed(src.timer));
  return { texture: createCroppedTexture(baseTexture, cell), width: cell.w, height: cell.h };
}

/**
 * The note SRC for a part on a lane. LR2's `#SRC_AUTO_*` "dummy notes" are not an AUTO override: they draw only on the
 * lanes the auto scratch plays by itself (`isLR2AutoLane`) with AUTOPLAY LANE = DUMMY NOTES (op 915). Full AUTO (op 33)
 * keeps the regular note, as on LR2.
 */
function resolveNoteSource(
  ctx: LR2PlayElementsContext,
  kind: 'note' | 'lnstart' | 'lnend' | 'lnbody' | 'mine',
  laneIndex: number,
): LR2ImageRect | undefined {
  const skin = ctx.skin;
  const ops = ctx.lr2State?.ops ?? NO_OPS;
  if (isLR2AutoLane(laneIndex, ops) && ops.has(915)) {
    const auto = skin.notes[('auto' + kind) as keyof LR2Skin['notes']];
    const autoSrc = auto?.[laneIndex] ?? auto?.find((entry): entry is LR2ImageRect => Boolean(entry));
    if (autoSrc) return autoSrc;
  }
  return skin.notes[kind]?.[laneIndex];
}

const NO_OPS: ReadonlySet<number> = new Set<number>();

/**
 * The skin's `#DST_LINE` measure lines (the LR2 default 7-keys skin's 1-px white strip at y = 320), each to repeat at
 * every measure: SP charts have `index` 0, DP charts add `index` 1 for the 2P strip. `undefined` when the skin has none
 * whose image loaded, so the playfield draws its own.
 */
export function resolveLR2MeasureLines(ctx: LR2PlayElementsContext): readonly PlayfieldMeasureLine[] | undefined {
  const skinLines = ctx.skin.measureLines.filter((entry) => ctx.textures.has(entry.source.imagePath));
  if (skinLines.length === 0) return undefined;
  const lines: PlayfieldMeasureLine[] = [];
  for (const skinLine of skinLines) {
    if (!isLR2DestinationVisible(ctx, skinLine.destination)) continue;
    const baseTexture = ctx.textures.get(skinLine.source.imagePath);
    if (!baseTexture) continue;
    const lineDst = evaluateLR2ElementDst(ctx, skinLine);
    const cell = pickAnimatedCell(skinLine.source, ctx.timers.elapsed(skinLine.source.timer));
    const cropped = createCroppedTexture(baseTexture, cell);
    if (!cropped) continue;
    const lane = ctx.skin.laneRects.slice(skinLine.index * 10, skinLine.index * 10 + 10).find(Boolean);
    const timingY = lane ? lane.y + Math.abs(lane.h) : lineDst.y + Math.abs(lineDst.h);
    lines.push({
      cell: { texture: cropped, width: cell.w, height: cell.h },
      x: lineDst.x,
      width: lineDst.w,
      height: Math.max(1, Math.abs(lineDst.h)),
      // DST_LINE and DST_NOTE specify their own top edges; both scroll from the note's bottom edge.
      yOffset: lineDst.y - timingY,
      applyToSprite: (sprite) => applyDestinationToSprite(sprite, lineDst),
    });
  }
  return lines;
}

/**
 * Every `#DST_BGA` rect whose ops hold this frame. SP skins author op 30 (BGA NORMAL) and op 31 (BGA EXTEND), one at a
 * time; DP skins (`14keys/14_LR0.csv`) author a big op-31 square and two op-30 panels stacked on the right, all drawn.
 */
export function collectLR2BGATargets(ctx: LR2PlayElementsContext, out: PlayfieldBGATarget[]): void {
  for (const entry of ctx.skin.bgas) {
    if (!isLR2DestinationVisible(ctx, entry.destination)) continue;
    const dst = evaluateLR2ElementDst(ctx, entry);
    const { x, y, w, h } = normalizeRect(dst);
    out.push({
      x,
      y,
      w,
      h,
      noBase: entry.noBase,
      noLayer: entry.noLayer,
      noPoor: entry.noPoor,
      applyToSprite: (sprite) => applyDestinationToSprite(sprite, dst),
    });
  }
}

/**
 * Draws the skin for this frame into the skin and overlay layers, scaled to fit a stage of `width` x `height`, and
 * puts the BGA layer on the same transform. Images draw in two passes so the judgement line lands between the static
 * frame and the timer-driven overlays (bombs 50-69, long-note holds 70-89, key beams 100-139), which punch through it.
 */
export function drawLR2PlaySkin(ctx: LR2PlayElementsContext, width: number, height: number): void {
  const skin = ctx.skin;
  ctx.skinLayerPool.begin();
  ctx.overlayLayerPool.begin();
  ctx.text.beginFrame();
  const scale = Math.min(width / skin.width, height / skin.height);
  ctx.skinLayer.scale.set(scale);
  ctx.skinLayer.position.set((width - skin.width * scale) / 2, (height - skin.height * scale) / 2);
  ctx.overlayLayer.scale.set(scale);
  ctx.overlayLayer.position.copyFrom(ctx.skinLayer.position);
  ctx.bgaLayer.scale.set(scale);
  ctx.bgaLayer.position.copyFrom(ctx.skinLayer.position);
  for (const image of skin.images) {
    if (isLR2OverlayImage(image)) continue;
    drawImage(ctx, image);
  }
  for (const judgeLine of skin.judgeLines) {
    // Every side's line: a DP skin authors `#DST_JUDGELINE,0` (1P) and `#DST_JUDGELINE,1` (2P).
    drawJudgeLine(ctx, judgeLine);
  }
  for (const image of skin.images) {
    if (!isLR2OverlayImage(image)) continue;
    drawImage(ctx, image);
  }
  for (const number of skin.numbers) {
    if (!isLR2DestinationVisible(ctx, number.destination)) continue;
    // In an expert or grade course the combo numbers count the whole course.
    const value = ctx.lr2State?.number(number.source.num);
    if (value === undefined) continue;
    renderNumberElement(ctx.skinLayerPool, number, value, ctx.textures, evaluateLR2ElementDst(ctx, number), {
      // The groove-gauge percentage is variable-length; LR2 default skins give it keta 3, which would print "020".
      suppressLeadingZeros: number.source.num === LR2_NUM.GAUGE,
    });
  }
  for (const gauge of skin.grooveGauges) {
    // The 2P gauge (index 1) is a two-player BATTLE's 2P player's; without one only the 1P gauge draws.
    const gaugeState = gauge.index === 0 ? ctx.play.gaugeState : ctx.play.secondPlayer?.gauge;
    if (gauge.index > 1 || gaugeState === undefined) continue;
    if (!isLR2DestinationVisible(ctx, gauge.destination)) continue;
    renderGrooveGaugeElement(
      ctx.skinLayerPool,
      gauge,
      gaugeState.current,
      ctx.textures,
      evaluateLR2ElementDst(ctx, gauge),
      {
        // Survival gauges (HARD / DEATH) have no 80 % clear border in LR2: the whole bar draws in the red cell.
        survivalGauge: gaugeState.survival === true,
        // The 4-cell x N-frame animation (the lit tip's scan), on the SRC's timer.
        elapsedMs: ctx.timers.elapsed(gauge.source.timer),
      },
    );
  }
  for (const bargraph of skin.bargraphs) {
    if (!isLR2DestinationVisible(ctx, bargraph.destination)) continue;
    drawBarGraph(ctx, bargraph);
  }
  for (const slider of skin.sliders) {
    if (!isLR2DestinationVisible(ctx, slider.destination)) continue;
    drawSlider(ctx, slider);
  }
  for (const text of skin.texts) {
    if (!isLR2DestinationVisible(ctx, text.destination)) continue;
    drawText(ctx, text);
  }
  drawJudgeAndCombo(ctx, '1P');
  // A 9 KEY (PMS) chart can keep lanes in the 2x channels but is single-side: only DP shows a 2P judge and combo.
  const usesPlayer2 =
    ctx.play.chartPlayVariant !== '9' && ctx.play.laneChannels.some((channel) => channel.startsWith('2'));
  if (usesPlayer2) drawJudgeAndCombo(ctx, '2P');
  ctx.skinLayerPool.end();
  ctx.overlayLayerPool.end();
  ctx.text.endFrame(ctx.skinLayer);
}

/**
 * The late text pass, after the bombs: the judgement as text when the skin draws none for it, where LR2's
 * `#DST_NOWJUDGE_1P,...,73,230,...` parks the judge graphic (91 px above the judgement line).
 */
export function drawLR2FallbackJudge(ctx: LR2PlayElementsContext, seconds: number): void {
  const play = ctx.play;
  if (!play.lastJudge || seconds > play.lastJudgeUntil || hasSkinnedJudge(ctx.skin, play.lastJudge)) return;
  const judge = ctx.textLayerPool.acquireText();
  const style = ctx.text.fallbackJudgeStyle();
  if (judge.style !== style) judge.style = style;
  judge.text = play.lastJudge;
  judge.label = `fallback-judge[${play.lastJudge}]`;
  judge.anchor.set(0.5);
  judge.position.set(PLAYFIELD.x + PLAYFIELD.w / 2, 230);
}

/** Whether the skin draws `judge` on either side (a 2P judge falls back to the 1P one). */
function hasSkinnedJudge(skin: LR2Skin, judge: string): boolean {
  const kind = resolveJudgeSkinKind(judge);
  if (!kind) return false;
  return Boolean(skin.judges[kind]?.length || skin.judges2P[kind]?.length);
}

/** One `#SRC_IMAGE` + `#DST_IMAGE` element. */
function drawImage(ctx: LR2PlayElementsContext, image: LR2ImageElement): void {
  if (!isLR2DestinationVisible(ctx, image.destination)) return;
  const elapsed = ctx.timers.elapsed(image.destination.timer);
  const dst = image.keyframes.length > 1 ? evaluateKeyframes(image.keyframes, elapsed) : image.destination;
  // A DST with w = 0 or h = 0 draws nothing; a negative w / h grows the other way.
  if (dst.w === 0 || dst.h === 0) return;
  const baseTexture = ctx.textures.get(image.source.imagePath);
  if (!baseTexture) return;
  let texture: Texture | undefined;
  if (isLR2SpecialGraphic(image.source.imagePath)) {
    // The chart's STAGEFILE / BACKBMP / BANNER (`gr=100..111`) is the whole image, not a cell of a grid.
    texture = baseTexture;
  } else {
    // SRC cycling and DST keyframe looping are independent in LR2. Only the one-shot overlays (FC 48 / 49, bombs
    // 50-69) clamp their SRC at the last cell (`dst.loop`); everything else keeps cycling (the stock skin's blinking
    // DONE plate on timer 40). The texture extents resolve LR2's `w = 0` / `h = 0` "native size" shorthand.
    const dstTimer = image.destination.timer;
    const isOneShotOverlayTimer =
      dstTimer === LR2_TIMER.FULL_COMBO_1P ||
      dstTimer === LR2_TIMER.FULL_COMBO_2P ||
      (dstTimer >= LR2_TIMER.BOMB_1P && dstTimer < LR2_TIMER.BOMB_2P + LR2_LANE_TIMER_BANK_SIZE);
    const srcLoop = isOneShotOverlayTimer ? dst.loop : undefined;
    const cellRect = pickAnimatedCell(image.source, ctx.timers.elapsed(image.source.timer), srcLoop, {
      width: baseTexture.width,
      height: baseTexture.height,
    });
    if (cellRect.w <= 0 || cellRect.h <= 0) return;
    texture = createCroppedTexture(baseTexture, cellRect);
  }
  if (!texture) return;
  // The AUTOPLAY label (any image on op 33) draws with the judge plate, above the falling notes.
  const targetPool = image.destination.ops.includes(LR2_OP.AUTOPLAY_ON) ? ctx.overlayLayerPool : ctx.skinLayerPool;
  const sprite = targetPool.acquireSprite();
  sprite.texture = texture;
  sprite.label = drawLabel(image, 'image', image.source.imagePath);
  const { x, y, w, h } = normalizeRect(dst);
  // op4 = 1 / 2 mark the 1P / 2P scratch turntable: the sprite spins about its centre with the turntable's angle.
  if (dst.op4 === 1 || dst.op4 === 2) {
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(x + w / 2, y + h / 2);
    sprite.rotation = ctx.turntable.angleOf(dst.op4 === 1 ? '1' : '2');
  } else {
    sprite.position.set(x, y);
  }
  sprite.width = w;
  sprite.height = h;
  applyDestinationToSprite(sprite, dst);
  // A key beam (100-119) or long-note hold (70-89) fading out after its release tapers to nothing.
  const fadeAlpha = ctx.timers.releaseFadeAlpha(image.destination.timer);
  if (fadeAlpha !== undefined) sprite.alpha = fadeAlpha;
}

/** The `#DST_JUDGELINE` bar; its source cell carries the colour. */
function drawJudgeLine(ctx: LR2PlayElementsContext, judgeLine: LR2JudgeLineElement): void {
  if (!isLR2DestinationVisible(ctx, judgeLine.destination)) return;
  const dst = evaluateLR2ElementDst(ctx, judgeLine);
  if (dst.w === 0 || dst.h === 0) return;
  const baseTexture = ctx.textures.get(judgeLine.source.imagePath);
  if (!baseTexture) return;
  const texture = createCroppedTexture(baseTexture, judgeLine.source);
  if (!texture) return;
  const sprite = ctx.skinLayerPool.acquireSprite();
  sprite.texture = texture;
  sprite.label = drawLabel(judgeLine, 'judgeline', judgeLine.index);
  sprite.position.set(dst.x, dst.y);
  sprite.width = dst.w;
  sprite.height = dst.h;
  applyDestinationToSprite(sprite, dst);
}

/**
 * A `#DST_TEXT`: its string from the LR2 state, in the skin's `#LR2FONT` bitmap font when it has loaded, else a system
 * font sized to the destination's height. `w = 0` is LR2's "no width constraint"; a wider string is squeezed to `w`.
 */
function drawText(ctx: LR2PlayElementsContext, text: LR2TextElement): void {
  const interpolated = evaluateLR2ElementDst(ctx, text);
  const { x, y, w, h } = normalizeRect(interpolated);
  if (h === 0) return;
  const value = ctx.lr2State?.text(text.st);
  if (!value) return;
  const loaded = ctx.text.font(text.font);
  if (loaded) {
    ctx.text.showBitmapText(text, value, interpolated, loaded);
    return;
  }
  const fontSize = Math.max(8, Math.min(64, h * 0.8));
  const tint = (interpolated.r << 16) | (interpolated.g << 8) | interpolated.b;
  const node = ctx.skinLayerPool.acquireText();
  const style = ctx.text.textStyle(text.st, fontSize, tint);
  if (node.style !== style) node.style = style;
  node.text = value;
  node.label = drawLabel(text, 'text', text.st);
  node.alpha = interpolated.alpha;
  node.scale.set(1, 1);
  // `#SRC_TEXT` align: 0 puts the left edge at the DST x, 1 the centre, 2 the right edge.
  if (text.alignment === 'center') {
    node.anchor.set(0.5, 0.5);
  } else if (text.alignment === 'right') {
    node.anchor.set(1, 0.5);
  } else {
    node.anchor.set(0, 0.5);
  }
  node.position.set(x, y + h / 2);
  // Shrink-to-fit about the anchor, so the aligned edge stays put.
  if (w > 0 && node.width > w) {
    node.scale.x = w / node.width;
  }
}

/**
 * A `#SRC_BARGRAPH`: the source stretched over the share of the destination its value fills, along its width (or, for
 * a vertical bar, its height, filling upward).
 */
function drawBarGraph(ctx: LR2PlayElementsContext, bargraph: LR2BarGraphElement): void {
  const interpolated = evaluateLR2ElementDst(ctx, bargraph);
  const { x, y, w, h } = normalizeRect(interpolated);
  if (w === 0 || h === 0) return;
  const baseTexture = ctx.textures.get(bargraph.source.imagePath);
  if (!baseTexture) return;
  const progress = ctx.lr2State?.bargraph(bargraph.type) ?? 0;
  if (progress <= 0) return;
  const cropTexture = createCroppedTexture(baseTexture, bargraph.source);
  if (!cropTexture) return;
  const sprite = ctx.skinLayerPool.acquireSprite();
  sprite.texture = cropTexture;
  sprite.label = drawLabel(bargraph, 'bargraph', bargraph.type);
  if (bargraph.muki === 'vertical') {
    const filledHeight = Math.round(h * progress);
    sprite.position.set(x, y + (h - filledHeight));
    sprite.width = w;
    sprite.height = filledHeight;
  } else {
    sprite.position.set(x, y);
    sprite.width = Math.round(w * progress);
    sprite.height = h;
  }
  applyDestinationToSprite(sprite, interpolated);
}

/** A `#SRC_SLIDER`: its knob moved along its `range` by its value (0..1) from the LR2 state. */
function drawSlider(ctx: LR2PlayElementsContext, slider: LR2SliderElement): void {
  const interpolated = evaluateLR2ElementDst(ctx, slider);
  const { x, y, w, h } = normalizeRect(interpolated);
  if (w === 0 || h === 0) return;
  const baseTexture = ctx.textures.get(slider.source.imagePath);
  if (!baseTexture) return;
  const cropTexture = createCroppedTexture(baseTexture, slider.source);
  if (!cropTexture) return;
  const offset = slider.range * (ctx.lr2State?.slider(slider.type) ?? 0);
  let drawX = x;
  let drawY = y;
  switch (slider.muki) {
    case 'down':
      drawY = y + offset;
      break;
    case 'up':
      drawY = y - offset;
      break;
    case 'right':
      drawX = x + offset;
      break;
    case 'left':
      drawX = x - offset;
      break;
  }
  const sprite = ctx.skinLayerPool.acquireSprite();
  sprite.texture = cropTexture;
  sprite.label = drawLabel(slider, 'slider', slider.type);
  sprite.position.set(drawX, drawY);
  sprite.width = w;
  sprite.height = h;
  applyDestinationToSprite(sprite, interpolated);
}

/**
 * One side's judge plate and NOWCOMBO digits, as one assembly centred on that side's lanes and drawn above the notes.
 * Each side reads its own judgment and combo as of its last hit, so a DP play's sides tick independently. A side the
 * skin authors no elements for falls back to the 1P ones.
 */
function drawJudgeAndCombo(ctx: LR2PlayElementsContext, side: '1P' | '2P'): void {
  const skin = ctx.skin;
  const state = ctx.play.judgeSideState[side];
  if (!state.judge || ctx.play.currentSeconds() > state.until) return;
  const judgeKind = resolveJudgeSkinKind(state.judge);
  if (!judgeKind) return;
  const comboKind = lastJudgeToNowComboKind(state.judge);
  const judgeElements = (side === '2P' ? skin.judges2P : skin.judges)[judgeKind] ?? skin.judges[judgeKind];
  const judgeAnchor = judgeElements?.[0]?.destination;
  if (!judgeElements?.length || !judgeAnchor) return;
  const comboElement = comboKind
    ? (skin.nowCombos.find(
        (entry) => entry.kind === comboKind && entry.side === side && isLR2DestinationVisible(ctx, entry.destination),
      ) ?? skin.nowCombos.find((entry) => entry.kind === comboKind && isLR2DestinationVisible(ctx, entry.destination)))
    : undefined;
  // During an expert or grade course LR2 shows the course combo here, as numbers 104 / 105 do.
  const combo = resolveLR2JudgeCombo(state.combo, state.courseCombo, ctx.courseKind);
  const visibleCombo = comboKind && combo > 0 ? combo : 0;
  // Centre the plate and the combo together on the side's lanes, rather than at LR2's static x = 73 / 185.
  const laneCenter = resolveLaneCenter(skin, side);
  const judgeRight = judgeAnchor.x + judgeAnchor.w;
  let assemblyRight = judgeRight;
  if (comboElement && visibleCombo > 0) {
    const comboLeft = judgeAnchor.x + comboElement.destination.x;
    assemblyRight = Math.max(judgeRight, comboLeft + comboElement.destination.w * visibleCombo.toString().length);
  }
  const offsetX = laneCenter - (judgeAnchor.x + assemblyRight) / 2;
  // The plate animates on its side's judge timer (46 / 47), restarted on every hit there.
  const judgeElapsed = ctx.timers.elapsed(side === '2P' ? LR2_TIMER.JUDGE_2P : LR2_TIMER.JUDGE_1P);
  for (const element of judgeElements) {
    if (!isLR2DestinationVisible(ctx, element.destination)) continue;
    const dst = evaluateLR2ElementDst(ctx, element);
    if (dst.w === 0 || dst.h === 0) continue;
    const baseTexture = ctx.textures.get(element.source.imagePath);
    if (!baseTexture) continue;
    const texture = createCroppedTexture(baseTexture, pickAnimatedCell(element.source, judgeElapsed));
    if (!texture) continue;
    const sprite = ctx.overlayLayerPool.acquireSprite();
    sprite.texture = texture;
    sprite.label = `nowjudge[side=${side},kind=${judgeKind}]`;
    sprite.position.set(dst.x + offsetX, dst.y);
    sprite.width = dst.w;
    sprite.height = dst.h;
    applyDestinationToSprite(sprite, dst);
  }
  if (comboElement && visibleCombo > 0) {
    renderNowComboElement(
      ctx.overlayLayerPool,
      comboElement,
      visibleCombo,
      judgeAnchor,
      ctx.textures,
      judgeElapsed,
      offsetX,
      evaluateLR2ElementDst(ctx, comboElement),
    );
  }
}

/**
 * The horizontal centre of one side's lanes in the skin's `#DST_NOTE` rects (1P indices 0-9, 2P 10-19), or of the
 * built-in playfield when the side has none.
 */
function resolveLaneCenter(skin: LR2Skin, side: '1P' | '2P'): number {
  const sideLanes: LR2DestinationRect[] = [];
  skin.laneRects.forEach((rect, index) => {
    if (!rect) return;
    if (index >= 10 !== (side === '2P')) return;
    sideLanes.push(rect);
  });
  if (sideLanes.length === 0) return PLAYFIELD.x + PLAYFIELD.w / 2;
  const leftmost = sideLanes.reduce((acc, lane) => Math.min(acc, lane.x), sideLanes[0]!.x);
  const rightmost = sideLanes.reduce((acc, lane) => Math.max(acc, lane.x + lane.w), sideLanes[0]!.x + sideLanes[0]!.w);
  return (leftmost + rightmost) / 2;
}

/**
 * The skin's text drawing state: the `#LR2FONT` bitmap fonts once loaded, the glyph containers of bitmap-font texts on
 * their own sub-layer of the skin layer, and the system-font styles.
 *
 * A bitmap-font text is a whole `Container` of glyph sprites (`makeLR2BitmapTextSprite`), which the layer pools cannot
 * recycle, so each element keeps its container while its string, size, tint and alpha stay the same (only its position
 * follows the destination), and the sub-layer holds exactly the containers the frame shows.
 */
export class LR2PlayText {
  /** The sub-layer of the skin layer the bitmap-font texts draw on, kept last so their glyphs sit on the chrome. */
  public readonly layer: Container = new Container();
  private fonts: ReadonlyMap<number, LR2LoadedFont> = new Map();
  private readonly cache = new Map<LR2TextElement, { key: string; font: LR2LoadedFont; node: Container }>();
  private readonly shown: Container[] = [];
  private extras: Container[] = [];
  private previousExtras: Container[] = [];
  /**
   * System-font styles by `(st, fontSize, tint)`: the same `TextStyle` every frame, as a new one (even an equal one)
   * makes Pixi lay the paragraph out again.
   */
  private readonly styles = new Map<string, TextStyle>();
  private judgeStyle: TextStyle | undefined;

  public constructor() {
    this.layer.eventMode = 'none';
  }

  /** The skin's bitmap fonts have loaded. */
  public setFonts(fonts: ReadonlyMap<number, LR2LoadedFont>): void {
    this.fonts = fonts;
  }

  public font(index: number): LR2LoadedFont | undefined {
    return this.fonts.get(index);
  }

  /** The system-font style of text `st` at `fontSize` in `tint`. */
  public textStyle(st: number, fontSize: number, tint: number): TextStyle {
    const key = `${st}:${fontSize}:${tint}`;
    let style = this.styles.get(key);
    if (!style) {
      style = new TextStyle({ fill: tint, fontSize, fontWeight: '600', fontFamily: LR2_TEXT_FALLBACK_FONT });
      this.styles.set(key, style);
    }
    return style;
  }

  /** The style of the judgement drawn as text when the skin draws none. */
  public fallbackJudgeStyle(): TextStyle {
    this.judgeStyle ??= new TextStyle({
      fill: BLUE,
      stroke: { color: 0xffffff, width: 2 },
      fontSize: 32,
      fontWeight: '800',
      fontFamily: LR2_JUDGE_FALLBACK_FONT,
    });
    return this.judgeStyle;
  }

  public beginFrame(): void {
    this.shown.length = 0;
  }

  /**
   * Shows `text`'s `value` this frame in bitmap font `loaded`: its cached container while unchanged (moved to the
   * destination), else a new one. An element drawn twice in one frame gets an uncached second container for the frame.
   */
  public showBitmapText(
    text: LR2TextElement,
    value: string,
    interpolated: LR2DestinationRect,
    loaded: LR2LoadedFont,
  ): void {
    const rect = normalizeRect(interpolated);
    const key = `${value}\u0000${rect.w}|${rect.h}|${interpolated.r}|${interpolated.g}|${interpolated.b}|${interpolated.alpha}`;
    const cached = this.cache.get(text);
    if (cached !== undefined && this.shown.includes(cached.node)) {
      const extra = makeLR2BitmapTextSprite(value, text, interpolated, loaded);
      this.extras.push(extra);
      this.shown.push(extra);
      return;
    }
    if (cached !== undefined && cached.key === key && cached.font === loaded) {
      cached.node.position.set(rect.x, rect.y);
      this.shown.push(cached.node);
      return;
    }
    cached?.node.destroy({ children: true });
    const node = makeLR2BitmapTextSprite(value, text, interpolated, loaded);
    this.cache.set(text, { key, font: loaded, node });
    this.shown.push(node);
  }

  /**
   * Brings the sub-layer in line with this frame's containers (touching it only when they changed), frees last frame's
   * uncached ones, and keeps the sub-layer last in `skinLayer`: a pool that grew adds its children at the end. It is
   * re-added only when not last, as re-adding a child Pixi holds rebuilds the render group's draw list.
   */
  public endFrame(skinLayer: Container): void {
    const layer = this.layer;
    let same = layer.children.length === this.shown.length;
    for (let index = 0; same && index < this.shown.length; index += 1) {
      same = layer.children[index] === this.shown[index];
    }
    if (!same) {
      layer.removeChildren();
      if (this.shown.length > 0) layer.addChild(...this.shown);
    }
    for (const extra of this.previousExtras) extra.destroy({ children: true });
    this.previousExtras = this.extras;
    this.extras = [];
    const skinChildren = skinLayer.children;
    if (skinChildren[skinChildren.length - 1] !== layer) skinLayer.addChild(layer);
  }

  /** Drops the cached containers, the fonts and the styles: the skin is gone. */
  public clear(): void {
    this.layer.removeChildren();
    for (const { node } of this.cache.values()) node.destroy({ children: true });
    this.cache.clear();
    this.shown.length = 0;
    for (const extra of [...this.extras, ...this.previousExtras]) extra.destroy({ children: true });
    this.extras = [];
    this.previousExtras = [];
    this.fonts = new Map();
    this.styles.clear();
  }
}
