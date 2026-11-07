import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { formatPlayVariantLabel, resolveDifficultyName, type LibraryChart } from '@be-music/player-skin-sdk';
import type { PixiDecideFrame, PixiDecideSkin } from '../pixi-kit/index.ts';
import { drawReticle } from './draw.ts';
import { addSynesthesiaText } from './figures.ts';
import {
  fitInside,
  resolveDecideLayout,
  resolveHandoffLevel,
  resolveLaunchWarp,
  SYNESTHESIA_DECIDE_MS,
  takeLaunchHandoff,
  type DecideLayout,
  type LaunchWarpPose,
} from './launch-warp.ts';
import { hsvToHex } from './space.ts';
import { SYN_AMBER, SYN_DIM, SYN_DISPLAY_FONT, SYN_MIST, SYN_TEXT_FONT, SYN_WHITE, sceneHue } from './style.ts';
import { drawLaunchTitle, drawVeil, WarpStarField } from './warp-field.ts';

/** How far the stage file glows through the space behind the warp. */
const STAGE_FILE_ALPHA = 0.2;
/** How much the stage file pushes in over the screen: the camera keeps flying towards it. */
const STAGE_FILE_PUSH = 0.06;

export const synesthesiaDecideSkin: PixiDecideSkin = {
  durationMs: SYNESTHESIA_DECIDE_MS,
  render: (frame) => renderSynesthesiaDecide(frame),
};

/** One decide screen's state, kept on its backdrop: the star field, the warp's clock, and the chart's images. */
interface DecideState {
  readonly field: WarpStarField;
  readonly stageFile: Sprite;
  /** Added to the screen's elapsed time to give the time since the chart was picked. */
  readonly sinceLaunchOffsetMs: number;
  /** The select screen's music level as it handed over, and when the decide screen started. */
  readonly handoffLevel: number;
  readonly startedAtMs: number;
  readonly textures: Map<ImageBitmap, Texture>;
}

const states = new WeakMap<Container, DecideState>();

function stateFor(frame: PixiDecideFrame): DecideState {
  const existing = states.get(frame.backdrop);
  if (existing) return existing;
  // Picked on the select screen: carry its warp on. Reached any other way (a course's first stage), start one here.
  const handoff = takeLaunchHandoff(frame.chart.id, frame.nowMs);
  const field = new WarpStarField(handoff?.travel ?? 0);
  const stageFile = new Sprite();
  stageFile.anchor.set(0.5);
  stageFile.visible = false;
  stageFile.label = 'synesthesia-decide/stage-file';
  // The stage file glows through the space, behind the stars and their trails.
  field.imageLayer.addChild(stageFile);
  frame.backdrop.addChild(field.view);
  const textures = new Map<ImageBitmap, Texture>();
  frame.backdrop.once('destroyed', () => {
    for (const texture of textures.values()) texture.destroy(true);
    textures.clear();
  });
  const state: DecideState = {
    field,
    stageFile,
    sinceLaunchOffsetMs: handoff === undefined ? 0 : frame.nowMs - handoff.launchAtMs - frame.elapsedMs,
    handoffLevel: handoff?.level ?? 0,
    startedAtMs: frame.nowMs,
    textures,
  };
  states.set(frame.backdrop, state);
  return state;
}

function textureOf(state: DecideState, image: ImageBitmap): Texture {
  let texture = state.textures.get(image);
  if (!texture) {
    texture = Texture.from(image);
    state.textures.set(image, texture);
  }
  return texture;
}

/**
 * Synesthesia decide: the launch warp the select screen started, carried on. The camera keeps dashing through the
 * particle field while the chosen title finishes condensing out of wide-tracked light and the lock-on reticle closes on
 * it; the genre lights over it, the mode, difficulty and level rise under it with the banner, and the stage file glows
 * through the space. Then the screen falls to black for the play's count-in.
 */
export function renderSynesthesiaDecide(frame: PixiDecideFrame): void {
  const { designWidth, designHeight, layer, chart, effects } = frame;
  const state = stateFor(frame);
  const pose = resolveLaunchWarp(frame.elapsedMs + state.sinceLaunchOffsetMs, effects, {
    elapsedMs: frame.elapsedMs,
    durationMs: SYNESTHESIA_DECIDE_MS,
  });
  const layout = resolveDecideLayout(designWidth, designHeight);
  const level = resolveHandoffLevel(state.handoffLevel, frame.nowMs - state.startedAtMs);
  state.field.update(designWidth, designHeight, frame.nowMs, chart.bpm, pose.warp, effects, level);
  poseStageFile(state, frame, pose);

  const accent = hsvToHex(sceneHue(frame.nowMs / 1000), 0.6, 1);
  drawLaunchTitle(layer, chart, layout, designWidth, pose, 1);
  drawGenre(layer, chart, layout, pose, accent);
  drawDetails(layer, chart, layout, pose);
  drawBanner(layer, state, frame, layout, pose);
  drawVeil(layer, designWidth, designHeight, pose.dark);
}

