import { describe, expect, it } from 'vitest';
import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import type { Container, Text, Texture } from 'pixi.js';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import { PixiBeatorajaSelectScene } from './select.ts';

function fakeTextureCache(): BeatorajaTextureCache {
  const empty = new Map<number | string, Texture>();
  return {
    get: (id) => empty.get(id),
    values: () => empty.values(),
    pathOf: () => undefined,
  };
}

function makeSkin(): BeatorajaSkin {
  return {
    type: 5,
    w: 1280,
    h: 720,
    image: [],
    destination: [],
  };
}

type SelectSceneInternals = {
  listLayer: Container;
  rowLabels: (Text | undefined)[];
  searchPromptText?: Text;
  setSearchActive(active: boolean): void;
};

describe('PixiBeatorajaSelectScene disposal', () => {
  it('destroys row overlays and search prompt resources on dispose', () => {
    const scene = new PixiBeatorajaSelectScene({
      skin: makeSkin(),
      textures: fakeTextureCache(),
      songs: [],
      onSongPicked: () => undefined,
    });
    const internals = scene as unknown as SelectSceneInternals;

    internals.setSearchActive(true);
    const listLayer = internals.listLayer;
    const rowLabel = internals.rowLabels.find((label): label is Text => label !== undefined);
    const prompt = internals.searchPromptText;

    expect(listLayer.destroyed).toBe(false);
    expect(rowLabel?.destroyed).toBe(false);
    expect(prompt?.destroyed).toBe(false);

    scene.dispose();

    expect(listLayer.destroyed).toBe(true);
    expect(rowLabel?.destroyed).toBe(true);
    expect(prompt?.destroyed).toBe(true);
    expect(internals.rowLabels).toHaveLength(0);
    expect(internals.searchPromptText).toBeUndefined();
  });

  it('drops the old search prompt when hot-swapping skins', () => {
    const scene = new PixiBeatorajaSelectScene({
      skin: makeSkin(),
      textures: fakeTextureCache(),
      songs: [],
      onSongPicked: () => undefined,
    });
    const internals = scene as unknown as SelectSceneInternals;

    internals.setSearchActive(true);
    const oldPrompt = internals.searchPromptText;

    scene.replaceSkin({ skin: makeSkin(), textures: fakeTextureCache() });

    expect(oldPrompt?.destroyed).toBe(true);
    expect(internals.searchPromptText).toBeDefined();
    expect(internals.searchPromptText).not.toBe(oldPrompt);

    scene.dispose();
  });
});
