import { describe, expect, it } from 'vite-plus/test';
import { chargeCloudGpuPrograms } from './charge-cloud-wgsl.ts';

describe('chargeCloudGpuPrograms', () => {
  const programs = Object.entries(chargeCloudGpuPrograms());

  it.each(programs)('%s binds its textures as unfilterable floats (32-bit state)', (_name, program) => {
    const textures = program.gpuLayout.flat().filter((entry) => entry.texture);
    for (const entry of textures) expect(entry.texture!.sampleType).toBe('unfilterable-float');
  });

  it.each(programs)('%s takes the player globals at group 0 and the mesh locals at group 1', (_name, program) => {
    expect(program.autoAssignGlobalUniforms).toBe(true);
    expect(program.autoAssignLocalUniforms).toBe(true);
  });

  it('names every quad attribute aPosition, so WebGPU binds the right buffer to each quad', () => {
    const { velocity, position, particles, orb, splat } = chargeCloudGpuPrograms();
    for (const program of [velocity, position, particles, orb]) {
      expect(Object.keys(program.attributeData)).toEqual(['aPosition']);
    }
    expect(Object.keys(splat.attributeData)).toEqual(['aSlot']);
  });
});
