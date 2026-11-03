/**
 * WebGPU device limits for the stage renderer.
 *
 * `requestDevice()` grants WebGPU's default limits (8192-px textures) unless larger ones are asked for, which is too
 * small for some authored beatoraja skins (GdbG_Skin's `fonts/bitmap/Title_*.png` is 8000×12000). Only the texture
 * dimensions are raised: the stage's buffers stay far below the default `maxBufferSize` (256 MiB), so the adapter's
 * maximum there (2 GiB in WebKit) is left unrequested. Pixi creates its device with only a couple of sampler limits, and handing it a device of our own (`app.init({ gpu })`) turns off its
 * device-loss recovery: a lost device (Safari drops one under memory pressure, on GPU process restarts and the like)
 * then keeps the stage blank for good. So instead Pixi gets a `navigator.gpu` whose adapters ask for the adapter's
 * maximum texture dimensions on every device they create, the first and any after a loss.
 */

/** The limits raised to the adapter's maximum on every device the stage renderer requests. */
export const MAX_LIMIT_NAMES = ['maxTextureDimension1D', 'maxTextureDimension2D', 'maxTextureDimension3D'] as const;

/**
 * `descriptor` with {@link MAX_LIMIT_NAMES} raised to what `adapterLimits` advertises. Limits the descriptor already
 * asks for and limits the adapter does not report as a positive finite number are left as they are.
 */
export function withAdapterMaxLimits(
  descriptor: GPUDeviceDescriptor | undefined,
  adapterLimits: Partial<Record<(typeof MAX_LIMIT_NAMES)[number], number>>,
): GPUDeviceDescriptor {
  const requiredLimits: Record<string, number | undefined> = { ...descriptor?.requiredLimits };
  for (const name of MAX_LIMIT_NAMES) {
    const max = adapterLimits[name];
    if (requiredLimits[name] === undefined && max !== undefined && Number.isFinite(max) && max > 0) {
      requiredLimits[name] = max;
    }
  }
  return { ...descriptor, requiredLimits };
}

/**
 * A stand-in for `navigator.gpu` whose adapters request devices with {@link withAdapterMaxLimits}. Only what Pixi uses
 * is forwarded: `requestAdapter` and `getPreferredCanvasFormat`.
 */
export function createMaxLimitsGPU(gpu: GPU): GPU {
  return {
    requestAdapter: async (options?: GPURequestAdapterOptions) => {
      const adapter = await gpu.requestAdapter(options);
      if (adapter === null) return null;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = (descriptor?: GPUDeviceDescriptor) =>
        requestDevice(withAdapterMaxLimits(descriptor, adapter.limits));
      return adapter;
    },
    getPreferredCanvasFormat: () => gpu.getPreferredCanvasFormat(),
    get wgslLanguageFeatures() {
      return gpu.wgslLanguageFeatures;
    },
  } as GPU;
}
