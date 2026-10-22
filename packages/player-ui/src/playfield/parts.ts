import {
  judgeDisplayWord,
  resolveLaneRuns,
  type BeMusicGameplayFrame,
  type BeMusicRect,
  type BeMusicSide,
} from '@be-music/player-skin-sdk';
import type { BeMusicLaneCoverArea, BeMusicPlayfieldParts } from '../models.ts';

/** Room a bomb's ring needs around the judge line: its largest radius plus half its stroke. */
const BOMB_REACH = 26;
/** How far above the judge line the judgment word's baseline sits, and the band its glyphs take. */
const JUDGMENT_OFFSET = 90;
const JUDGMENT_ASCENT = 22;
const JUDGMENT_DESCENT = 6;
const JUDGE_LINE_HEIGHT = 2;

/**
 * Splits a gameplay frame into the playfield's canvas components and the stage rect each one covers, so each can own a
 * canvas no larger than its part of the stage. Coordinates stay in stage design pixels.
 */
export function resolvePlayfieldParts(
  frame: Pick<
    BeMusicGameplayFrame,
    'layout' | 'lanes' | 'notes' | 'longNotes' | 'mines' | 'measureLines' | 'bombs' | 'runtime'
  >,
): BeMusicPlayfieldParts {
  const { layout, lanes } = frame;
  const { playfield, stage } = layout;
  const runs = resolveLaneRuns(lanes);
  const left = runs.length > 0 ? runs[0]!.left : playfield.left;
  const right = runs.length > 0 ? runs[runs.length - 1]!.right : playfield.right;
  const width = Math.max(0, right - left);
  let top = Infinity;
  let bottom = -Infinity;
  for (const lane of lanes) {
    top = Math.min(top, lane.top);
    bottom = Math.max(bottom, lane.bottom);
  }
  const laneRect = lanes.length > 0 ? rect(left, top, width, bottom - top) : rect(left, playfield.top, 0, 0);
  const judgmentY = playfield.judgementY - JUDGMENT_OFFSET;
  const words: { x: number; text: string }[] = [];
  for (const side of frame.runtime.judgeSides ?? []) {
    if (!side.judge) continue;
    const bounds = playfield.sides[side.side];
    words.push({
      x: bounds ? (bounds.left + bounds.right) / 2 : playfield.centerX,
      text: judgeDisplayWord(side.judge),
    });
  }
  return {
    stage: { width: stage.width, height: stage.height },
    lanes: { rect: laneRect, data: { lanes } },
    // Notes may scroll below the judge line under a negative `#SCROLL`, down to the stage's bottom edge.
    notes: {
      rect: rect(left, playfield.top, width, stage.height - playfield.top),
      data: { notes: frame.notes, longNotes: frame.longNotes, mines: frame.mines, measureLines: frame.measureLines },
    },
    laneCovers: { rect: laneRect, data: { areas: resolveLaneCoverAreas(frame) } },
    judgeLine: {
      rect: rect(left, playfield.judgementY, width, JUDGE_LINE_HEIGHT),
      data: { runs, y: playfield.judgementY },
    },
    bombs: {
      rect: rect(left, playfield.judgementY - BOMB_REACH, width, BOMB_REACH * 2),
      data: { bombs: frame.bombs },
    },
    judgmentDisplay: {
      rect: rect(left, judgmentY - JUDGMENT_ASCENT, width, JUDGMENT_ASCENT + JUDGMENT_DESCENT),
      data: { words, y: judgmentY },
    },
  };
}

/** Each covered side's lane area: its horizontal extent from the layout, its height from that side's lanes. */
function resolveLaneCoverAreas(
  frame: Pick<BeMusicGameplayFrame, 'layout' | 'lanes' | 'runtime'>,
): BeMusicLaneCoverArea[] {
  const covers = frame.runtime.laneCovers ?? [];
  if (covers.length === 0) return [];
  const sideOf = new Map<string, BeMusicSide>();
  for (const lane of frame.layout.lanes) if (lane.channel) sideOf.set(lane.channel, lane.side);
  const areas: BeMusicLaneCoverArea[] = [];
  for (const cover of covers) {
    if (!(cover.sudden > 0) && !(cover.hidden > 0)) continue;
    const bounds = frame.layout.playfield.sides[cover.side];
    if (!bounds) continue;
    let top = Infinity;
    let bottom = -Infinity;
    for (const lane of frame.lanes) {
      if (sideOf.get(lane.channel) !== cover.side) continue;
      top = Math.min(top, lane.top);
      bottom = Math.max(bottom, lane.bottom);
    }
    if (!(bottom > top)) continue;
    areas.push({ left: bounds.left, right: bounds.right, top, bottom, sudden: cover.sudden, hidden: cover.hidden });
  }
  return areas;
}

function rect(x: number, y: number, w: number, h: number): BeMusicRect {
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}
