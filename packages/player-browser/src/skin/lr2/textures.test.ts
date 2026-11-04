import { beforeEach, expect, test, vi } from 'vite-plus/test';
import type { LR2Skin } from '@be-music/skin-lr2';
import { resolveLR2AssetBytes } from '@be-music/skin-lr2';
import { attachBlobURLToTexture, loadTextureFromBytes, loadVideoTexture } from '../../media/textures.ts';
import { loadSkinAssetTexture } from './textures.ts';

vi.mock('@be-music/skin-lr2', () => ({ resolveLR2AssetBytes: vi.fn(), decodeDDSImageData: vi.fn() }));
vi.mock('../../media/textures.ts', () => ({
  attachBlobURLToTexture: vi.fn(),
  loadTextureFromBytes: vi.fn(),
  loadVideoTexture: vi.fn(),
  registerImageDecoder: vi.fn(),
}));
const skin = {} as LR2Skin;
const bytes = new Uint8Array([1, 2, 3]);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveLR2AssetBytes).mockReturnValue(bytes);
});

test.each(['background.MPG', 'clear.avi', 'back.webm'])('loops a bundled skin movie: %s', async (path) => {
  const texture = {} as never;
  const video = { loop: false, play: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(loadVideoTexture).mockResolvedValue({
    texture,
    video: video as unknown as HTMLVideoElement,
    objectURL: 'blob:skin',
  });
  expect(await loadSkinAssetTexture(skin, path)).toBe(texture);
  expect(loadVideoTexture).toHaveBeenCalledWith(path, bytes);
  expect(video.loop).toBe(true);
  expect(video.play).toHaveBeenCalledOnce();
  expect(attachBlobURLToTexture).toHaveBeenCalledWith(texture, 'blob:skin');
  expect(loadTextureFromBytes).not.toHaveBeenCalled();
});

test('keeps image loading and its authored transparent colour', async () => {
  await loadSkinAssetTexture({ ...skin, transparentColor: { r: 0, g: 255, b: 0 } } as LR2Skin, 'background.bmp');
  expect(loadTextureFromBytes).toHaveBeenCalledWith('background.bmp', bytes, { r: 0, g: 255, b: 0 });
  expect(loadVideoTexture).not.toHaveBeenCalled();
});

test('skips missing and undecodable movie assets', async () => {
  vi.mocked(resolveLR2AssetBytes).mockReturnValueOnce(undefined);
  expect(await loadSkinAssetTexture(skin, 'missing.mpg')).toBeUndefined();
  expect(loadVideoTexture).not.toHaveBeenCalled();
  vi.mocked(loadVideoTexture).mockResolvedValue(undefined);
  expect(await loadSkinAssetTexture(skin, 'bad.mpg')).toBeUndefined();
});
