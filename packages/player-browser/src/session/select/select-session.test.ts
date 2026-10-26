import type { BestRecord } from '@be-music/player-engine/records';
import {
  DEFAULT_PLAY_OPTIONS,
  type LibraryChart,
  type SystemSound,
  type SystemSoundSet,
  type SystemSoundSlot,
} from '@be-music/player-scene-model';
import { describe, expect, it, vi } from 'vite-plus/test';
import { SILENT_AUDIO } from '../../runtime/audio-analysis.ts';
import type { SelectFrame, SelectIntent } from '../../view/types.ts';
import type { SessionKeyEvent } from '../session-scene.ts';
import { SELECT_POLICIES } from './select-policy.ts';
import { SelectSession, type SelectSessionEvents, type SelectSessionOptions } from './select-session.ts';
import { makeChart, makeCollection, makeCourse, makeCourseFolder } from './test-support.ts';

const SLOTS: readonly SystemSoundSlot[] = [
  'selectBGM',
  'decideBGM',
  'cursor',
  'decide',
  'cancel',
  'folderOpen',
  'folderClose',
  'optionOpen',
  'optionClose',
  'optionChange',
];

/** A sound set with a sound of its own in every slot the select screen plays. */
const SOUNDS: SystemSoundSet = Object.fromEntries(
  SLOTS.map((slot, index) => [slot, { bytes: new Uint8Array([index]) }]),
) as SystemSoundSet;

/** The slot a sound of {@link SOUNDS} fills. */
function slotOf(sound: SystemSound | string | undefined): string {
  if (typeof sound === 'string') return sound;
  return SLOTS.find((slot) => SOUNDS[slot] === sound) ?? 'unknown';
}

/** An audio service that records what the session asks of it. */
function createAudio() {
  return {
    playBGM: vi.fn(async (..._args: unknown[]) => true),
    stopBGM: vi.fn(),
    playCue: vi.fn(async (..._args: unknown[]) => true),
    playJingle: vi.fn(async (..._args: unknown[]) => true),
    stopOwned: vi.fn(),
    resume: vi.fn(),
    preview: { focus: vi.fn(), stop: vi.fn(), playing: false },
    analyzer: { sample: () => SILENT_AUDIO },
  };
}

/** Two chart folders (`other`, `pack`) and a course folder, listed in that order at the root. */
function makeLibrary(files: Readonly<Record<string, Uint8Array>> = {}) {
  return makeCollection(
    [
      makeChart('a', 'pack', { playLevel: 3 }),
      makeChart('b', 'pack', { playLevel: 1 }),
      makeChart('c', 'pack', { playLevel: 2 }),
      makeChart('x', 'other'),
    ],
    [makeCourseFolder('courses', [makeCourse('one'), makeCourse('two'), makeCourse('missing', { playable: false })])],
    files,
  );
}

type Started = { entry: string; autoPlay: boolean };

/** A session over `makeLibrary()` (unless given another), entered at 0 on a clock the test moves. */
function createSession(
  options: Partial<Omit<SelectSessionOptions, 'on' | 'audio'>> & { on?: Partial<SelectSessionEvents> } = {},
) {
  const audio = createAudio();
  const started: Started[] = [];
  let clock = 0;
  const { on, ...rest } = options;
  const session = new SelectSession({
    library: makeLibrary(),
    sounds: SOUNDS,
    now: () => clock,
    ...rest,
    audio,
    on: {
      start: (entry, { autoPlay }) => {
        started.push({
          entry: entry.kind === 'chart' ? entry.chart.title : entry.course.definition.name,
          autoPlay,
        });
      },
      ...on,
    },
  });
  session.enter(0);
  let last: SelectFrame = session.frame(0);
  const advance = (ms: number): SelectFrame => {
    clock += ms;
    last = session.frame(clock);
    return last;
  };
  const key = (code: string, value = code): boolean => session.handleKey(keyEvent(code, value, clock));
  const intent = (value: SelectIntent): void => session.dispatch(value);
  const cues = (): string[] => audio.playCue.mock.calls.map(([sound]) => slotOf(sound as SystemSound));
  return { session, audio, started, advance, key, intent, cues, frame: () => last };
}

function keyEvent(code: string, key: string, timeStamp: number): SessionKeyEvent {
  return {
    type: 'down',
    code,
    key,
    repeat: false,
    timeStamp,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  };
}

