import { describe, expect, it } from 'vite-plus/test';
import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import type { Container, Text, Texture } from 'pixi.js';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type { BrowserCourseEntry } from '../../collection/types.ts';
import { lnModeDirectiveToIndex, PixiBeatorajaSelectScene } from './select.ts';

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

describe('lnModeDirectiveToIndex', () => {
  it('maps the 1-based `#LNMODE` values onto the 0-based LNMODE button index', () => {
    expect(lnModeDirectiveToIndex(1)).toBe(0);
    expect(lnModeDirectiveToIndex(2)).toBe(1);
    expect(lnModeDirectiveToIndex(3)).toBe(2);
  });

  it('reads a missing or out-of-range `#LNMODE` as LN', () => {
    expect(lnModeDirectiveToIndex(undefined)).toBe(0);
    expect(lnModeDirectiveToIndex(0)).toBe(0);
    expect(lnModeDirectiveToIndex(4)).toBe(0);
  });
});

describe('PixiBeatorajaSelectScene course bars', () => {
  const course = (id: string, playable: boolean): BrowserCourseEntry =>
    ({
      id,
      definition: { name: id, kind: 'grade', stages: [], constraints: [], trophies: [] },
      stages: [{ title: 'a' }],
      playable,
    }) as unknown as BrowserCourseEntry;

  type CourseSceneInternals = { activateCurrentEntry(): void; handleButtonAction(act: number): void };

  /** A scene with one course folder, opened, and the decide / cancel cues it plays. */
  function sceneInCourseFolder(
    courses: BrowserCourseEntry[],
    onCoursePicked: (course: BrowserCourseEntry, options?: { autoPlay?: boolean }) => void,
  ) {
    const cues: string[] = [];
    const scene = new PixiBeatorajaSelectScene({
      skin: makeSkin(),
      textures: fakeTextureCache(),
      songs: [],
      courseFolders: [{ label: 'Dan', songs: [], courses }],
      onSongPicked: () => undefined,
      onCoursePicked,
      systemSoundPaths: { decide: 'decide', cancel: 'cancel', folderOpen: 'open' },
      skinAudio: { play: (path: string) => void cues.push(path) } as unknown as BeatorajaSkinAudio,
    });
    const internals = scene as unknown as CourseSceneInternals;
    internals.activateCurrentEntry();
    cues.length = 0;
    return { scene, internals, cues };
  }

  it('hands a course with a missing stage to the host with the cancel cue, so the host can say why', () => {
    const picked: BrowserCourseEntry[] = [];
    const missing = course('missing', false);
    const { scene, internals, cues } = sceneInCourseFolder([missing], (entry) => picked.push(entry));
    internals.activateCurrentEntry();
    expect(picked).toEqual([missing]);
    expect(cues).toEqual(['cancel']);
    scene.dispose();
  });

  it('starts the focused course from PLAY (act 15) and AUTO PLAY (act 16)', () => {
    const picked: Array<[string, { autoPlay?: boolean } | undefined]> = [];
    const dan = course('dan', true);
    const { scene, internals, cues } = sceneInCourseFolder([dan], (entry, options) => picked.push([entry.id, options]));
    internals.handleButtonAction(15);
    internals.handleButtonAction(16);
    expect(picked).toEqual([
      ['dan', undefined],
      ['dan', { autoPlay: true }],
    ]);
    expect(cues).toEqual(['decide', 'decide']);
    scene.dispose();
  });
});
