import type { Texture } from 'pixi.js';
import { decodeDdsImageData, resolveLr2AssetBytes, type Lr2Skin } from '@be-music/lr2-skin';
import { loadTextureFromBytes, registerImageDecoder } from '../../media/textures.ts';

// The generic image / video loaders live in `media/textures.ts`; re-export them so existing importers of this module
// (and the `@be-music/player-web/skin` barrel) keep resolving the same symbols.
export {
  attachBlobUrlToTexture,
  destroyTextureAndRevokeBlobUrl,
  loadTextureFromBytes,
  loadVideoTextureFromBytes,
  type LoadTextureOptions,
  type VideoTextureHandle,
  type VideoTranscodeOptions,
} from '../../media/textures.ts';

// Browsers don't decode DDS natively, and LR2 themes like LITONE4 ship every skin texture as `.dds`. Plug the in-tree
// decoder into the shared loader at module load so every `loadTextureFromBytes` call (skin chrome, fonts, BGA) keeps
// handling the format. Unsupported DDS variants (DXT-compressed, R5G6B5, etc.) return `undefined` from the decoder and
// fall through to the blob path, which then fails gracefully.
registerImageDecoder('.dds', decodeDdsImageData);

/**
 * Resolves an LR2 skin asset (image, font sheet, etc.) to a Pixi texture using the skin's bundled file map. Honors the
 * skin's `#TRANSCOLOR` chroma key.
 */
export async function loadSkinAssetTexture(skin: Lr2Skin, path: string): Promise<Texture | undefined> {
  const bytes = resolveLr2AssetBytes(skin, path);
  if (!bytes) {
    return undefined;
  }
  return loadTextureFromBytes(path, bytes, skin.transparentColor);
}