/** The stage file over the whole stage (covering it), faint, pushing in as the screen runs; hidden without one. */
function poseStageFile(state: DecideState, frame: PixiDecideFrame, pose: LaunchWarpPose): void {
  const image = frame.chartImage(frame.chart, 'stageFile');
  const sprite = state.stageFile;
  sprite.visible = image !== undefined;
  if (image === undefined) return;
  sprite.texture = textureOf(state, image);
  const push = frame.effects === 'full' ? STAGE_FILE_PUSH * Math.min(1, frame.elapsedMs / SYNESTHESIA_DECIDE_MS) : 0;
  const cover = Math.max(frame.designWidth / image.width, frame.designHeight / image.height) * (1 + push);
  sprite.position.set(frame.designWidth / 2, frame.designHeight / 2);
  sprite.scale.set(cover);
  sprite.alpha = STAGE_FILE_ALPHA * pose.detailAlpha;
}

/** The genre over the reticle, in the scene's accent light, as it heads the select screen's card. */
function drawGenre(
  layer: Container,
  chart: LibraryChart,
  layout: DecideLayout,
  pose: LaunchWarpPose,
  accent: number,
): void {
  const genre = chart.genre?.trim();
  if (!genre) return;
  addSynesthesiaText(layer, genre.toUpperCase(), layout.centerX, layout.genreY + pose.detailRise * 0.6, {
    size: 9,
    weight: '500',
    fill: accent,
    fontFamily: SYN_TEXT_FONT,
    letterSpacing: 3,
    anchorX: 0.5,
    anchorY: 0.5,
    maxWidth: layout.lineMaxWidth,
    alpha: pose.genreAlpha * pose.titleAlpha,
  });
}

/** Gap (px) between the details' items, and the difficulty badge's padding and height. */
const DETAIL_GAP = 18;
const BADGE_PAD_X = 10;
const BADGE_H = 16;

/** The mode, the difficulty in an amber badge, and the level, centred in one row under the reticle. */
function drawDetails(layer: Container, chart: LibraryChart, layout: DecideLayout, pose: LaunchWarpPose): void {
  const row = new Container();
  row.label = 'synesthesia-decide/details';
  const label = { size: 9, fill: SYN_DIM, fontFamily: SYN_DISPLAY_FONT, letterSpacing: 2, anchorY: 0.5 } as const;
  let x = 0;
  const mode = addSynesthesiaText(row, formatPlayVariantLabel(chart), x, 0, { ...label, fill: SYN_MIST });
  x += mode.width + DETAIL_GAP;
  const difficulty = resolveDifficultyName(chart);
  if (difficulty !== undefined) {
    const badge = new Graphics();
    row.addChild(badge);
    const name = addSynesthesiaText(row, difficulty, x + BADGE_PAD_X, 0, { ...label, fill: SYN_AMBER });
    const badgeW = name.width + BADGE_PAD_X * 2;
    badge.rect(x, -BADGE_H / 2, badgeW, BADGE_H).stroke({ color: SYN_AMBER, width: 1, alpha: 0.7 });
    x += badgeW + DETAIL_GAP;
  }
  const levelLabel = addSynesthesiaText(row, 'LEVEL', x, 0, label);
  x += levelLabel.width + 8;
  const level = chart.playLevel !== undefined && String(chart.playLevel).trim() !== '' ? String(chart.playLevel) : '-';
  const value = addSynesthesiaText(row, level, x, 0, {
    size: 14,
    fill: SYN_WHITE,
    fontFamily: SYN_DISPLAY_FONT,
    anchorY: 0.5,
    dropShadow: { color: SYN_WHITE, distance: 0, blur: 6, alpha: 0.5 },
  });
  x += value.width;
  // Centre the row, squeezed to the line width when it runs long.
  const squeeze = Math.min(1, layout.lineMaxWidth / Math.max(1, x));
  row.scale.set(squeeze, 1);
  row.position.set(layout.centerX - (x * squeeze) / 2, layout.detailY + pose.detailRise);
  row.alpha = pose.detailAlpha * pose.titleAlpha;
  layer.addChild(row);
}

/** The banner under the details, in a hairline frame with lock-on corners; nothing without one or without room. */
function drawBanner(
  layer: Container,
  state: DecideState,
  frame: PixiDecideFrame,
  layout: DecideLayout,
  pose: LaunchWarpPose,
): void {
  const image = frame.chartImage(frame.chart, 'banner');
  if (image === undefined) return;
  const size = fitInside(image.width, image.height, layout.bannerMaxWidth, layout.bannerMaxHeight);
  if (size.width <= 0 || size.height <= 0) return;
  const group = new Container();
  group.label = 'synesthesia-decide/banner';
  const x = layout.centerX - size.width / 2;
  const y = layout.bannerTop + pose.detailRise * 1.4;
  const sprite = new Sprite(textureOf(state, image));
  sprite.position.set(x, y);
  sprite.width = size.width;
  sprite.height = size.height;
  const frameLines = new Graphics();
  frameLines.rect(x - 0.5, y - 0.5, size.width + 1, size.height + 1).stroke({ color: SYN_MIST, width: 1, alpha: 0.3 });
  drawReticle(frameLines, x - 3, y - 3, size.width + 6, size.height + 6, SYN_WHITE, 0.8, { arm: 7, width: 1.25 });
  group.addChild(sprite, frameLines);
  group.alpha = pose.detailAlpha * pose.titleAlpha;
  layer.addChild(group);
}
