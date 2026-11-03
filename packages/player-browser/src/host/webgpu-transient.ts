/**
 * Keeps Pixi's WebGPU renderer from making transient (memoryless) multisampled textures.
 *
 * On a tile-based GPU (Apple, Arm, Qualcomm, Imagination) Pixi creates every MSAA texture with
 * `GPUTextureUsage.TRANSIENT_ATTACHMENT` when the browser has it, and discards it after the resolve. Safari 27's WebGPU
 * fails the command buffer that renders into such a texture (`MTLCommandBufferErrorInvalidResource`) and kills its GPU
 * process for it, which loses every WebGPU device and WebGL context on the page: the built-in skins draw through a
 * multisampled render texture, so the stage stayed blank. Turning both capabilities off gives ordinary stored MSAA
 * textures, at the cost of their memory.
 */

/** What this needs of Pixi's `WebGPURenderer`. */
export interface TransientAttachmentRenderer {
  readonly device: { extensions: { tileBased: boolean; transientAttachment: boolean } | null };
  readonly runners: { readonly contextChange: { add(item: unknown): unknown } };
}

/**
 * Turns off `renderer`'s transient MSAA textures now and after every device change: Pixi probes the capabilities
 * again on each device, including the one that replaces a lost device, before it emits `contextChange`.
 */
export function disableTransientAttachments(renderer: TransientAttachmentRenderer): void {
  const disable = () => {
    const extensions = renderer.device.extensions;
    if (extensions === null) return;
    extensions.tileBased = false;
    extensions.transientAttachment = false;
  };
  disable();
  renderer.runners.contextChange.add({ contextChange: disable });
}
