/**
 * The frame of the built-in and LR2 play views: the layer tree under the view's root, its fit to the screen with the
 * design-rect clip and background, the fade in and out, and the per-frame pass that draws the view's chrome
 * (`PlayChrome`), the BGA and the playfield into it.
 *
 * The functions read and write the view's state through {@link PlayFrameContext}; the play view passes itself.
 */

import { resolveStageOrientation } from '@be-music/skin-sdk';
import type { Application, Container, Graphics, Text } from 'pixi.js';
import type { AudioFeatures } from '../../runtime/audio-analysis.ts';
import type { CoreGameplayViewOptions } from '../../scene/core/gameplay-options.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from '../../scene/core/viewport.ts';
import { BG } from '../../scene/gameplay-constants.ts';
import type { PixiSceneHost } from '../../scene/host.ts';
import type { PerfTracker } from '../../scene/perf.ts';
import { renderBga, type BgaRendererContext } from './bga-renderer.ts';
import { renderBombs } from './playfield/bombs.ts';
import type { PlayfieldContext } from './playfield/context.ts';
import { renderLanes } from './playfield/lanes.ts';
import { renderNotes } from './playfield/notes.ts';
import { renderShutter } from './playfield/shutter.ts';
import { renderText } from './playfield/text.ts';
import type { PlayfieldStage } from '../types.ts';

/** How long the play screen takes to fade up from black as it appears on a be-music skin. */
const BE_MUSIC_ENTER_FADE_MS = 400;

/** The view's members the frame passes use: a play view's members of these names. */
export interface PlayFrameContext extends PlayfieldContext, BgaRendererContext {
  readonly options: Readonly<
    Pick<
      CoreGameplayViewOptions,
      'beMusicEffects' | 'showInvisibleNotes' | 'judgedNoteDisplay' | 'bga' | 'autoPlay' | 'nonstop'
    >
  >;
  host: PixiSceneHost | undefined;
  readonly app: Application;
  readonly root: Container;
  readonly designRoot: Container;
  readonly designClipMask: Graphics;
  readonly viewportBackground: Graphics;
  readonly background: Graphics;
  readonly bgaLayer: Container;
  readonly skinLayer: Container;
  readonly noteLayer: Container;
  readonly bombLayer: Container;
  readonly overlayLayer: Container;
  readonly textLayer: Container;
  readonly overlay: Text;
  stampedDesignWidth: number;
  stampedDesignHeight: number;
  cachedScreenWidth: number;
  cachedScreenHeight: number;
  enteredAt: number | undefined;
  readonly paintsThroughBeMusicSkin: boolean;
  audioFrame: AudioFeatures | undefined;
  readonly perf: PerfTracker;
}

