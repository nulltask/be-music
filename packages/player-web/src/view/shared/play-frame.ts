/**
 * The frame of the built-in and LR2 gameplay scenes (`CoreGameplayView`): the layer tree under the scene's root, its
 * fit to the screen with the design-rect clip and background, the fade in and out, and the per-frame pass that draws
 * the chrome, the BGA and the playfield into it.
 *
 * The functions read and write the scene's state through {@link PlayFrameContext}; the scene passes itself.
 */

import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import { resolveStageOrientation } from '@be-music/skin-sdk';
import type { Application, Container, Graphics, Text } from 'pixi.js';
import type { AudioAnalyzer, AudioFeatures } from '../../runtime/audio-analysis.ts';
import type { GameplayStageSize } from '../../scene/core/gameplay-theme.ts';
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

/** How long the play screen takes to fade up from black as it appears on a be-music skin. */
const BE_MUSIC_ENTER_FADE_MS = 400;

/** The scene's members the frame passes use: `CoreGameplayView`'s members of these names. */
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
  readonly exiting: boolean;
  readonly exitFadeOutMs: number;
  readonly exitFadeStartedAt: number | undefined;
  enteredAt: number | undefined;
  readonly paintsThroughBeMusicSkin: boolean;
  audioFrame: AudioFeatures | undefined;
  readonly audioAnalyzer: AudioAnalyzer | undefined;
  readonly perf: PerfTracker;
  readonly timingResolver: TimingResolver | undefined;
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
  stampDesignRect(ctx, ctx.theme.stageSize());
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
  // Theme sub-layers (e.g. the LR2 bitmap-text layer) must be parked inside `skinLayer` before the scene graph is
  // assembled so their z-order matches the theme's own layering.
  ctx.theme.attachThemeLayers();
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
  if (!ctx.exiting) {
    let alpha = 1;
    if (ctx.paintsThroughBeMusicSkin) {
      const now = performance.now();
      ctx.enteredAt ??= now;
      alpha = Math.min(1, (now - ctx.enteredAt) / BE_MUSIC_ENTER_FADE_MS);
    }
    if (ctx.designRoot.alpha !== alpha) ctx.designRoot.alpha = alpha;
    return;
  }
  const fadeOutMs = ctx.exitFadeOutMs;
  const fadeStart = ctx.exitFadeStartedAt;
  if (fadeStart === undefined || fadeOutMs <= 0) {
    // Fade hasn't been seeded (or the theme has no fade-out); leave designRoot at full alpha. Close-only themes keep
    // the scene visible until the host transitions us out.
    if (ctx.designRoot.alpha !== 1) ctx.designRoot.alpha = 1;
    return;
  }
  const elapsed = ctx.playClock() - fadeStart;
  ctx.designRoot.alpha = Math.max(0, Math.min(1, 1 - elapsed / fadeOutMs));
}

export function render(ctx: PlayFrameContext, seconds: number): void {
  const screenWidth = ctx.app.screen.width;
  const screenHeight = ctx.app.screen.height;
  const { width: designWidth, height: designHeight } = ctx.theme.stageSize();
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
  stampDesignRect(ctx, ctx.theme.stageSize());
  ctx.host?.setStageOrientation(resolveStageOrientation(ctx.theme.stageSize()));
  applyExitFadeAlpha(ctx);
  ctx.audioFrame = ctx.audioAnalyzer?.sample(ctx.playClock());
  ctx.perf.time('renderSkin', () => ctx.theme.renderThemeLayer(designWidth, designHeight));
  // LR2 negative-BPM reversal: the event pump stops firing BGA cues there, so the cue clock is clamped (freeze, not
  // rewind) while an already-playing movie keeps running on the true clock. All other `seconds` readers here
  // (progress ratio, time readouts, judge-until comparisons) stay on the true clock.
  const reversalSeconds = ctx.timingResolver?.reversal?.seconds;
  const bgaCueSeconds = reversalSeconds === undefined ? seconds : Math.min(seconds, reversalSeconds);
  ctx.perf.time('renderBga', () => renderBga(ctx, seconds, bgaCueSeconds));
  ctx.perf.time('renderLanes', () => renderLanes(ctx, designWidth, designHeight));
  ctx.perf.time('renderNotes', () => renderNotes(ctx, seconds, designHeight));
  ctx.perf.time('renderShutter', () => renderShutter(ctx));
  ctx.perf.time('renderBombs', () => renderBombs(ctx));
  ctx.perf.time('renderText', () => renderText(ctx, designWidth, designHeight, seconds));
}

/** Redraws the design clip mask and background for a stage of `size`, when it differs from the last one drawn. */
function stampDesignRect(ctx: PlayFrameContext, size: GameplayStageSize): void {
  if (size.width === ctx.stampedDesignWidth && size.height === ctx.stampedDesignHeight) return;
  ctx.stampedDesignWidth = size.width;
  ctx.stampedDesignHeight = size.height;
  ctx.designClipMask.clear().rect(0, 0, size.width, size.height).fill(0xffffff);
  ctx.background.clear().rect(0, 0, size.width, size.height).fill(BG);
}