/** The bar under the cursor of `frame`: a chart's title, a folder's label or a course's name. */
function focusedTitle(frame: SelectFrame): string | undefined {
  const entry = frame.entries[frame.cursor];
  if (entry === undefined) return undefined;
  if (entry.kind === 'chart') return entry.chart.title;
  return entry.kind === 'folder' ? entry.folder.label : entry.course.definition.name;
}

function titles(frame: SelectFrame): string[] {
  return frame.entries.map((entry) =>
    entry.kind === 'chart' ? entry.chart.title : entry.kind === 'folder' ? entry.folder.label : entry.course.id,
  );
}

describe('SelectSession browsing', () => {
  it('opens a library of one chart folder, and a saved position otherwise', () => {
    const one = createSession({ library: makeCollection([makeChart('a', 'pack'), makeChart('b', 'pack')]) });
    expect(one.frame().browse.path.map((folder) => folder.label)).toEqual(['pack']);
    const saved = createSession({ browse: { folderPath: ['courses'], cursors: [2, 1] } });
    expect(focusedTitle(saved.frame())).toBe('two');
  });

  it('moves, opens and backs out with the keys, sliding the list and playing the cues', () => {
    const { key, advance, cues } = createSession();
    expect(key('ArrowDown')).toBe(true);
    let frame = advance(10);
    expect(focusedTitle(frame)).toBe('pack');
    expect(frame.events).toEqual([{ kind: 'browse', event: { kind: 'cursor', from: 0, to: 1, delta: 1 }, atMs: 0 }]);
    key('Enter');
    frame = advance(10);
    expect(frame.browse.path.map((folder) => folder.label)).toEqual(['pack']);
    expect(frame.events.map((event) => event.kind === 'browse' && event.event.kind)).toEqual(['folder-opened']);
    key('Escape');
    frame = advance(10);
    expect(focusedTitle(frame)).toBe('pack');
    // The cursor cue plays with every slide of the list, a folder opened or closed included.
    expect(cues()).toEqual(['cursor', 'cursor', 'folderOpen', 'cursor', 'folderClose']);
    // At the root there is nothing to back out of: the key stays the page's, and nothing plays.
    expect(key('Escape')).toBe(false);
    expect(advance(10).events).toEqual([]);
    expect(cues()).toHaveLength(5);
  });

  it('slides a list of one bar on a step, with the cursor staying on it', () => {
    const { key, intent, advance, cues } = createSession({ library: makeCollection([makeChart('a', 'pack')]) });
    key('ArrowUp');
    intent({ type: 'browse', command: { type: 'move', delta: 1 } });
    const frame = advance(10);
    expect(frame.events.map((event) => event.kind === 'browse' && event.event)).toEqual([
      { kind: 'cursor', from: 0, to: 0, delta: -1 },
      { kind: 'cursor', from: 0, to: 0, delta: 1 },
    ]);
    expect(cues()).toEqual(['cursor', 'cursor']);
  });

  it('jumps to a clicked bar and takes it, as a click on a bar does', () => {
    const { intent, advance } = createSession({ browse: { folderPath: ['pack'], cursors: [1, 0] } });
    intent({ type: 'browse', command: { type: 'jump', index: 2 } });
    expect(focusedTitle(advance(10))).toBe('c');
    const { intent: intentAtRoot, advance: advanceAtRoot } = createSession();
    intentAtRoot({ type: 'browse', command: { type: 'jump', index: 1 } });
    intentAtRoot({ type: 'activate' });
    expect(advanceAtRoot(10).browse.path.map((folder) => folder.label)).toEqual(['pack']);
  });

  it('leaves the screen at the root, with the cancel cue, under a policy that leaves', () => {
    const exit = vi.fn();
    const { key, cues } = createSession({ policy: SELECT_POLICIES.beatoraja, on: { exit } });
    key('Escape');
    expect(exit).toHaveBeenCalledTimes(1);
    expect(cues()).toEqual(['cancel']);
  });
});