/** Builds the scene graph under {@link root} on the first {@link prepare} or {@link enter}; later calls no-op. */
export function build(ctx: PlayFrameContext, host: PixiSceneHost): void {
  if (ctx.host !== undefined) return;
  ctx.host = host;
  // Label every top-level node so the PixiJS Devtools "Scene Graph" panel reads as `gameplay > {bga,skin,lane,…}`
  // instead of a wall of `Container` rows. Layer ordering matches `addChild` below.
  ctx.root.label = 'gameplay/scene';
  ctx.designRoot.label = 'gameplay/root';
  ctx.viewportBackground.label = 'gameplay/viewport-bg';
  ctx.background.label = 'gameplay/background';
  ctx.bgaLayer.label = 'gameplay/bga';
  ctx.skinLayer.label = 'gameplay/skin';
  ctx.laneLayer.label = 'gameplay/lanes';
  ctx.noteLayer.label = 'gameplay/notes';
  ctx.bombLayer.label = 'gameplay/bombs';
  ctx.overlayLayer.label = 'gameplay/overlay';
  ctx.textLayer.label = 'gameplay/text';
  ctx.overlay.label = 'gameplay/pause-overlay';
  ctx.designClipMask.label = 'gameplay/design-clip';
  // The mask and design background only change shape with the stage (a rotation can switch a skin between its
  // landscape and portrait stages), so they are stamped here and restamped by `render` only when the stage changes,
  // skipping the per-frame rebuild that was contributing to the rAF handler's runtime.
  stampDesignRect(ctx, ctx.playfieldSkin.stage);
  // The gameplay scene owns its own pointerdown listener on the canvas itself (`this.focus`) and a window-level
  // keydown listener — none of the per-layer children need to participate in Pixi's interaction system. Marking
  // each render-only Container as `eventMode = 'none'` lets the interaction manager skip the entire subtree
  // during hit-testing every pointermove / pointerdown, which is otherwise an O(N) walk over hundreds of skin
  // children per event.
  //
  // CAUTION: `this.background` and `this.designClipMask` are intentionally NOT marked `'none'`. The mask is
  // referenced via `this.designRoot.mask = this.designClipMask` and Pixi v8's mask resolution path interacts with the
  // event-mode setting in subtle ways — clearing it on the mask Graphics has been observed to leave the root
  // unclipped (residual previous-frame content visible, e.g. the LR2 intro title strip stays painted across
  // subsequent frames) and has the side effect of dropping the rendered frame rate. The mask + the static
  // `background` Graphics don't carry interactive children either way, so leaving their `eventMode` at the
  // default is the safest choice.
  for (const layer of [
    ctx.bgaLayer,
    ctx.skinLayer,
    ctx.laneLayer,
    ctx.noteLayer,
    ctx.shutterLayer,
    ctx.bombLayer,
    ctx.overlayLayer,
    ctx.textLayer,
  ]) {
    layer.eventMode = 'none';
  }
  // The view's own sub-layers (e.g. the LR2 bitmap-text layer) must be parked inside `skinLayer` before the scene graph
  // is assembled so their z-order matches the skin's own layering.
  ctx.chrome.attachLayers?.();
  ctx.designRoot.addChild(
    ctx.background,
    ctx.bgaLayer,
    ctx.skinLayer,
    ctx.laneLayer,
    ctx.noteLayer,
    ctx.shutterLayer,
    ctx.bombLayer,
    ctx.overlayLayer,
    ctx.textLayer,
    ctx.overlay,
    ctx.designClipMask,
  );
  // Clip every child of `designRoot` to the design rectangle. The mask graphic itself is a child of `designRoot`, so
  // the same viewport scale / translate applies to both the mask and the masked content — Pixi clips against the
  // mask's world-space bounds, which matches the on-screen design rectangle.
  ctx.designRoot.mask = ctx.designClipMask;
  ctx.shutterLayer.label = 'gameplay/shutter';
  ctx.root.addChild(ctx.viewportBackground, ctx.designRoot);
}

/**
 * Drives the global "fade everything to black" tween while {@link beginExitSequence} is in flight. The skin's
 * authored `#FADEOUT` overlay (if any) only covers whatever the skin artist drew — gameplay-side layers (notes, lane
 * chrome, BGA, shutters, bombs, overlay text) sit *above* `skinLayer` in `designRoot` and would otherwise stay
 * fully visible until the scene is torn down. Fading `designRoot` itself dims every layer uniformly;
 * `viewportBackground` is a sibling of `designRoot` (under `root`), so the page reveals the same `BG` (near-black)
 * the playfield sat against, giving a clean fade-to-black appearance regardless of which lanes are still painting.
 *
 * Called every frame from {@link render}; cheap when the exit sequence isn't running (`designRoot.alpha` is set
 * back to 1 only when it diverges from 1, so steady-state has no GPU cost).
 */
