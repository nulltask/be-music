import { Texture } from 'pixi.js';
import { type LR2Skin, type LR2SpecialGraphic, LR2_SPECIAL_GRAPHIC, isLR2SpecialGraphic } from '@be-music/lr2-skin';
import { destroyTextureAndRevokeBlobURL, loadSkinAssetTexture, loadTextureFromBytes } from './textures.ts';
import { loadAssetBytes, resolveChartImageAsset, resolveChartSource } from '../../collection/collection.ts';
import type { LibraryChart } from '@be-music/scene-model';
import type { BrowserAssetSource, BrowserChartCollection } from '../../collection/types.ts';

type TextureLoadValidity = () => boolean;
type SkinTexturePathCollector = (paths: Set<string>, skin: LR2Skin) => void;
type SkinTextureSourceElement = { source: { imagePath: string } };

export class LR2SkinTextureStore {
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
    skin: LR2Skin,
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
          destroyTextureAndRevokeBlobURL(texture, true);
          return;
        }
        this.textures.set(path, texture);
      }),
    );
    return !this.disposed && serial === this.loadSerial && isStillCurrent();
  }
}

export class LR2ChartGraphicTextureStore {
  private readonly textures = new Map<string, Texture>();
  private readonly pending = new Set<string>();
  private disposed = false;

  public resolve(
    collection: BrowserChartCollection,
    chartEntry: LibraryChart,
    path: LR2SpecialGraphic,
    onLoaded: () => void,
  ): Texture | undefined {
    return this.resolveWith(() => resolveChartSource(collection, chartEntry), chartEntry, path, onLoaded);
  }

  /**
   * As {@link resolve}, for a chart whose files are `source`: the texture of `path` for `song` once loaded, the solid
   * one for `*BLACK` / `*WHITE`. Without a source nothing loads.
   */
  public resolveFromSource(
    source: BrowserAssetSource | undefined,
    chartEntry: LibraryChart,
    path: LR2SpecialGraphic,
    onLoaded: () => void,
  ): Texture | undefined {
    return this.resolveWith(() => source, chartEntry, path, onLoaded);
  }

  private resolveWith(
    resolveSource: () => BrowserAssetSource | undefined,
    chartEntry: LibraryChart,
    path: LR2SpecialGraphic,
    onLoaded: () => void,
  ): Texture | undefined {
    const solidTexture = resolveSolidSpecialGraphicTexture(path);
    if (solidTexture) {
      return solidTexture;
    }
    const cacheKey = chartGraphicCacheKey(chartEntry, path);
    const cached = this.textures.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (!this.pending.has(cacheKey)) {
      this.pending.add(cacheKey);
      void this.load(resolveSource, chartEntry, path, cacheKey, onLoaded);
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
    resolveSource: () => BrowserAssetSource | undefined,
    chartEntry: LibraryChart,
    path: LR2SpecialGraphic,
    cacheKey: string,
    onLoaded: () => void,
  ): Promise<void> {
    try {
      const assetPath = resolveSpecialGraphicAssetPath(chartEntry, path);
      if (!assetPath) {
        return;
      }
      const source = resolveSource();
      if (!source) {
        return;
      }
      // Song-bundle assets are lazy `File` references — read the banner / stagefile / backbmp bytes on demand the
      // moment the user focuses this song.
      const bytes = await loadAssetBytes(resolveChartImageAsset(source, chartEntry.chartPath, assetPath));
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
        destroyTextureAndRevokeBlobURL(texture, true);
        return;
      }
      this.textures.set(cacheKey, texture);
      onLoaded();
    } finally {
      this.pending.delete(cacheKey);
    }
  }
}

export function collectSelectSkinTexturePaths(skin: LR2Skin): Set<string> {
  return collectSkinTexturePaths(skin, [
    addImageTexturePaths,
    addNumberTexturePaths,
    addSliderTexturePaths,
    addBarBodyTexturePaths,
    addBarLevelTexturePaths,
    addBarLampTexturePaths,
    addBarRankTexturePaths,
    addButtonTexturePaths,
    addOnMouseTexturePaths,
    addMouseCursorTexturePaths,
    addBarFlashTexturePath,
  ]);
}

export function collectResultSkinTexturePaths(skin: LR2Skin): Set<string> {
  return collectBaseSkinTexturePaths(skin);
}

export function collectDecideSkinTexturePaths(skin: LR2Skin): Set<string> {
  return collectSkinTexturePaths(skin, [addImageTexturePaths, addNumberTexturePaths]);
}

function resolveSpecialGraphicAssetPath(chartEntry: LibraryChart, path: LR2SpecialGraphic): string | undefined {
  const meta = chartEntry.chart.metadata;
  return path === LR2_SPECIAL_GRAPHIC.BACKBMP
    ? meta.backBMP
    : path === LR2_SPECIAL_GRAPHIC.BANNER
      ? meta.banner
      : path === LR2_SPECIAL_GRAPHIC.STAGEFILE
        ? meta.stageFile
        : undefined;
}

function collectBaseSkinTexturePaths(skin: LR2Skin): Set<string> {
  return collectSkinTexturePaths(skin, [
    addImageTexturePaths,
    addNumberTexturePaths,
    addBargraphTexturePaths,
    addSliderTexturePaths,
  ]);
}

function collectSkinTexturePaths(skin: LR2Skin, collectors: readonly SkinTexturePathCollector[]): Set<string> {
  const paths = new Set<string>();
  for (const collector of collectors) {
    collector(paths, skin);
  }
  return paths;
}

function addImageTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.images);
}

function addNumberTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.numbers);
}

function addBargraphTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.bargraphs);
}

function addSliderTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.sliders);
}

function addBarBodyTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.barLayout.bodies);
}

function addBarLevelTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.barLayout.levels);
}

function addBarLampTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.barLayout.lamps);
}

function addBarRankTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.barLayout.ranks);
}

function addButtonTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.buttons);
}

function addOnMouseTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.onMouseElements);
}

function addMouseCursorTexturePaths(paths: Set<string>, skin: LR2Skin): void {
  addSourceTexturePaths(paths, skin.mouseCursors);
}

function addBarFlashTexturePath(paths: Set<string>, skin: LR2Skin): void {
  if (skin.barLayout.flash) {
    addSkinTexturePath(paths, skin.barLayout.flash.source.imagePath);
  }
}

function addSourceTexturePaths(paths: Set<string>, elements: readonly SkinTextureSourceElement[]): void {
  for (const element of elements) {
    addSkinTexturePath(paths, element.source.imagePath);
  }
}

function addSkinTexturePath(paths: Set<string>, path: string): void {
  if (!isLR2SpecialGraphic(path)) {
    paths.add(path);
  }
}

export function resolveSolidSpecialGraphicTexture(path: LR2SpecialGraphic): Texture | undefined {
  return path === LR2_SPECIAL_GRAPHIC.BLACK || path === LR2_SPECIAL_GRAPHIC.WHITE ? Texture.WHITE : undefined;
}

function chartGraphicCacheKey(chartEntry: LibraryChart, path: LR2SpecialGraphic): string {
  return `${chartEntry.id}:${path}`;
}

function destroyTextureMap(textures: Map<string, Texture>): void {
  for (const texture of textures.values()) {
    destroyTextureAndRevokeBlobURL(texture, true);
  }
  textures.clear();
}
