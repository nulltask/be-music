// Pixi's event mixin (`eventMode`, `isInteractive`) is installed by its events entry; nothing else loads it in Node.
import 'pixi.js/events';
import { describe, expect, it } from 'vite-plus/test';
import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import { EventBoundary, Matrix, type Container, type Sprite, type Text, type Texture } from 'pixi.js';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongEntry,
} from '../../collection/types.ts';
import { makeChart, makeCourse, makeCourseFolder } from '../../session/select/test-support.ts';
import { createEmptyJson } from '@be-music/json';
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

describe('PixiBeatorajaSelectScene row clicks', () => {
  it('hits the row hit sprite, not the list layer, through the title text above it', () => {
    const scene = new PixiBeatorajaSelectScene({
      skin: makeSkin(),
      textures: fakeTextureCache(),
      songs: [],
      onSongPicked: () => undefined,
    });
    const internals = scene as unknown as SelectSceneInternals & { rowHitAreas: (Sprite | undefined)[] };
    const hit = internals.rowHitAreas.find((sprite): sprite is Sprite => sprite !== undefined)!;
    const label = internals.rowLabels.find((text): text is Text => text !== undefined)!;
    // No song lists no rows, so lay one row out by hand: the title text over the left of the row's hit sprite.
    hit.visible = true;
    hit.position.set(0, 0);
    hit.setSize(200, 40);
    label.visible = true;
    label.text = 'Title';
    label.position.set(10, 20);
    // Nothing renders here, so bring the world transforms the hit test reads up to date by hand.
    for (const node of [internals.listLayer, hit, label]) {
      node.worldTransform.copyFrom(node.getGlobalTransform(new Matrix(), false));
    }
    const boundary = new EventBoundary(internals.listLayer);
    expect(boundary.hitTest(15, 20)).toBe(hit);
    scene.dispose();
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

  it('snapshots the live cursor inside the course folder and restores it', () => {
    const courses = [course('first', true), course('second', true), course('third', true)];
    const { scene } = sceneInCourseFolder(courses, () => undefined);
    (scene as unknown as { moveCursor(delta: number): void }).moveCursor(2);
    const snapshot = scene.captureSnapshot();
    expect(snapshot.folderPath).toEqual(['Dan']);
    expect(snapshot.cursorStack).toEqual([0, 2]);
    scene.dispose();

    const restored = new PixiBeatorajaSelectScene({
      skin: makeSkin(),
      textures: fakeTextureCache(),
      songs: [],
      courseFolders: [{ label: 'Dan', songs: [], courses }],
      onSongPicked: () => undefined,
      restoreSnapshot: snapshot,
    });
    expect((restored as unknown as { currentIndex: number }).currentIndex).toBe(2);
    restored.dispose();
  });

  it('snapshots the live cursor inside a song folder and at the root', () => {
    const song = (id: string, directoryLabel: string): BrowserSongEntry =>
      ({ id, title: id, directoryLabel, fileLabel: `${id}.bms`, chart: createEmptyJson() }) as BrowserSongEntry;
    const songs = [song('a', 'one'), song('b', 'two'), song('c', 'two'), song('d', 'two')];
    const scene = new PixiBeatorajaSelectScene({
      skin: makeSkin(),
      textures: fakeTextureCache(),
      songs,
      onSongPicked: () => undefined,
    });
    const internals = scene as unknown as { moveCursor(delta: number): void; activateCurrentEntry(): void };
    internals.moveCursor(1);
    expect(scene.captureSnapshot().cursorStack).toEqual([1]);
    internals.activateCurrentEntry();
    internals.moveCursor(2);
    expect(scene.captureSnapshot()).toMatchObject({ folderPath: ['two'], cursorStack: [1, 2] });
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

describe('PixiBeatorajaSelectScene list', () => {
  type ListInternals = {
    entries: ReadonlyArray<BrowserBrowseEntry>;
    moveCursor(delta: number): void;
    activateCurrentEntry(): void;
    handleButtonAction(act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }): void;
  };

  /** The scene over `songs` and `courseFolders`, and what its tests reach of it. */
  function sceneOf(songs: BrowserSongEntry[], courseFolders: BrowserFolderNode[] = []) {
    const scene = new PixiBeatorajaSelectScene({
      skin: makeSkin(),
      textures: fakeTextureCache(),
      songs,
      courseFolders,
      onSongPicked: () => undefined,
    });
    const internals = scene as unknown as ListInternals;
    const shown = (): string[] =>
      internals.entries.map((entry) =>
        entry.kind === 'folder' ? entry.folder.label : entry.kind === 'song' ? entry.song.title : entry.course.id,
      );
    return { scene, internals, shown };
  }

  /** A grade course named `id`, of `keyMode` keys when given. */
  function courseOf(id: string, keyMode?: number): BrowserCourseEntry {
    const course = makeCourse(id);
    return keyMode === undefined ? course : { ...course, definition: { ...course.definition, keyMode } };
  }

  it('keeps every folder bar listed under the MODE filter', () => {
    const { scene, internals, shown } = sceneOf([
      makeChart('five', 'Five', { channels: ['11', '16'] }),
      makeChart('seven', 'Seven'),
    ]);
    // MODE steps ALL → 5 KEYS: the 7-key folder stays, empty.
    internals.handleButtonAction(11);
    expect(shown()).toEqual(['Five', 'Seven']);
    internals.moveCursor(1);
    internals.activateCurrentEntry();
    expect(shown()).toEqual([]);
    scene.dispose();
  });

  it("lists a course folder's courses of the MODE filter's key mode, and those that name none", () => {
    const { scene, internals, shown } = sceneOf(
      [makeChart('seven', 'Seven')],
      [makeCourseFolder('Dan', [courseOf('seven-dan', 7), courseOf('five-dan', 5), courseOf('any')])],
    );
    internals.handleButtonAction(11);
    internals.moveCursor(1);
    internals.activateCurrentEntry();
    expect(shown()).toEqual(['five-dan', 'any']);
    scene.dispose();
  });

  it("searches a chart's file label too, by the trimmed text, and a course folder's courses by name", () => {
    const { scene, internals, shown } = sceneOf(
      [
        { ...makeChart('lapis', 'Pack'), fileLabel: 'lapis [ANOTHER].bms' },
        { ...makeChart('hikari', 'Pack'), fileLabel: 'hikari.bms' },
      ],
      [makeCourseFolder('Dan', [courseOf('First Dan'), courseOf('Tenth Dan')])],
    );
    scene.setSearchQuery('  another ');
    expect(shown()).toEqual(['lapis']);
    // A search of spaces only searches nothing: the root lists its folders.
    scene.setSearchQuery('   ');
    expect(shown()).toEqual(['Pack', 'Dan']);
    internals.moveCursor(1);
    internals.activateCurrentEntry();
    scene.setSearchQuery('tenth');
    expect(shown()).toEqual(['Tenth Dan']);
    scene.dispose();
  });

  it('orders the root folders by label under a sort, the course folders among them', () => {
    const { scene, internals, shown } = sceneOf(
      [makeChart('z', 'Zeta'), makeChart('b', 'Beta')],
      [makeCourseFolder('Dan', [courseOf('First Dan')])],
    );
    expect(shown()).toEqual(['Beta', 'Zeta', 'Dan']);
    // SORT steps DEFAULT → TITLE; the cursor stays on its folder bar.
    internals.moveCursor(1);
    internals.handleButtonAction(12);
    expect(shown()).toEqual(['Beta', 'Dan', 'Zeta']);
    expect((scene.getFocusedEntry() as { folder?: BrowserFolderNode }).folder?.label).toBe('Zeta');
    // Back to DEFAULT (Shift steps back): the library's order again.
    internals.handleButtonAction(12, { shift: true, ctrl: false, alt: false });
    expect(shown()).toEqual(['Beta', 'Zeta', 'Dan']);
    scene.dispose();
  });

  it('orders titles case-insensitively, keeping the library order of titles that differ only in case', () => {
    const { scene, internals, shown } = sceneOf([
      { ...makeChart('upper', 'Pack'), title: 'Beta' },
      { ...makeChart('lower', 'Pack'), title: 'beta' },
      { ...makeChart('first', 'Pack'), title: 'alpha' },
    ]);
    internals.activateCurrentEntry();
    // SORT steps DEFAULT → TITLE.
    internals.handleButtonAction(12);
    expect(shown()).toEqual(['alpha', 'Beta', 'beta']);
    scene.dispose();
  });
});
