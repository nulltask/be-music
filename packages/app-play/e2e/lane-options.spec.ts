import { FIXTURE_CHARTS } from '../../../scripts/course-checklist/fixtures.ts';
import type { TestHookFamily } from '../src/test-hook.ts';
import { expect, openWithLibrary, SMOKE, SONGS, test, type Player } from './support.ts';

/**
 * The lane options apply on every family (ADR 0001): an AUTO play of Fixture A with the Debug Menu's Random 1P on
 * MIRROR plays the chart's keys mirrored, and its replay records the option and the arrangement played.
 */

const PLAY_OPTIONS = ['Play options'];

/** The fixture skins' select screens (640 × 480) put AUTO at (230, 430): `scripts/course-checklist/skins`. */
const SELECT_SKIN = { width: 640, height: 480 };
const AUTO_BUTTON = { x: 230, y: 430 };

/** The 1P keys of a 7-key chart, key 1 to key 7; the scratch (`16`) is no key and stays put. */
const KEYS_1P = ['11', '12', '13', '14', '15', '18', '19'];

/** MIRROR on a side that uses all seven keys: key 1 ↔ key 7, 2 ↔ 6, 3 ↔ 5, 4 stays. */
function mirrored(channel: string): string {
  const key = KEYS_1P.indexOf(channel);
  return key < 0 ? channel : KEYS_1P[KEYS_1P.length - 1 - key]!;
}

/** The channels of Fixture A's notes in time order, as `fixtureBMS` writes them (one note per row). */
function fixtureAChannels(): string[] {
  const { measures, perMeasure, lanes } = FIXTURE_CHARTS.A!.chart;
  const channels: string[] = [];
  for (let measure = 1; measure <= measures; measure += 1) {
    for (let index = 0; index < perMeasure; index += 1) {
      channels.push(lanes[(measure * perMeasure + index) % lanes.length]!);
    }
  }
  return channels;
}

/** How a family opens with the fixture library and starts the chart under the cursor with AUTO. */
interface FamilyCase {
  name: string;
  family: TestHookFamily;
  open(player: Player): Promise<void>;
  startAuto(player: Player): Promise<void>;
}

const clickAuto = (player: Player) =>
  player.clickSkin(AUTO_BUTTON.x, AUTO_BUTTON.y, SELECT_SKIN.width, SELECT_SKIN.height);

const FAMILIES: readonly FamilyCase[] = [
  {
    name: 'built-in',
    family: 'built-in',
    open: (player) => openWithLibrary(player),
    async startAuto(player) {
      await player.setOption(PLAY_OPTIONS, 'Auto play', true);
      await player.key('Enter');
    },
  },
  {
    name: 'LR2',
    family: 'lr2',
    async open(player) {
      await openWithLibrary(player);
      await player.drop('skins/lr2');
      await player.waitFor((state) => state.scene.kind === 'select' && state.scene.family === 'lr2', 'the LR2 select');
    },
    startAuto: clickAuto,
  },
  {
    name: 'beatoraja',
    family: 'beatoraja',
    async open(player) {
      await openWithLibrary(player);
      await player.drop('skins/beatoraja');
      await player.waitFor(
        (state) => state.scene.kind === 'select' && state.scene.family === 'beatoraja',
        'the beatoraja select',
      );
    },
    startAuto: clickAuto,
  },
];

for (const setup of FAMILIES) {
  test(`MIRROR plays the keys mirrored and is recorded on the ${setup.name} family`, SMOKE, async ({ player }) => {
    await setup.open(player);
    await player.setOption(PLAY_OPTIONS, 'Random 1P', 'MIRROR');
    await player.browseTo(SONGS, 'Fixture A');
    await setup.startAuto(player);
    const playing = await player.waitFor(
      (state) => state.scene.kind === 'play' && state.play?.title === 'Fixture A',
      'Fixture A to play',
    );
    expect(playing.scene.family).toBe(setup.family);
    expect(playing.play?.autoPlay).toBe(true);
    const state = await player.waitForResult(0);
    expect(state.results[0]).toMatchObject({ run: 'single', family: setup.family, title: 'Fixture A' });

    const replay = await player.lastReplay();
    if (replay === undefined) throw new Error('the play recorded no log');
    expect(replay.play.mode).toBe('auto');
    expect(replay.play.randomLane?.p1).toBe('MIRROR');
    // The log's notes are the lanes the chart played on: every key mirrored, the scratch where it was.
    const played = replay.chart.notes
      .filter((note) => note.type === 'normal')
      .sort((left, right) => left.timeUs - right.timeUs)
      .map((note) => note.channel);
    const written = fixtureAChannels();
    expect(played).toEqual(written.map(mirrored));
    expect(played).not.toEqual(written);
    // Every note was played where it fell: AUTO judges each one PGREAT on the mirrored lane.
    expect(state.results[0]!.judged).toMatchObject({ pgreat: written.length, poor: 0 });
  });
}
