// Static preview scene for a beatoraja play skin.
//
// Mounts a {@link BeatorajaPlaySkinView} inside the shared `PixiSceneHost`, scales it to fit the screen, and ticks
// it once per frame from `performance.now()` so the cycle-based animations (key beams, bombs, hidden cover) play.
// No engine signals — every runtime op-code (judge / combo / score / lamp) is missing, so combo readouts and
// lamp icons stay on their initial frames.
//
// This is the "does my parser + renderer pipeline reach the screen" milestone. The full gameplay integration
// (notes, judge flashes, BGA, key-on flashes, lamps) lands in follow-up patches that wire the engine signals into
// `BeatorajaPlaySkinView`'s op-set / timer-start callbacks.

import { Container, Ticker } from 'pixi.js';
import type { BeatorajaSkin, BeatorajaSkinConfig } from '@be-music/beatoraja-skin';
import { buildBaseOpSet } from '@be-music/beatoraja-skin';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import type { PixiScene, PixiSceneHost } from './pixi-scene-host.ts';

export interface BeatorajaPlaySkinPreviewOptions {
  skin: BeatorajaSkin;
  textures: BeatorajaTextureCache;
  /**
   * Skin-config picks the user confirmed on the option dialog (or empty for the default theme path). The preview
   * scene treats every option op-code as ALWAYS active so the matching `if`/`op` branches render — that's the
   * "preview the chosen layout" UX. Once the engine integration arrives, runtime ops (judge / lamp / etc.) are
   * union-merged into this set.
   */
  skinConfig?: BeatorajaSkinConfig;
  /** Called when the user presses Escape. Wired to `host.setScene(undefined)` upstream. */
  onExit?: () => void;
  /**
   * Optional resolver for `text[].ref` — the host can plug in placeholder strings (`'<title>'`, `'<artist>'`,
   * etc.) so text destinations are visible in the preview even though the engine isn't running yet. Returning
   * `undefined` (or omitting the option entirely) keeps each text node empty.
   */
  resolveTextContent?: (refOp: number) => string | undefined;
}

export class BeatorajaPlaySkinPreviewScene implements PixiScene {
  readonly root = new Container();
  private readonly view: BeatorajaPlaySkinView;
  private readonly baseOps: ReadonlySet<number>;
  private readonly onExit?: () => void;
  private host?: PixiSceneHost;
  private tickerHandle?: (ticker: Ticker) => void;
  private startMs = 0;
  private disposed = false;

  constructor(options: BeatorajaPlaySkinPreviewOptions) {
    this.onExit = options.onExit;
    this.baseOps = buildBaseOpSet(options.skinConfig?.option);
    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      resolveTextContent: options.resolveTextContent,
    });
    this.root.addChild(this.view.container);
  }

  enter(host: PixiSceneHost): void {
    this.host = host;
    this.fitToStage();
    this.startMs = performance.now();

    this.tickerHandle = () => this.tick();
    host.app.ticker.add(this.tickerHandle);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
    }
  }

  exit(): void {
    if (this.tickerHandle && this.host) {
      this.host.app.ticker.remove(this.tickerHandle);
    }
    this.tickerHandle = undefined;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
    }
    this.host = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exit();
    this.view.dispose();
    // The texture cache outlives every preview scene by design — see `beatoraja-textures.ts`.
    if (!this.root.destroyed) {
      this.root.destroy({ children: false });
    }
  }

  private tick(): void {
    if (this.disposed) return;
    // Re-fit per tick — the Pixi app's `resizeTo: container` may grow / shrink after `enter()` (mount
    // race, window resize). Cheap when nothing changed.
    this.fitToStage();
    const elapsed = performance.now() - this.startMs;
    this.view.update({
      activeOps: this.baseOps,
      // Every timer is treated as fired at scene start. Once the engine wiring arrives, this becomes
      // `engine.timerStartTimes[id]` so per-key bomb / judge / etc. animations only run when their event fires.
      getTimerStart: () => 0,
      nowMs: elapsed,
    });
  }

  private lastFitWidth = 0;
  private lastFitHeight = 0;

  private fitToStage(): void {
    const host = this.host;
    if (!host) return;
    const { width, height } = host.app.screen;
    if (width === this.lastFitWidth && height === this.lastFitHeight) return;
    if (width <= 0 || height <= 0) return;
    this.lastFitWidth = width;
    this.lastFitHeight = height;
    const scaleX = width / this.view.width;
    const scaleY = height / this.view.height;
    const scale = Math.min(scaleX, scaleY);
    if (!Number.isFinite(scale) || scale <= 0) return;
    const container = this.view.container;
    container.scale.set(scale, scale);
    container.x = (width - this.view.width * scale) / 2;
    container.y = (height - this.view.height * scale) / 2;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onExit?.();
    }
  };
}
