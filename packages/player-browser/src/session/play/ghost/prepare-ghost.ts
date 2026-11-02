/**
 * Readies a play's ghost while the play loads: reads the replay from the play's {@link GhostSource}, re-simulates it
 * into a timeline and builds the presentation the play's ghost mode names (`ghostMode`): a second playfield beside the
 * chart, when the play has room for one; a pacemaker; or a pacemaker with the recorded inputs over the live lanes. A
 * play that cannot show a ghost (a replay, a course stage, a NONSTOP run; for the second playfield, a chart with no free
 * side or a replay of another lane layout) goes on without it, as it does when the source has no replay or fails.
 */

import type { ChartPlayVariant } from '@be-music/chart-model';
import { logger } from '../../../logger.ts';
import type { PlaySessionOptions } from '../play-options.ts';
import type { GhostPresentation, GhostPresentationMode } from './ghost.ts';
import { resolveGhostSide } from './ghost-side.ts';
import { buildGhostTimeline, isSinglePlayReplay } from './ghost-timeline.ts';
import { LaneOverlayGhost } from './lane-overlay-ghost.ts';
import { DEFAULT_GHOST_LABEL, PacemakerGhost } from './pacemaker-ghost.ts';
import {
  buildGhostField,
  SidePlayfieldGhost,
  type GhostFieldChart,
  type SidePlayfieldGhostTarget,
} from './side-playfield-ghost.ts';

const log = logger('gameplay');

/** What readying a ghost reads and sets: the play session's members of these names. */
export interface GhostPlayContext extends SidePlayfieldGhostTarget, GhostFieldChart {
  readonly options: Pick<PlaySessionOptions, 'ghost' | 'ghostMode' | 'replay' | 'course' | 'nonstop'>;
  readonly laneChannels: readonly string[];
  readonly chartPlayVariant: ChartPlayVariant;
  readonly disposed: boolean;
  ghost: GhostPresentation | undefined;
}

/** The ghost mode the play asks for: the second playfield unless it names another. */
export function resolveGhostMode(options: Pick<PlaySessionOptions, 'ghostMode'>): GhostPresentationMode {
  return options.ghostMode ?? 'side-playfield';
}

/**
 * Whether the play could show a ghost at all, before its replay is read: never in a replay, a course stage or a NONSTOP
 * run; the second playfield only where the chart has a free side; a pacemaker on any chart.
 */
export function canShowGhost(ctx: Omit<GhostPlayContext, 'ghost'>): boolean {
  const { options } = ctx;
  if (options.ghost === undefined) return false;
  if (options.replay !== undefined || options.course !== undefined || options.nonstop !== undefined) return false;
  if (resolveGhostMode(options) !== 'side-playfield') return true;
  return resolveGhostSide(ctx.laneChannels, ctx.chartPlayVariant) !== undefined;
}

/** Reads, simulates and places the play's ghost (see the module comment). Never rejects. */
export async function prepareGhost(ctx: GhostPlayContext): Promise<void> {
  ctx.ghost = undefined;
  if (!canShowGhost(ctx)) return;
  const source = ctx.options.ghost!;
  try {
    const replay = await source.load();
    if (replay === undefined || ctx.disposed) return;
    const mode = resolveGhostMode(ctx.options);
    const label = source.label ?? DEFAULT_GHOST_LABEL;
    if (mode === 'pacemaker') {
      ctx.ghost = new PacemakerGhost(buildGhostTimeline(replay), label);
      return;
    }
    if (mode === 'lane-overlay') {
      ctx.ghost = new LaneOverlayGhost(buildGhostTimeline(replay), ctx.laneChannels, label);
      return;
    }
    const side = resolveGhostSide(ctx.laneChannels, ctx.chartPlayVariant);
    if (side === undefined || !isSinglePlayReplay(replay)) {
      log.info(`ghost (${source.kind}) left out: its replay does not fit beside this play`);
      return;
    }
    const timeline = buildGhostTimeline(replay);
    ctx.ghost = new SidePlayfieldGhost(timeline, side, buildGhostField(timeline, ctx), ctx);
  } catch (error) {
    log.warn(`ghost (${source.kind}) could not be read; playing without it`, error);
  }
}