describe('SelectSession list options', () => {
  it('keeps the cursor on its bar when the player or the host changes the sort or a filter', () => {
    const playOptions = vi.fn();
    const { session, intent, advance, cues } = createSession({
      browse: { folderPath: ['pack'], cursors: [1, 2] },
      on: { playOptions },
    });
    intent({ type: 'play-option', key: 'sort', step: 1 });
    let frame = advance(10);
    expect(frame.playOptions.sort).toBe('LEVEL');
    expect(titles(frame)).toEqual(['b', 'c', 'a']);
    expect(focusedTitle(frame)).toBe('c');
    expect(playOptions).toHaveBeenCalledWith(expect.objectContaining({ sort: 'LEVEL' }));
    expect(cues()).toEqual(['optionChange']);
    session.setPlayOptions({ sort: 'TITLE', keysFilter: 'KEYS_7' });
    frame = advance(10);
    expect(focusedTitle(frame)).toBe('c');
    // The host's change is not reported back, and plays no cue.
    expect(playOptions).toHaveBeenCalledTimes(1);
    expect(cues()).toEqual(['optionChange']);
  });

  it('lists a 24-key chart under no key filter of LR2’s', () => {
    const { session, advance } = createSession({
      library: makeCollection([
        makeChart('seven', 'pack'),
        makeChart('keyboard', 'pack', { modeHint: 'keyboard-24k' }),
      ]),
    });
    session.setPlayOptions({ keysFilter: 'KEYS_7' });
    expect(titles(advance(10))).toEqual(['seven']);
  });

  it('ignores a skin’s value outside an option’s choices', () => {
    const { intent, advance, cues } = createSession();
    intent({ type: 'set-play-option', key: 'gauge1P', value: 'NOPE' });
    intent({ type: 'set-play-option', key: 'gauge1P', value: 'HARD' });
    expect(advance(10).playOptions.gauge1P).toBe('HARD');
    expect(cues()).toEqual(['optionChange']);
  });
});

describe('SelectSession browse position', () => {
  it('gives back a snapshot that restores the bar by its key, the search, and the parent cursor', () => {
    const { session, advance } = createSession({ browse: { folderPath: ['courses'], cursors: [2, 1] } });
    const snapshot = session.snapshot();
    expect(snapshot).toMatchObject({ folderPath: ['courses'], focusKey: 'course:two' });
    const library = makeLibrary();
    const [folder] = library.courseFolders!;
    session.setLibrary({
      ...library,
      courseFolders: [makeCourseFolder('courses', [makeCourse('zero'), ...folder!.courses!])],
    });
    session.restore(snapshot);
    expect(focusedTitle(advance(10))).toBe('two');
    session.restore({ folderPath: ['gone'], cursors: [1, 0] });
    expect(focusedTitle(advance(10))).toBe('pack');
  });

  it('keeps the place over a new library, and redraws for the same one', () => {
    const { session, advance } = createSession({ browse: { folderPath: ['pack'], cursors: [1, 2] } });
    const before = advance(10).revision;
    session.setLibrary(session.frame(0).library);
    expect(advance(10).revision).toBeGreaterThan(before);
    session.setLibrary(makeLibrary());
    expect(focusedTitle(advance(10))).toBe('c');
  });

  it('searches, putting the cursor on the top of the new list', () => {
    const { session, advance } = createSession({ browse: { folderPath: ['pack'], cursors: [1, 2] } });
    session.setSearch('C');
    const frame = advance(10);
    expect(titles(frame)).toEqual(['c']);
    expect(frame.browse.searchText).toBe('C');
  });
});

describe('SelectSession chart filter search', () => {
  it('lists the charts of every folder an expression selects, reading the chart and its song information', () => {
    const { session, advance } = createSession();
    session.setSearch('?level >= 2 AND information.n = 2 ORDER BY level DESC');
    const frame = advance(10);
    expect(titles(frame)).toEqual(['a', 'c']);
    expect(frame.searchError).toBeUndefined();
  });

  it('reads the best records in force, and lists again when they change', () => {
    let lamps: Record<string, BestRecord['lamp']> = { a: 'HARD' };
    const records = {
      chart: (chart: LibraryChart) => (lamps[chart.id] === undefined ? undefined : { lamp: lamps[chart.id]! }),
      course: () => undefined,
    };
    const { session, advance } = createSession({ records });
    session.setSearch('?score.clear IS NULL');
    expect(titles(advance(10))).toEqual(['b', 'c', 'x']);
    lamps = { b: 'FAILED', x: 'MAX' };
    session.refreshRecords();
    expect(titles(advance(10))).toEqual(['a', 'c']);
  });

  it('reports an invalid expression and lists as if nothing were searched until it parses', () => {
    const { session, advance } = createSession();
    session.setSearch('?mode = 7');
    const invalid = advance(10);
    expect(invalid.searchError).toBe('ambiguous column name: mode');
    expect(session.searchError()).toBe('ambiguous column name: mode');
    expect(titles(invalid)).toEqual(['other', 'pack', 'courses']);
    session.setSearch('?song.mode = 7');
    const valid = advance(10);
    expect(valid.searchError).toBeUndefined();
    expect(titles(valid)).toEqual(['a', 'b', 'c', 'x']);
    session.setSearch('');
    expect(titles(advance(10))).toEqual(['other', 'pack', 'courses']);
  });
});

