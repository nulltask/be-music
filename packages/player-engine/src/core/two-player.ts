import type { PreparedPlaybackChartData } from './bootstrap.ts';
import type { JudgeCoreScore } from './judge-core-types.ts';
import type { PlayerSummary } from './engine-types.ts';
import type { PlaySession } from './play-session.ts';
import type { JudgeStrategy, PlayJudge } from './play-strategy.ts';
import type { RulesetConfig } from '../ruleset/definitions.ts';
import type { PlayerHCNLaneState } from './ui-signal-bus.ts';

/**
 * Two players on one chart: LR2 BATTLE (`battle` 1) and That-Which-Must-Not-Be-Named two-player play. Each side of
 * the duplicated chart is its own player, with its own judgments, combo, score and gauge; the chart, its clock and its
 * audio are shared. Each side is judged by the play's own strategy on a view of the session that sees only that side.
 */

/** The second player of a two-player play: its ruleset (its gauge and its notes' TOTAL), score and summary. */
export interface SecondPlayer {
  readonly ruleset: RulesetConfig;
  readonly score: JudgeCoreScore;
  readonly summary: PlayerSummary;
  readonly endOnFailure: boolean;
  readonly resetScore: () => void;
}

/** A side owns its lane channels (`1x` / `2x`), including its mines and invisible objects. */
export function isSideChannel(channel: string, side: 1 | 2): boolean {
  return channel.startsWith(String(side));
}

/**
 * The view of the prepared chart a side's judge reads: that side's notes, lanes and key bindings. The note objects are
 * the shared ones, so the judged marks reach the renderer.
 */
export function selectPlaybackChartSide(chart: PreparedPlaybackChartData, side: 1 | 2): PreparedPlaybackChartData {
  const own = (channel: string): boolean => isSideChannel(channel, side);
  const inputTokenToChannels = new Map<string, string[]>();
  for (const [token, channels] of chart.inputTokenToChannels) {
    const owned = channels.filter(own);
    if (owned.length > 0) inputTokenToChannels.set(token, owned);
  }
  return {
    ...chart,
    notes: chart.notes.filter((note) => own(note.channel)),
    scorableNotes: chart.scorableNotes.filter((note) => own(note.channel)),
    landmineNotes: chart.landmineNotes.filter((note) => own(note.channel)),
    invisibleNotes: chart.invisibleNotes.filter((note) => own(note.channel)),
    laneSoundNotes: chart.laneSoundNotes.filter((note) => own(note.channel)),
    laneBindings: chart.laneBindings.filter((binding) => own(binding.channel)),
    inputTokenToChannels,
  };
}

/** The session a side's judge sees: the shared session (its clock and buses read live) with the side's own parts. */
function sideSession(
  session: PlaySession,
  side: 1 | 2,
  parts: Pick<PlaySession, 'ruleset' | 'score' | 'summary' | 'endOnFailure'>,
): PlaySession {
  const view = Object.create(session) as PlaySession;
  const own = (channel: string): boolean => isSideChannel(channel, side);
  const replayInputs = session.options.replayInputs
    ?.map((event) => ({ ...event, channels: event.channels.filter(own) }))
    .filter((event) => event.channels.length > 0);
  Object.defineProperties(view, {
    playbackChart: { value: selectPlaybackChartSide(session.playbackChart, side) },
    ruleset: { value: parts.ruleset },
    score: { value: parts.score },
    summary: { value: parts.summary },
    endOnFailure: { value: parts.endOnFailure },
    options: { value: replayInputs === undefined ? session.options : { ...session.options, replayInputs } },
    readHCNLanes: { value: undefined, writable: true },
  });
  return view;
}

/**
 * One judge for both players: each side's judge from `strategy`, ticked, sought and finished together. The play ends
 * when both sides are settled, or when judging closed for both (LR2 stops once both players have failed).
 */
export function createTwoPlayerJudge(strategy: JudgeStrategy, session: PlaySession, second: SecondPlayer): PlayJudge {
  const views = [sideSession(session, 1, session), sideSession(session, 2, second)] as const;
  const judges = views.map((view) => strategy.createJudge(view));
  const empty: readonly PlayerHCNLaneState[] = [];
  session.readHCNLanes = (seconds) => {
    const lanes = views.flatMap((view) => view.readHCNLanes?.(seconds) ?? empty);
    return lanes.length === 0 ? empty : lanes;
  };
  const each = (run: (judge: PlayJudge) => void): void => judges.forEach(run);
  return {
    beforeAudio: (tick) => each((judge) => judge.beforeAudio?.(tick)),
    judge: (tick) => each((judge) => judge.judge(tick)),
    ...(judges.every((judge) => judge.seek !== undefined)
      ? {
          seek: (seconds: number) => {
            const rebuilt = judges.map((judge) => judge.seek!(seconds));
            return {
              bmsonBGAInputs: rebuilt
                .flatMap((part) => part.bmsonBGAInputs ?? [])
                .sort((a, b) => a.seconds - b.seconds),
              chartTextInputs: rebuilt
                .flatMap((part) => part.chartTextInputs ?? [])
                .sort((a, b) => a.seconds - b.seconds),
              judgments: rebuilt.flatMap((part) => part.judgments).sort((a, b) => a.seconds - b.seconds),
              heldLongNotes: rebuilt.flatMap((part) => part.heldLongNotes),
            };
          },
        }
      : {}),
    ...(judges.some((judge) => judge.handleLaneCommand !== undefined)
      ? { handleLaneCommand: (command) => each((judge) => judge.handleLaneCommand?.(command)) }
      : {}),
    judgedThroughSeconds: (tick) => Math.min(...judges.map((judge) => judge.judgedThroughSeconds(tick))),
    isSettled: () => judges.every((judge) => judge.isSettled() || judge.isClosed()),
    isClosed: () => judges.every((judge) => judge.isClosed()),
    beforeFinish: () => each((judge) => judge.beforeFinish?.()),
    finish: () => each((judge) => judge.finish()),
    settledThroughSeconds: () => Math.max(...judges.map((judge) => judge.settledThroughSeconds())),
  };
}
