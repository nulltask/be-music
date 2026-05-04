import { Texture } from 'pixi.js';
import { type Lr2Skin, type Lr2SpecialGraphic, LR2_SPECIAL_GRAPHIC, isLr2SpecialGraphic } from '@be-music/lr2-skin';
import { loadSkinAssetTexture, loadTextureFromBytes } from './lr2-textures.ts';
import { loadAssetBytes, resolveChartImageAsset, resolveSongSource } from './library.ts';
import type { BrowserSongCollection, BrowserSongEntry } from './types.ts';

type TextureLoadValidity = () => boolean;

export class Lr2SkinTextureStore {
  private readonly textures = new Map<string, Texture>();
  private loadSerial = 0;
  private disposed = false;

  public get(path: string): Texture | undefined {
    return this.textures.get(path);
  }

  public asReadonlyMap(): ReadonlyMap<string, Texture> {
    return this.textures;
  }

  public clear(): void {
    this.loadSerial += 1;
    destroyTextureMap(this.textures);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clear();
  }

  public async preload(
    skin: Lr2Skin,
    paths: ReadonlySet<string>,
    isStillCurrent: TextureLoadValidity,
  ): Promise<boolean> {
    const serial = ++this.loadSerial;
    await Promise.all(
      [...paths].map(async (path) => {
        const texture = await loadSkinAssetTexture(skin, path);
        if (!texture) {
          return;
        }
        if (this.disposed || serial !== this.loadSerial || !isStillCurrent()) {
          texture.destroy(true);
          return;
        }
        this.textures.set(path, texture);
      }),
    );
    return !this.disposed && serial === this.loadSerial && isStillCurrent();
  }
}

export class Lr2ChartGraphicTextureStore {
  private readonly textures = new Map<string, Texture>();
  private readonly pending = new Set<string>();
  private disposed = false;

  public resolve(
    collection: BrowserSongCollection,
    song: BrowserSongEntry,
    path: Lr2SpecialGraphic,
    onLoaded: () => void,
  ): Texture | undefined {
    const solidTexture = resolveSolidSpecialGraphicTexture(path);
    if (solidTexture) {
      return solidTexture;
    }
    const cacheKey = chartGraphicCacheKey(song, path);
    const cached = this.textures.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (!this.pending.has(cacheKey)) {
      this.pending.add(cacheKey);
      void this.load(collection, song, path, cacheKey, onLoaded);
    }
    return undefined;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    destroyTextureMap(this.textures);
    this.pending.clear();
  }

  private async load(
    collection: BrowserSongCollection,
    song: BrowserSongEntry,
    path: Lr2SpecialGraphic,
    cacheKey: string,
    onLoaded: () => void,
  ): Promise<void> {
    try {
      const assetPath = resolveSpecialGraphicAssetPath(song, path);
      if (!assetPath) {
        return;
      }
      const source = resolveSongSource(collection, song);
      if (!source) {
        return;
      }
      // Song-bundle assets are lazy `File` references — read the
      // banner / stagefile / backbmp bytes on demand the moment
      // the user focuses this song.
      const bytes = await loadAssetBytes(resolveChartImageAsset(source, song.chartPath, assetPath));
      if (!bytes) {
        return;
      }
      if (this.disposed) {
        return;
      }
      const texture = await loadTextureFromBytes(assetPath, bytes);
      if (!texture) {
        return;
      }
      if (this.disposed) {
        texture.destroy(true);
        return;
      }
      this.textures.set(cacheKey, texture);
      onLoaded();
    } finally {
      this.pending.delete(cacheKey);
    }
  }
}

export function collectSelectSkinTexturePaths(skin: Lr2Skin): Set<string> {
  const paths = new Set<string>();
  addImageTexturePaths(paths, skin);
  for (const number of skin.numbers) {
    addSkinTexturePath(paths, number.source.imagePath);
  }
  for (const slider of skin.sliders) {
    addSkinTexturePath(paths, slider.source.imagePath);
  }
  for (const body of skin.barLayout.bodies) {
    addSkinTexturePath(paths, body.source.imagePath);
  }
  for (const level of skin.barLayout.levels) {
    addSkinTexturePath(paths, level.source.imagePath);
  }
  for (const lamp of skin.barLayout.lamps) {
    addSkinTexturePath(paths, lamp.source.imagePath);
  }
  for (const rank of skin.barLayout.ranks) {
    addSkinTexturePath(paths, rank.source.imagePath);
  }
  for (const button of skin.buttons) {
    addSkinTexturePath(paths, button.source.imagePath);
  }
  for (const onMouse of skin.onMouseElements) {
    addSkinTexturePath(paths, onMouse.source.imagePath);
  }
  for (const cursor of skin.mouseCursors) {
    addSkinTexturePath(paths, cursor.source.imagePath);
  }
  if (skin.barLayout.flash) {
    addSkinTexturePath(paths, skin.barLayout.flash.source.imagePath);
  }
  return paths;
}

export function collectResultSkinTexturePaths(skin: Lr2Skin): Set<string> {
  return collectBaseSkinTexturePaths(skin);
}

export function collectDecideSkinTexturePaths(skin: Lr2Skin): Set<string> {
  const paths = new Set<string>();
  addImageTexturePaths(paths, skin);
  for (const number of skin.numbers) {
    addSkinTexturePath(paths, number.source.imagePath);
  }
  return paths;
}

export function resolveSpecialGraphicAssetPath(song: BrowserSongEntry, path: Lr2SpecialGraphic): string | undefined {
  const meta = song.chart.metadata;
  return path === LR2_SPECIAL_GRAPHIC.BACKBMP
    ? meta.backBmp
    : path === LR2_SPECIAL_GRAPHIC.BANNER
      ? meta.banner
      : path === LR2_SPECIAL_GRAPHIC.STAGEFILE
        ? meta.stageFile
        : undefined;
}

function collectBaseSkinTexturePaths(skin: Lr2Skin): Set<string> {
  const paths = new Set<string>();
  addImageTexturePaths(paths, skin);
  for (const number of skin.numbers) {
    addSkinTexturePath(paths, number.source.imagePath);
  }
  for (const bargraph of skin.bargraphs) {
    addSkinTexturePath(paths, bargraph.source.imagePath);
  }
  for (const slider of skin.sliders) {
    addSkinTexturePath(paths, slider.source.imagePath);
  }
  return paths;
}

function addImageTexturePaths(paths: Set<string>, skin: Lr2Skin): void {
  for (const image of skin.images) {
    addSkinTexturePath(paths, image.source.imagePath);
  }
}

function addSkinTexturePath(paths: Set<string>, path: string): void {
  if (!isLr2SpecialGraphic(path)) {
    paths.add(path);
  }
}

export function resolveSolidSpecialGraphicTexture(path: Lr2SpecialGraphic): Texture | undefined {
  return path === LR2_SPECIAL_GRAPHIC.BLACK || path === LR2_SPECIAL_GRAPHIC.WHITE ? Texture.WHITE : undefined;
}

function chartGraphicCacheKey(song: BrowserSongEntry, path: Lr2SpecialGraphic): string {
  return `${song.id}:${path}`;
}

function destroyTextureMap(textures: Map<string, Texture>): void {
  for (const texture of textures.values()) {
    texture.destroy(true);
  }
  textures.clear();
}