describe('SelectSession starting', () => {
  it('hands the chart on and plays the decide cue and jingle, with no owner so they play out', () => {
    const { key, audio, started, cues } = createSession({ browse: { folderPath: ['pack'], cursors: [1, 0] } });
    key('Enter');
    expect(started).toEqual([{ entry: 'a', autoPlay: false }]);
    expect(cues()).toEqual(['decide']);
    expect(audio.playJingle).toHaveBeenCalledWith(SOUNDS.decideBGM);
    expect(audio.playCue.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it('plays no decide sound when the host starts no play, and the cancel cue for a course that cannot start', () => {
    const { key, intent, audio, started, cues } = createSession({
      browse: { folderPath: ['courses'], cursors: [2, 0] },
      on: { start: () => false },
    });
    key('Enter');
    expect(audio.playJingle).not.toHaveBeenCalled();
    expect(cues()).toEqual([]);
    key('ArrowUp');
    intent({ type: 'start', autoPlay: true });
    expect(cues()).toEqual(['cursor', 'cancel']);
    expect(started).toEqual([]);
  });

  it('starts a course with AUTO from the skin’s button, and does nothing on a folder bar', () => {
    const { intent, started } = createSession({ browse: { folderPath: ['courses'], cursors: [2, 1] } });
    intent({ type: 'start', autoPlay: true });
    expect(started).toEqual([{ entry: 'two', autoPlay: true }]);
    const atRoot = createSession();
    atRoot.intent({ type: 'start' });
    expect(atRoot.started).toEqual([]);
  });

  it('waits for the skin’s launch outro before handing a chart on, ignoring input meanwhile', () => {
    const { key, advance, started } = createSession({
      browse: { folderPath: ['pack'], cursors: [1, 0] },
      launchOutroMs: () => 500,
    });
    advance(100);
    key('Enter');
    expect(advance(10).startedAtMs).toBe(100);
    expect(key('ArrowDown')).toBe(false);
    advance(480);
    expect(started).toEqual([]);
    const frame = advance(20);
    expect(started).toEqual([{ entry: 'a', autoPlay: false }]);
    expect(frame.startedAtMs).toBeUndefined();
  });
});

describe('SelectSession sound', () => {
  it('plays the select BGM as its own, under the cues, and stops it and the preview as the screen leaves', () => {
    const { session, audio } = createSession();
    expect(audio.playBGM).toHaveBeenCalledWith(SOUNDS.selectBGM, { owner: session, volume: 0.5 });
    session.exit();
    expect(audio.stopOwned).toHaveBeenCalledWith(session);
  });

  it('points the preview at the chart under the cursor, and not again at the same chart when the screen comes back', () => {
    const { session, key, advance, audio } = createSession({ browse: { folderPath: ['pack'], cursors: [1, 0] } });
    const focus = audio.preview.focus;
    expect(focus).toHaveBeenLastCalledWith(
      expect.objectContaining({ chart: expect.objectContaining({ id: 'a' }) }),
      session,
    );
    session.exit();
    session.enter(1000);
    session.frame(1000);
    // The preview stays silent on the chart played until the cursor moves, as the select scene always did.
    expect(focus).toHaveBeenCalledTimes(1);
    key('ArrowDown');
    advance(10);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenLastCalledWith(
      expect.objectContaining({ chart: expect.objectContaining({ id: 'b' }) }),
      session,
    );
  });

  it('points the preview at the chart a search brings under the cursor', () => {
    const { session, advance, audio } = createSession({ browse: { folderPath: ['pack'], cursors: [1, 0] } });
    session.setSearch('c');
    advance(10);
    expect(audio.preview.focus).toHaveBeenCalledTimes(2);
    expect(audio.preview.focus).toHaveBeenLastCalledWith(
      expect.objectContaining({ chart: expect.objectContaining({ id: 'c' }) }),
      session,
    );
  });

  it('points the preview at nothing on a folder bar', () => {
    const { key, advance, audio } = createSession({ browse: { folderPath: ['pack'], cursors: [1, 0] } });
    key('Escape');
    advance(10);
    expect(audio.preview.focus).toHaveBeenLastCalledWith(undefined);
  });
});

describe('SelectSession panels', () => {
  it('opens and closes the play-options panel on Space and Escape, and steps its options on the lane keys', () => {
    const playOptions = vi.fn();
    const { key, advance, cues } = createSession({ on: { playOptions } });
    key('Space', ' ');
    let frame = advance(10);
    expect(frame.panel).toBe(1);
    expect(frame.events).toEqual([{ kind: 'panel', panel: 1, open: true, atMs: 0 }]);
    key('KeyV', 'v');
    key('KeyD', 'd');
    frame = advance(10);
    expect(frame.playOptions.hiSpeed).toBeCloseTo(DEFAULT_PLAY_OPTIONS.hiSpeed + 0.1);
    expect(frame.playOptions.gauge1P).toBe('HARD');
    expect(playOptions).toHaveBeenCalledTimes(2);
    key('Escape');
    frame = advance(10);
    expect(frame.panel).toBeUndefined();
    expect(cues()).toEqual(['optionOpen', 'optionChange', 'optionChange', 'optionClose']);
  });

  it('swaps one panel for another', () => {
    const { intent, advance } = createSession();
    intent({ type: 'panel', panel: 1 });
    intent({ type: 'panel', panel: 2 });
    const frame = advance(10);
    expect(frame.panel).toBe(2);
    expect(frame.events.map((event) => event.kind === 'panel' && [event.panel, event.open])).toEqual([
      [1, true],
      [1, false],
      [2, true],
    ]);
  });
});

describe('SelectSession README overlay', () => {
  it('shows the text file next to the chart, scrolls it on the keys and closes it on Enter', async () => {
    const library = makeLibrary({ 'pack/readme.txt': new TextEncoder().encode('notes') });
    const { intent, key, advance, cues } = createSession({
      library,
      browse: { folderPath: ['pack'], cursors: [1, 0] },
    });
    intent({ type: 'readtext' });
    await vi.waitFor(() => expect(advance(10).readText?.text).toBe('notes'));
    key('ArrowDown');
    expect(advance(10).events).toEqual([{ kind: 'readtext-scroll', delta: 36 }]);
    key('Enter');
    expect(advance(10).readText).toBeUndefined();
    expect(cues()).toEqual(['optionOpen', 'optionClose']);
  });

  it('plays the option-change cue for a chart with no text file, and leaves a host’s readtext to the host', async () => {
    const { intent, cues } = createSession({ browse: { folderPath: ['pack'], cursors: [1, 0] } });
    intent({ type: 'readtext' });
    await vi.waitFor(() => expect(cues()).toEqual(['optionChange']));
    const readtext = vi.fn();
    const hosted = createSession({ browse: { folderPath: ['pack'], cursors: [1, 0] }, on: { readtext } });
    hosted.intent({ type: 'readtext' });
    expect(readtext).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
});

describe('SelectSession course maker', () => {
  /** A course maker that owns the courses marked editable, recording what it is asked. */
  function createMaker(draft: boolean) {
    return {
      draft: draft ? ({ kind: 'nonstop', stages: [] } as never) : undefined,
      defaultConnection: 'FADE' as never,
      owns: vi.fn(() => true),
      finish: vi.fn(),
      cancel: vi.fn(),
      stepDefaultConnection: vi.fn(),
      stepConnection: vi.fn(),
    };
  }

  /** The player's own course and another one, in a course folder. */
  function makeCourseLibrary() {
    return makeCollection(
      [makeChart('a', 'pack')],
      [makeCourseFolder('mine', [makeCourse('own', { editable: true }), makeCourse('other')])],
    );
  }

  it('shows the course being made in the frame, and runs its finish, cancel and default connection', () => {
    const courseMaker = createMaker(true);
    const { intent, advance } = createSession({ courseMaker });
    expect(advance(10).courseMaker).toEqual({ draft: courseMaker.draft, defaultConnection: 'FADE' });
    intent({ type: 'course-maker', action: { kind: 'finish' } });
    intent({ type: 'course-maker', action: { kind: 'cancel' } });
    intent({ type: 'course-maker', action: { kind: 'default-connection', step: -1 } });
    expect(courseMaker.finish).toHaveBeenCalledTimes(1);
    expect(courseMaker.cancel).toHaveBeenCalledTimes(1);
    expect(courseMaker.stepDefaultConnection).toHaveBeenCalledWith(-1);
  });

  it('steps a connection of, or asks to delete, only the player’s own course under the cursor', () => {
    const courseMaker = createMaker(false);
    const courseMakerEvent = vi.fn();
    const { intent, key } = createSession({
      library: makeCourseLibrary(),
      browse: { folderPath: ['mine'], cursors: [1, 0] },
      courseMaker,
      on: { courseMaker: courseMakerEvent },
    });
    intent({ type: 'course-maker', action: { kind: 'connection', slot: 2, step: 1 } });
    intent({ type: 'course-maker', action: { kind: 'delete' } });
    intent({ type: 'course-maker', action: { kind: 'name' } });
    expect(courseMaker.stepConnection).toHaveBeenCalledWith(expect.objectContaining({ name: 'own' }), 2, 1);
    expect(courseMakerEvent.mock.calls.map(([action, course]) => [action, course?.id])).toEqual([
      ['delete', 'own'],
      ['name', 'own'],
    ]);
    key('ArrowDown');
    intent({ type: 'course-maker', action: { kind: 'connection', slot: 0, step: 1 } });
    intent({ type: 'course-maker', action: { kind: 'delete' } });
    intent({ type: 'course-maker', action: { kind: 'name' } });
    expect(courseMaker.stepConnection).toHaveBeenCalledTimes(1);
    expect(courseMakerEvent).toHaveBeenCalledTimes(2);
  });
});

describe('SelectSession on the beatoraja family', () => {
  const BEATORAJA = SELECT_POLICIES.beatoraja;

  /** A grade course named `id`, of `keyMode` keys when given. */
  function courseOf(id: string, keyMode?: number) {
    const course = makeCourse(id);
    return keyMode === undefined ? course : { ...course, definition: { ...course.definition, keyMode } };
  }

  it('moves a page, jumps to either end and picks a random bar on its keys', () => {
    const library = makeCollection(Array.from({ length: 12 }, (_, index) => makeChart(`c${index}`, 'pack')));
    const { key, advance } = createSession({
      library,
      policy: BEATORAJA,
      browse: { folderPath: ['pack'], cursors: [0, 0] },
      random: () => 0.5,
    });
    key('PageDown');
    expect(focusedTitle(advance(10))).toBe('c10');
    key('PageDown');
    expect(focusedTitle(advance(10))).toBe('c8');
    key('Home');
    expect(focusedTitle(advance(10))).toBe('c0');
    key('End');
    expect(focusedTitle(advance(10))).toBe('c11');
    key('KeyR', 'r');
    expect(focusedTitle(advance(10))).toBe('c6');
    // Not with a modifier: Ctrl / Cmd + R reloads the page.
    const { session } = createSession({ library, policy: BEATORAJA });
    expect(session.handleKey({ ...keyEvent('KeyR', 'r', 0), metaKey: true })).toBe(false);
  });

  it('backs out of a folder on Backspace and Escape, and leaves the screen at the root on Escape only', () => {
    const exit = vi.fn();
    const { key, advance } = createSession({
      policy: BEATORAJA,
      browse: { folderPath: ['pack'], cursors: [1, 0] },
      on: { exit },
    });
    expect(key('Backspace')).toBe(true);
    expect(advance(10).browse.path).toEqual([]);
    expect(key('Backspace')).toBe(false);
    expect(exit).not.toHaveBeenCalled();
    expect(key('Escape')).toBe(true);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('plays the folder cues alone as a folder opens or closes', () => {
    const { key, cues } = createSession({ policy: BEATORAJA });
    key('ArrowDown');
    key('Enter');
    key('Escape');
    expect(cues()).toEqual(['cursor', 'folderOpen', 'folderClose']);
  });

  it('keeps its sort and key filter in the browse position, whatever the play options say', () => {
    const { session, intent, advance, cues } = createSession({
      policy: BEATORAJA,
      playOptions: { sort: 'LEVEL' },
      browse: { folderPath: ['pack'], cursors: [1, 0], list: { sort: 'TITLE' } },
    });
    let frame = advance(10);
    expect(frame.browse.list.sort).toBe('TITLE');
    expect(titles(frame)).toEqual(['a', 'b', 'c']);
    session.setPlayOptions({ sort: 'LEVEL', keysFilter: 'KEYS_5' });
    frame = advance(10);
    expect(frame.browse.list).toMatchObject({ sort: 'TITLE', keysFilter: 'ALL' });
    intent({ type: 'browse', command: { type: 'list', options: { sort: 'LEVEL' } } });
    frame = advance(10);
    expect(titles(frame)).toEqual(['b', 'c', 'a']);
    expect(cues()).toEqual(['optionChange']);
    expect(session.snapshot().list?.sort).toBe('LEVEL');
    // Without a position to restore the list starts in the library's order: the play options' sort is LR2's.
    const fresh = createSession({ policy: BEATORAJA, playOptions: { sort: 'LEVEL' } });
    expect(fresh.frame().browse.list.sort).toBe('OFF');
  });

  it('lists every folder bar under the key filter, and the courses of its key mode', () => {
    const library = makeCollection(
      [makeChart('five', 'Five', { channels: ['11', '16'] }), makeChart('seven', 'Seven')],
      [makeCourseFolder('Dan', [courseOf('seven-dan', 7), courseOf('five-dan', 5), courseOf('any')])],
    );
    const { intent, advance } = createSession({ library, policy: BEATORAJA });
    intent({ type: 'browse', command: { type: 'list', options: { keysFilter: 'KEYS_5' } } });
    expect(titles(advance(10))).toEqual(['Five', 'Seven', 'Dan']);
    intent({ type: 'browse', command: { type: 'jump', index: 2 } });
    intent({ type: 'activate' });
    expect(titles(advance(10))).toEqual(['five-dan', 'any']);
  });

  it("searches a chart's file label and a course folder's courses by name, by the trimmed text", () => {
    const library = makeCollection(
      [
        { ...makeChart('lapis', 'Pack'), fileLabel: 'lapis [ANOTHER].bms' },
        { ...makeChart('hikari', 'Pack'), fileLabel: 'hikari.bms' },
      ],
      [makeCourseFolder('Dan', [courseOf('First Dan'), courseOf('Tenth Dan')])],
    );
    const { session, intent, advance } = createSession({ library, policy: BEATORAJA });
    session.setSearch('  another ');
    expect(titles(advance(10))).toEqual(['lapis']);
    session.setSearch('   ');
    expect(titles(advance(10))).toEqual(['Pack', 'Dan']);
    intent({ type: 'browse', command: { type: 'jump', index: 1 } });
    intent({ type: 'activate' });
    session.setSearch('tenth');
    expect(titles(advance(10))).toEqual(['Tenth Dan']);
  });

  it('orders the root folders by label under a sort, the course folders among them', () => {
    const library = makeCollection(
      [makeChart('z', 'Zeta'), makeChart('b', 'Beta')],
      [makeCourseFolder('Dan', [courseOf('First Dan')])],
    );
    const { intent, advance } = createSession({ library, policy: BEATORAJA });
    expect(titles(advance(10))).toEqual(['Beta', 'Zeta', 'Dan']);
    intent({ type: 'browse', command: { type: 'move', delta: 1 } });
    intent({ type: 'browse', command: { type: 'list', options: { sort: 'TITLE' } } });
    const frame = advance(10);
    expect(titles(frame)).toEqual(['Beta', 'Dan', 'Zeta']);
    expect(focusedTitle(frame)).toBe('Zeta');
  });

  it('orders titles case-insensitively in the runtime locale, and levels by value with equal levels by title', () => {
    const library = makeCollection([
      { ...makeChart('Charlie', 'Pack'), playLevel: '12.5' },
      { ...makeChart('beta', 'Pack'), playLevel: 12 },
      { ...makeChart('Beta', 'Pack'), playLevel: '12' },
      makeChart('alpha', 'Pack'),
    ]);
    const { intent, advance } = createSession({
      library,
      policy: BEATORAJA,
      browse: { folderPath: ['Pack'], cursors: [0, 0] },
    });
    intent({ type: 'browse', command: { type: 'list', options: { sort: 'TITLE' } } });
    // `beta` and `Beta` differ only in case: they keep the library's order.
    expect(titles(advance(10))).toEqual(['alpha', 'beta', 'Beta', 'Charlie']);
    intent({ type: 'browse', command: { type: 'list', options: { sort: 'LEVEL' } } });
    expect(titles(advance(10))).toEqual(['beta', 'Beta', 'Charlie', 'alpha']);
  });
});
