import { describe, expect, it } from 'vite-plus/test';
import { disableTransientAttachments, type TransientAttachmentRenderer } from './webgpu-transient.ts';

function fakeRenderer() {
  const listeners: { contextChange(): void }[] = [];
  const renderer = {
    device: {
      extensions: { tileBased: true, transientAttachment: true } as {
        tileBased: boolean;
        transientAttachment: boolean;
      } | null,
    },
    runners: { contextChange: { add: (item: { contextChange(): void }) => listeners.push(item) } },
  } satisfies TransientAttachmentRenderer;
  // What Pixi does on a new device: probe the capabilities again, then emit `contextChange`.
  const changeDevice = (extensions: { tileBased: boolean; transientAttachment: boolean } | null) => {
    renderer.device.extensions = extensions;
    for (const listener of listeners) listener.contextChange();
  };
  return { renderer, changeDevice };
}

describe('disableTransientAttachments', () => {
  it('turns transient MSAA textures off on the current device', () => {
    const { renderer } = fakeRenderer();
    disableTransientAttachments(renderer);
    expect(renderer.device.extensions).toEqual({ tileBased: false, transientAttachment: false });
  });

  it('turns them off again on every device that replaces it', () => {
    const { renderer, changeDevice } = fakeRenderer();
    disableTransientAttachments(renderer);
    changeDevice({ tileBased: true, transientAttachment: true });
    expect(renderer.device.extensions).toEqual({ tileBased: false, transientAttachment: false });
  });

  it('ignores a device change before the capabilities are probed', () => {
    const { renderer, changeDevice } = fakeRenderer();
    disableTransientAttachments(renderer);
    expect(() => changeDevice(null)).not.toThrow();
  });
});