function applyExitFadeAlpha(ctx: PlayFrameContext): void {
  if (!ctx.play.exiting) {
    let alpha = 1;
    if (ctx.paintsThroughBeMusicSkin) {
      const now = performance.now();
      ctx.enteredAt ??= now;
      alpha = Math.min(1, (now - ctx.enteredAt) / BE_MUSIC_ENTER_FADE_MS);
    }
    if (ctx.designRoot.alpha !== alpha) ctx.designRoot.alpha = alpha;
    return;
  }
  const fadeOutMs = ctx.play.exitFadeOutMs;
  const fadeStart = ctx.play.exitFadeStartedAt;
  if (fadeStart === undefined || fadeOutMs <= 0) {
    // Fade hasn't been seeded (or the theme has no fade-out); leave designRoot at full alpha. Close-only themes keep
    // the scene visible until the host transitions us out.
    if (ctx.designRoot.alpha !== 1) ctx.designRoot.alpha = 1;
    return;
  }
  const elapsed = ctx.play.playClock() - fadeStart;
  ctx.designRoot.alpha = Math.max(0, Math.min(1, 1 - elapsed / fadeOutMs));
}

/**
 * Draws one frame of the play at chart time `seconds`. `audioFrame` is the mix analysed for this frame (a session that
 * already sampled it hands it over, so the analyser is not stepped twice); without one the play's analyser is sampled.
 */
export function render(
  ctx: PlayFrameContext,
  seconds: number,
  audioFrame: AudioFeatures | undefined = ctx.play.audioAnalyzer?.sample(ctx.play.playClock()),
): void {
  const screenWidth = ctx.app.screen.width;
  const screenHeight = ctx.app.screen.height;
  const stage = ctx.playfieldSkin.stage;
  const { width: designWidth, height: designHeight } = stage;
  const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
  setDesignTextResolution(resolveDesignTextResolution(viewport.scale, ctx.app.renderer.resolution));
  setDesignPixelRatio(viewport.scale * ctx.app.renderer.resolution);
  // Only rebuild the static rect graphics when their backing dimensions actually change. The previous unconditional
  // `.clear().rect().fill()` chain ran on every rAF tick and rebuilt the GraphicsContext for each — Pixi v8 has no
  // change-detection built in.
  if (ctx.cachedScreenWidth !== screenWidth || ctx.cachedScreenHeight !== screenHeight) {
    ctx.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
    ctx.cachedScreenWidth = screenWidth;
    ctx.cachedScreenHeight = screenHeight;
  }
  ctx.designRoot.position.set(viewport.x, viewport.y);
  ctx.designRoot.scale.set(viewport.scale);
  stampDesignRect(ctx, stage);
  ctx.host?.setStageOrientation(resolveStageOrientation(stage));
  applyExitFadeAlpha(ctx);
  ctx.audioFrame = audioFrame;
  ctx.perf.time('renderSkin', () => ctx.chrome.draw(designWidth, designHeight));
  // LR2 negative-BPM reversal: the event pump stops firing BGA cues there, so the cue clock is clamped (freeze, not
  // rewind) while an already-playing movie keeps running on the true clock. All other `seconds` readers here
  // (progress ratio, time readouts, judge-until comparisons) stay on the true clock.
  const reversalSeconds = ctx.play.timingResolver?.reversal?.seconds;
  const bgaCueSeconds = reversalSeconds === undefined ? seconds : Math.min(seconds, reversalSeconds);
  ctx.perf.time('renderBga', () => renderBga(ctx, seconds, bgaCueSeconds));
  ctx.perf.time('renderLanes', () => renderLanes(ctx, designWidth, designHeight));
  ctx.perf.time('renderNotes', () => renderNotes(ctx, seconds, designHeight));
  ctx.perf.time('renderShutter', () => renderShutter(ctx));
  ctx.perf.time('renderBombs', () => renderBombs(ctx));
  ctx.perf.time('renderText', () => renderText(ctx, designWidth, designHeight, seconds));
}

/** Redraws the design clip mask and background for a stage of `size`, when it differs from the last one drawn. */
function stampDesignRect(ctx: PlayFrameContext, size: PlayfieldStage): void {
  if (size.width === ctx.stampedDesignWidth && size.height === ctx.stampedDesignHeight) return;
  ctx.stampedDesignWidth = size.width;
  ctx.stampedDesignHeight = size.height;
  ctx.designClipMask.clear().rect(0, 0, size.width, size.height).fill(0xffffff);
  ctx.background.clear().rect(0, 0, size.width, size.height).fill(BG);
}
