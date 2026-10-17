// Pixi's event mixin (`eventMode`, `isInteractive`) is installed by its events entry; nothing else loads it in Node.
import 'pixi.js/events';
import {
  BEATORAJA_BUTTON,
  BEATORAJA_OP,
  TIMER_SONGBAR_CHANGE,
  type BeatorajaSkin,
  type BeatorajaSkinConfig,
} from '@be-music/beatoraja-skin';
import type { SelectRecords } from '../types.ts';
import { Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { BrowserSongCollection } from '../../collection/types.ts';
import type { BeatorajaKit } from '../../host/family-kit.ts';
import { SILENT_AUDIO } from '../../runtime/audio-analysis.ts';
import { BeatorajaPlaySkinView } from '../../scene/beatoraja/skin-view.ts';
import type { PixiSceneHost } from '../../scene/host.ts';
import { SELECT_POLICIES } from '../../session/select/select-policy.ts';
import { SelectSession, type SelectAudio } from '../../session/select/select-session.ts';
import { makeChart, makeCollection, makeCourse, makeCourseFolder } from '../../session/select/test-support.ts';
import type { BeatorajaRenderContext } from '../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type { SelectFrame } from '../types.ts';
import { BeatorajaSelectView, type BeatorajaSelectViewOptions } from './select-view.ts';

const HOST = { app: { screen: { width: 1280, height: 720 } } } as unknown as PixiSceneHost;

function beatorajaSelectKit(skinConfig?: BeatorajaSkinConfig): BeatorajaKit {
  const skin: BeatorajaSkin = { type: 5, w: 1280, h: 720, image: [], destination: [] };
  const empty = new Map<number | string, Texture>();
  const textures: BeatorajaTextureCache = {
    get: (id) => empty.get(id),
    values: () => empty.values(),
    pathOf: () => undefined,
  };
  return {
    family: 'beatoraja',
    kit: { skin, textures, files: new Map(), ...(skinConfig !== undefined ? { skinConfig } : {}) },
  };
}

function createAudio(): SelectAudio {
  return {
    playBgm: vi.fn(async () => true),
    stopBgm: vi.fn(),
    playCue: vi.fn(async () => true),
    playJingle: vi.fn(async () => true),
    stopOwned: vi.fn(),
    resume: vi.fn(),
    preview: { focus: vi.fn(), stop: vi.fn(), playing: false },
    analyzer: { sample: () => SILENT_AUDIO },
  };
}

/** What the tests reach of the view. */
type ViewInternals = {
  scrollPosition: number;
  handleButtonAction(act: number, back: boolean): void;
  handleRowPointerTap(rowOffset: number): void;
  rows: { centreRowIndex: number };
  skinState: { resolveSelectionRefValue(ref: number): number };
  chartImages: { resolveChartImageForFocus(id: number): Texture | undefined };
};

/**
 * The beatoraja select view drawing a select session's frames under the beatoraja policy, its intents going back to the
 * session, on a clock the test moves.
 */
function setup(
  library: BrowserSongCollection,
  options: { kit?: BeatorajaKit; view?: BeatorajaSelectViewOptions; records?: SelectRecords } = {},
) {
  let clock = 0;
  const start = vi.fn();
  const session = new SelectSession({
    library,
    sounds: {},
    audio: createAudio(),
    policy: SELECT_POLICIES.beatoraja,
    now: () => clock,
    ...(options.records !== undefined ? { records: options.records } : {}),
    on: { start },
  });
  const view = new BeatorajaSelectView(options.kit ?? beatorajaSelectKit(), options.view);
  view.attach(HOST, (intent) => session.dispatch(intent));
  session.enter(0);
  const update = vi.spyOn(BeatorajaPlaySkinView.prototype, 'update').mockImplementation(() => undefined);
  const draw = (ms = clock): SelectFrame => {
    clock = ms;
    const frame = session.frame(ms);
    view.draw(frame);
    return frame;
  };
  const context = (): BeatorajaRenderContext => update.mock.calls.at(-1)![0] as BeatorajaRenderContext;
  const internals = view as unknown as ViewInternals;
  const press = (act: number, back = false): SelectFrame => {
    internals.handleButtonAction(act, back);
    return draw();
  };
  return { session, view, draw, context, internals, press, start };
}

/** The bar under the cursor: a chart's id, a folder's label or a course's id. */
function focused(frame: SelectFrame): string | undefined {
  const entry = frame.entries[frame.cursor];
  if (entry === undefined) return undefined;
  return entry.kind === 'song' ? entry.song.id : entry.kind === 'folder' ? entry.folder.label : entry.course.id;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BeatorajaSelectView', () => {
  it("draws the focused bar's ops, the record's lamp and the skin's options on the screen's own clock", () => {
    const library = makeCollection([makeChart('a', 'pack'), makeChart('b', 'pack')]);
    const records: SelectRecords = {
      chart: (chart) => (chart.id === 'b' ? { lamp: 'HARD', playCount: 1 } : undefined),
      course: () => undefined,
    };
    const { draw, context, session } = setup(library, {
      kit: beatorajaSelectKit({ offset: 0, option: { 900: 901 }, file: {} }),
      records,
    });
    draw(250);
    expect(context().nowMs).toBe(250);
    expect(context().activeOps.has(BEATORAJA_OP.FOLDERBAR)).toBe(true);
    expect(context().activeOps.has(901)).toBe(true);
    session.dispatch({ type: 'activate' });
    session.dispatch({ type: 'browse', command: { type: 'move', delta: 1 } });
    draw(300);
    const ops = context().activeOps;
    expect(ops.has(BEATORAJA_OP.SONGBAR)).toBe(true);
    expect(ops.has(BEATORAJA_OP.CLEAR_LAMP_HARD)).toBe(true);
    expect(ops.has(BEATORAJA_OP.FOLDERBAR)).toBe(false);
  });

  it('starts the bar-change timer at the entry and whenever the bar under the cursor changes', () => {
    const { draw, context, session } = setup(makeCollection([makeChart('a', 'one'), makeChart('b', 'two')]));
    draw(100);
    expect(context().getTimerStart(TIMER_SONGBAR_CHANGE)).toBe(0);
    session.dispatch({ type: 'browse', command: { type: 'move', delta: 1 } });
    draw(500);
    expect(context().getTimerStart(TIMER_SONGBAR_CHANGE)).toBe(500);
    draw(600);
    expect(context().getTimerStart(TIMER_SONGBAR_CHANGE)).toBe(500);
  });

  it('steps the browse position’s key filter and sort on MODE and SORT, Shift stepping back', () => {
    const { draw, press } = setup(makeCollection([makeChart('a', 'pack')]));
    draw();
    expect(press(BEATORAJA_BUTTON.MODE).browse.list.keysFilter).toBe('KEYS_5');
    expect(press(BEATORAJA_BUTTON.MODE, true).browse.list.keysFilter).toBe('ALL');
    expect(press(BEATORAJA_BUTTON.MODE, true).browse.list.keysFilter).toBe('KEYS_48');
    expect(press(BEATORAJA_BUTTON.SORT).browse.list.sort).toBe('TITLE');
    expect(press(BEATORAJA_BUTTON.SORT, true).browse.list.sort).toBe('OFF');
    expect(press(BEATORAJA_BUTTON.SORT, true).browse.list.sort).toBe('LASTPLAY');
  });

  it('steps on when MODE or SORT is pressed again before the next frame', () => {
    const { draw, internals } = setup(makeCollection([makeChart('a', 'pack')]));
    draw();
    internals.handleButtonAction(BEATORAJA_BUTTON.SORT, false);
    internals.handleButtonAction(BEATORAJA_BUTTON.SORT, false);
    internals.handleButtonAction(BEATORAJA_BUTTON.MODE, false);
    internals.handleButtonAction(BEATORAJA_BUTTON.MODE, false);
    expect(draw().browse.list).toMatchObject({ sort: 'ARTIST', keysFilter: 'KEYS_7' });
  });

  it('starts the chart from PLAY, AUTO and PRACTICE, and marks its favourites', () => {
    const { draw, press, start, session } = setup(makeCollection([makeChart('a', 'pack')]));
    session.dispatch({ type: 'activate' });
    draw();
    press(BEATORAJA_BUTTON.PLAY);
    press(BEATORAJA_BUTTON.AUTOPLAY);
    press(BEATORAJA_BUTTON.PRACTICE);
    expect(start.mock.calls.map(([, options]) => options)).toEqual([
      { autoPlay: false },
      { autoPlay: true },
      { autoPlay: false },
    ]);
    expect(press(BEATORAJA_BUTTON.FAVORITTE_SONG).browse.favorites.music).toEqual(['a']);
    expect(press(BEATORAJA_BUTTON.FAVORITTE_CHART).browse.favorites.charts).toEqual(['a']);
  });

  it('starts a course bar from PLAY and AUTO', () => {
    const library = makeCollection([], [makeCourseFolder('Dan', [makeCourse('dan')])]);
    const { draw, press, start, session } = setup(library);
    session.dispatch({ type: 'activate' });
    draw();
    press(BEATORAJA_BUTTON.AUTOPLAY);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'course' }), { autoPlay: true });
  });

  it('moves the cursor onto a clicked bar by the rows between, and takes it when it is the focused one', () => {
    const { draw, internals } = setup(makeCollection([makeChart('a', 'one'), makeChart('b', 'two')]));
    draw();
    internals.handleRowPointerTap(internals.rows.centreRowIndex + 1);
    let frame = draw();
    expect(focused(frame)).toBe('two');
    // Let the list glide onto the bar, then click it.
    frame = draw(1000);
    internals.handleRowPointerTap(internals.rows.centreRowIndex);
    frame = draw();
    expect(frame.browse.path.map((folder) => folder.label)).toEqual(['two']);
  });

  it('glides the short way round when the cursor wraps', () => {
    const { draw, internals, session } = setup(
      makeCollection([makeChart('a', 'one'), makeChart('b', 'two'), makeChart('c', 'three')]),
    );
    draw(0);
    session.dispatch({ type: 'browse', command: { type: 'move', delta: -1 } });
    const frame = draw(16);
    expect(frame.cursor).toBe(2);
    // One bar up from the first bar, not across the list: the glide goes from 3 (the first bar, a list further on) to 2.
    expect(internals.scrollPosition).toBeGreaterThan(2);
    expect(internals.scrollPosition).toBeLessThan(3);
    draw(1000);
    draw(1016);
    expect(internals.scrollPosition).toBe(2);
  });

  it("keeps the LNMODE button's choice in the view, from the chart's own #LNMODE", () => {
    const chart = makeChart('a', 'pack');
    chart.chart.bms.lnMode = 2;
    const { draw, internals, session } = setup(makeCollection([chart]));
    session.dispatch({ type: 'activate' });
    draw();
    expect(internals.skinState.resolveSelectionRefValue(BEATORAJA_BUTTON.LNMODE)).toBe(1);
    internals.handleButtonAction(BEATORAJA_BUTTON.LNMODE, false);
    expect(internals.skinState.resolveSelectionRefValue(BEATORAJA_BUTTON.LNMODE)).toBe(2);
    internals.handleButtonAction(BEATORAJA_BUTTON.LNMODE, true);
    internals.handleButtonAction(BEATORAJA_BUTTON.LNMODE, true);
    expect(internals.skinState.resolveSelectionRefValue(BEATORAJA_BUTTON.LNMODE)).toBe(0);
  });

  it("steps the skin's judge timing within ±200 ms and hands the options to the host", () => {
    const onSkinConfigChange = vi.fn();
    const { draw, press } = setup(makeCollection([makeChart('a', 'pack')]), {
      kit: beatorajaSelectKit({ offset: 199, option: { 1: 2 }, file: {} }),
      view: { onSkinConfigChange },
    });
    draw();
    press(BEATORAJA_BUTTON.JUDGE_TIMING);
    press(BEATORAJA_BUTTON.JUDGE_TIMING);
    press(BEATORAJA_BUTTON.JUDGE_TIMING, true);
    expect(onSkinConfigChange.mock.calls.map(([config]) => (config as BeatorajaSkinConfig).offset)).toEqual([200, 199]);
    expect(onSkinConfigChange.mock.calls[0]![0]).toMatchObject({ option: { 1: 2 } });
  });

  it("loads the focused chart's own images over the library's files", async () => {
    const banner = Texture.WHITE;
    const loadChartImages = vi.fn(async () => ({ banner }));
    const library = makeCollection([makeChart('a', 'pack')]);
    const { draw, internals, session } = setup(library, { view: { loadChartImages } });
    session.dispatch({ type: 'activate' });
    draw();
    expect(loadChartImages).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), library);
    await Promise.resolve();
    await Promise.resolve();
    expect(internals.chartImages.resolveChartImageForFocus(-102)).toBe(banner);
    draw();
    expect(loadChartImages).toHaveBeenCalledTimes(1);
  });

  it('builds the skin again for a new kit, keeping its place', () => {
    const { view, draw, session } = setup(makeCollection([makeChart('a', 'one'), makeChart('b', 'two')]));
    session.dispatch({ type: 'browse', command: { type: 'move', delta: 1 } });
    draw();
    const before = view.getStageInfo().container;
    view.updateKit(beatorajaSelectKit({ offset: 0, option: {}, file: {} }));
    expect(view.getStageInfo().container).not.toBe(before);
    expect(before.destroyed).toBe(true);
    expect(focused(draw())).toBe('two');
    view.dispose();
    expect(view.root.destroyed).toBe(true);
  });
});
