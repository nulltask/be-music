/**
 * nanasigroove 1.552's ADDMINE (`774:CRAZY_ADDMINE`, #1185): mines scattered along every lane at random intervals, with
 * random damage. Positions are counted as nanasigroove counts them, 48 to a beat.
 *
 * Each lane draws its own pattern:
 *
 * 1. One draw in 1000 picks a dense lane (a mine step of up to 168), one in ten a varied lane (two steps between 180 and
 *    360, and damage thresholds that lean harsher), and the rest a regular lane (a step of up to 360).
 * 2. The first mine sits a random step plus 24 into the chart; each next one a fresh random step plus 24 further on.
 * 3. Four candidates in five become mines; a candidate within 12 of a note on the lane is skipped.
 * 4. Each mine's damage is drawn in five bands, from 1–5 up to 1–200 on nanasigroove's 200-point gauge; the rarest band
 *    is a mine that heals one point.
 *
 * Be-Music plays the damage as a gauge percentage, so it is halved (200 points are the whole gauge). A healing mine has
 * no form in Be-Music's mine model, which deals non-negative damage: it deals none. Mine trigger and its accounting stay
 * the judge ruleset's.
 */

/** nanasigroove positions per beat (192 to a 4/4 measure). */
const UNITS_PER_BEAT = 48;
/** A candidate this close to a note on its lane (inclusive) is skipped. */
const NOTE_CLEARANCE_UNITS = 12;
/** Every step adds this much. */
const STEP_BASE_UNITS = 24;

/** One added mine: its lane, its beat and its damage as a gauge percentage. */
export interface NanasiMine {
  lane: string;
  beat: number;
  damage: number;
}

/** A uniform draw in `[0, 1)`; `draw(random, n)` is nanasigroove's `rand() % n`. */
export type NanasiRandom = () => number;

function draw(random: NanasiRandom, n: number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('ADDMINE randomness must be in [0, 1).');
  return Math.floor(value * n);
}

interface LanePattern {
  firstStep: number;
  step: number;
  thresholds: readonly [number, number, number, number];
}

function drawLanePattern(random: NanasiRandom): LanePattern {
  const kind = draw(random, 1000);
  if (kind === 0) return { firstStep: 168, step: 168, thresholds: [900, 930, 940, 950] };
  if (kind < 100) {
    const firstStep = 360 - draw(random, 180);
    const step = 360 - draw(random, 180);
    const last = 998 - draw(random, 9);
    return { firstStep, step, thresholds: [250, 800, 975, last] };
  }
  return { firstStep: 360, step: 360, thresholds: [400, 925, 975, 998] };
}

/** One mine's damage on nanasigroove's 200-point gauge (`-1` heals a point). */
function drawDamagePoints(random: NanasiRandom, thresholds: LanePattern['thresholds']): number {
  const band = draw(random, 1000);
  if (band < thresholds[0]) return draw(random, 5) + 1;
  if (band < thresholds[1]) return draw(random, 10) + 1;
  if (band < thresholds[2]) return draw(random, 50) + 1;
  if (band < thresholds[3]) return draw(random, 200) + 1;
  return -1;
}

/**
 * The mines ADDMINE adds to `lanes` (in that order, each lane drawing in turn) of a chart `endBeat` beats long, given each
 * lane's note beats. Mines are returned lane by lane, in beat order.
 */
export function addNanasiMines(
  lanes: readonly string[],
  noteBeats: ReadonlyMap<string, readonly number[]>,
  endBeat: number,
  random: NanasiRandom,
): NanasiMine[] {
  const mines: NanasiMine[] = [];
  const endUnits = endBeat * UNITS_PER_BEAT;
  for (const lane of lanes) {
    const pattern = drawLanePattern(random);
    const notes = (noteBeats.get(lane) ?? []).map((beat) => beat * UNITS_PER_BEAT);
    let position = draw(random, pattern.firstStep) + STEP_BASE_UNITS;
    while (position < endUnits) {
      if (draw(random, 5) !== 0) {
        const blocked = notes.some((note) => Math.abs(note - position) <= NOTE_CLEARANCE_UNITS);
        if (!blocked) {
          const points = drawDamagePoints(random, pattern.thresholds);
          mines.push({ lane, beat: position / UNITS_PER_BEAT, damage: points > 0 ? points / 2 : 0 });
        }
      }
      position += draw(random, pattern.step) + STEP_BASE_UNITS;
    }
  }
  return mines;
}
