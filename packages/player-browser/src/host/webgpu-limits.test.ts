import { describe, expect, it } from 'vite-plus/test';
import { createMaxLimitsGPU, withAdapterMaxLimits } from './webgpu-limits.ts';

const ADAPTER_LIMITS = {
  maxTextureDimension1D: 16384,
  maxTextureDimension2D: 16384,
  maxTextureDimension3D: 2048,
};

describe('withAdapterMaxLimits', () => {
  it("raises the texture dimensions to the adapter's maximum and leaves the buffer size alone", () => {
    expect(
      withAdapterMaxLimits(undefined, { ...ADAPTER_LIMITS, maxBufferSize: 2147483644 } as typeof ADAPTER_LIMITS),
    ).toEqual({
      requiredLimits: ADAPTER_LIMITS,
    });
  });

  it('keeps the rest of the descriptor and the limits it already asks for', () => {
    const descriptor = {
      requiredFeatures: ['texture-compression-bc'] as GPUFeatureName[],
      requiredLimits: { maxSamplersPerShaderStage: 16, maxTextureDimension2D: 8192 },
    };
    expect(withAdapterMaxLimits(descriptor, ADAPTER_LIMITS)).toEqual({
      requiredFeatures: ['texture-compression-bc'],
      requiredLimits: {
        maxSamplersPerShaderStage: 16,
        maxTextureDimension1D: 16384,
        maxTextureDimension2D: 8192,
        maxTextureDimension3D: 2048,
      },
    });
    expect(descriptor.requiredLimits).toEqual({ maxSamplersPerShaderStage: 16, maxTextureDimension2D: 8192 });
  });

  it('skips limits the adapter does not report as a positive number', () => {
    expect(
      withAdapterMaxLimits(undefined, {
        maxTextureDimension2D: 0,
        maxTextureDimension3D: Number.NaN,
        maxTextureDimension1D: 4096,
      }),
    ).toEqual({ requiredLimits: { maxTextureDimension1D: 4096 } });
  });
});

describe('createMaxLimitsGPU', () => {
  function fakeGPU(adapterAvailable = true) {
    const requested: (GPUDeviceDescriptor | undefined)[] = [];
    const gpu = {
      requestAdapter: async () =>
        adapterAvailable
          ? {
              limits: ADAPTER_LIMITS,
              requestDevice: async (descriptor?: GPUDeviceDescriptor) => {
                requested.push(descriptor);
                return {} as GPUDevice;
              },
            }
          : null,
      getPreferredCanvasFormat: () => 'bgra8unorm',
      wgslLanguageFeatures: new Set<string>(),
    } as unknown as GPU;
    return { gpu, requested };
  }

  it("requests every device of every adapter with the adapter's maximum limits", async () => {
    const { gpu, requested } = fakeGPU();
    const maxLimitsGPU = createMaxLimitsGPU(gpu);
    const adapter = await maxLimitsGPU.requestAdapter();
    await adapter?.requestDevice({ requiredLimits: { maxSamplersPerShaderStage: 16 } });
    await (await maxLimitsGPU.requestAdapter())?.requestDevice();
    expect(requested).toEqual([
      { requiredLimits: { maxSamplersPerShaderStage: 16, ...ADAPTER_LIMITS } },
      { requiredLimits: ADAPTER_LIMITS },
    ]);
  });

  it('passes a missing adapter and the canvas format through', async () => {
    const { gpu } = fakeGPU(false);
    const maxLimitsGPU = createMaxLimitsGPU(gpu);
    expect(await maxLimitsGPU.requestAdapter()).toBeNull();
    expect(maxLimitsGPU.getPreferredCanvasFormat()).toBe('bgra8unorm');
    expect(maxLimitsGPU.wgslLanguageFeatures).toBe(gpu.wgslLanguageFeatures);
  });
});
