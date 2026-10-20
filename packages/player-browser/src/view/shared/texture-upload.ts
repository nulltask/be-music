// Side-effect import: registers Pixi's `PrepareSystem` on the renderer so {@link uploadTextures} can drive eager GPU
// uploads. Pixi v8 deliberately ships the prepare module out of the default bundle (it's a large optional system that
// not every app needs); the import has to land before any `Application.init` runs that expects `renderer.prepare` to
// exist.
import 'pixi.js/prepare';
import { VideoSource, type Renderer, type Texture } from 'pixi.js';
import { logger } from '../../logger.ts';

const log = logger('gameplay');

/**
 * Hands `textures` to Pixi's `PrepareSystem` so the renderer's GPU upload happens NOW, before the first frame that
 * would otherwise touch them. Without this, Pixi defers the upload to the moment a sprite first samples each texture —
 * which means the chart's opening frames pay the cumulative `texSubImage2D` cost of the entire skin sheet (and,
 * mid-chart, the first BGA cue stalls on its image upload). Eager-uploading while a play loads spreads the work across
 * the decide screen's window, where the play isn't visible yet.
 *
 * The PrepareSystem is conditionally optional — the static `import 'pixi.js/prepare'` at the top of this module
 * registers it when bundled, but its presence is still detected defensively so a future tree-shaking config that
 * eliminates the side-effect import doesn't break loading at runtime. When absent the upload is skipped; first-frame
 * stutter returns to the pre-PrepareSystem baseline but nothing else breaks.
 *
 * Errors thrown by the upload (e.g. a corrupt texture, a transient WebGL context loss) are logged and the loop stops —
 * there's no point queuing more uploads on a renderer that just rejected one. The textures not yet uploaded fall
 * through to lazy upload on first paint, which is the original behavior. `isCancelled` stops the loop between textures
 * (the play was disposed).
 */
export async function uploadTextures(
  renderer: Renderer | undefined,
  textures: Iterable<Texture | undefined>,
  isCancelled: () => boolean,
): Promise<void> {
  if (!renderer) return;
  type PrepareLike = { upload: (resource: Texture) => Promise<unknown> };
  const prepare = (renderer as { prepare?: PrepareLike }).prepare;
  if (!prepare || typeof prepare.upload !== 'function') return;
  for (const texture of textures) {
    if (isCancelled()) return;
    if (!texture) continue;
    // BGA video textures are skipped: the underlying `<video>` element hasn't decoded any frames yet at load time (the
    // chart hasn't started, the cue hasn't fired), so its `videoFrame` / `videoSource` is empty. WebGPU's
    // `copyExternalImageToTexture` rejects an unbacked `<video>` with "Failed to import texture from video element
    // that doesn't have back resource", which Pixi propagates as an uncaught `OperationError` that recurs every frame
    // inside the renderer's PrepareSystem queue. Skipping the eager upload lets each video texture take Pixi's lazy
    // first-frame path (`Texture.source.update()` once a frame is decoded), which is bounded by the video's natural
    // decode latency rather than a runaway rAF loop.
    if (texture.source instanceof VideoSource) continue;
    try {
      await prepare.upload(texture);
    } catch (error) {
      log.warn('prepare.upload failed; falling back to lazy upload for the rest', error);
      return;
    }
  }
}
