import { resolveAutoScratchChannels } from './auto-scratch.ts';
import type { PlayerHCNLaneState } from './ui-signal-bus.ts';
import { resolveRulesetLongNoteMode } from './judge-rules.ts';
import { formatSeconds, resolveAltModifierLabel } from '../utils.ts';
import {
  createJudgeCoreState,
  isJudgeCoreSettled,
  isJudgingClosed,
  resolveJudgeInputChannels,
  runJudgeCoreStep,
  type JudgeCoreEffectSink,
  type JudgeCoreInput,
  type JudgeCoreState,
} from './judge-core.ts';
import { resolveJudgeNowMsFromPressedAt } from './engine-clock.ts';
import { formatJudgeWindowSet, printLaneMap, writeRuntimeEventLog } from './engine-trace.ts';
import { createKeyStateInference } from './play-key-inference.ts';
import type { PlaySession } from './play-session.ts';
import type { JudgeStrategy, PlayJudge } from './play-strategy.ts';

/**
 * The manual judge strategy: the deterministic judge core (`judge-core.ts`) fed the play clock's time once per tick and
 * every key the player presses and releases, stamped with the instant it went down (`pressedAt`). An input runtime that
 * declares its releases (`PlayerInputRuntime.reportsKeyReleases`, a browser) is key-state input from its first key.
 * Otherwise, until the input reports a release (`kitty-state`), its presses go through a key-state inference
 * (`play-key-inference.ts`), which infers when each key came up.
 */

/**
 * The judge core of a manual play or a replay. `judgeMsPerChartSecond` is the millisecond domain the release margins
 * and the key-state inference's graces run in: live play runs them on the playback clock at the tempo it started at
 * (after a tempo change, on chart time at that tempo, `TempoClock.initialTempoMsAt`, so the domain stays linear in
 * chart time); a replay has no wall clock to honour, so it runs them on chart time and its judgments do not depend on
 * `speed`.
 */
export function createPlayJudgeCore(
  session: PlaySession,
  judgeMsPerChartSecond: number,
  practiceFromSeconds?: number,
): JudgeCoreState {
  const { playbackChart, resolvedJSON } = session;
  return createJudgeCoreState(
    {
      ruleset: session.ruleset,
      scorableNotes: playbackChart.scorableNotes,
      landmineNotes: playbackChart.landmineNotes,
      invisibleNotes: playbackChart.invisibleNotes,
      laneSoundNotes: playbackChart.laneSoundNotes,
      scratchChannels: new Set(
        playbackChart.laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel),
      ),
      autoScratch: session.autoScratch,
      autoScratchChannels: resolveAutoScratchChannels(
        session.options,
        playbackChart.laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel),
      ),
      judgeMsPerChartSecond,
      wavResources: session.wavResources,
      idBase: session.idBase,
      sourceFormat: resolvedJSON.sourceFormat,
      // LR2 negative-BPM reversal (#134): timing stays monotonic (the resolver integrates |BPM|), but from this chart
      // time on LR2's event pump freezes and presses are judged on the mirrored clock. The realtime audio streams are
      // already cut there (`collectRealtimeAudioTriggers` / `collectRealtimeAudioVolumeEvents`).
      reversalSeconds: session.resolvedChart.reversal?.seconds,
      endOnFailure: session.endOnFailure,
      ...(practiceFromSeconds !== undefined ? { practiceFromSeconds } : {}),
    },
    session.score,
  );
}

/** The parts of a {@link PlayJudge} every judge-core strategy shares. */
export function judgeCoreJudge(
  session: PlaySession,
  judgeCore: JudgeCoreState,
): Pick<PlayJudge, 'isSettled' | 'isClosed' | 'finish' | 'settledThroughSeconds'> {
  const empty: readonly PlayerHCNLaneState[] = [];
  session.readHCNLanes = (seconds) => {
    if (judgeCore.hcnPassing.size === 0 && judgeCore.pendingAutoScratchLongNotes.length === 0) return empty;
    const lanes: PlayerHCNLaneState[] = [];
    for (const [channel, first] of judgeCore.hcnPassing) {
      for (let passing: typeof first | undefined = first; passing !== undefined; passing = passing.next) {
        if (seconds < passing.note.seconds || seconds >= passing.endUs / 1e6) continue;
        lanes.push({
          channel,
          gaining: passing.tailGood || (judgeCore.laneHolds.get(channel)?.activeTokens.size ?? 0) > 0,
        });
        break;
      }
    }
    for (const { note, endSeconds } of judgeCore.pendingAutoScratchLongNotes) {
      if (
        seconds >= note.seconds &&
        seconds < endSeconds &&
        resolveRulesetLongNoteMode(session.ruleset.longNoteStyle, note) === 3
      ) {
        lanes.push({ channel: note.channel, gaining: true });
      }
    }
    return lanes;
  };
  return {
    isSettled: () => isJudgeCoreSettled(judgeCore),
    isClosed: () => isJudgingClosed(judgeCore),
    finish: () =>
      runJudgeCoreStep(judgeCore, { kind: 'finish', totalSeconds: session.totalSeconds }, session.applyJudgeEffect),
    settledThroughSeconds: () => judgeCore.advancedThroughSeconds,
  };
}

/** The no-TUI introduction of a manual play (and a replay). */
export function writeManualIntro(session: PlaySession): void {
  const { writeOutput, playbackChart, ruleset } = session;
  const highSpeedModifierLabel = resolveAltModifierLabel();
  writeOutput('Manual play start\n');
  writeOutput(`Lane mode: ${playbackChart.laneDisplayMode}\n`);
  if (session.randomPatternSummary) {
    writeOutput(`${session.randomPatternSummary}\n`);
  }
  if (session.autoScratch) {
    writeOutput('Mode: AUTO SCRATCH (16ch/26ch only)\n');
  }
  writeOutput(`Judgment window (${ruleset.id}): ${formatJudgeWindowSet(ruleset.windows.note)}\n`);
  writeOutput('Press Space to pause/resume.\n');
  writeOutput('Press Shift+R to restart.\n');
  writeOutput(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
  writeOutput(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
  writeOutput('Press Ctrl+C to quit.\n');
  writeOutput('Press Esc to stop and open result.\n');
  printLaneMap(writeOutput, playbackChart.laneBindings);
}

function createManualJudge(session: PlaySession): PlayJudge {
  const { tempoClock, uiEnabled, writeOutput, tracer, applyJudgeEffect } = session;
  const { inputTokenToChannels } = session.playbackChart;
  let judgeCore = createPlayJudgeCore(session, 1000 / tempoClock.initialTempo);
  let coreJudge = judgeCoreJudge(session, judgeCore);
  // Input that reports its key releases: declared by the input runtime before the play, or else detected from the first
  // `kitty-state` command. Until then when each key came up is inferred, and the inference watches the judge's effects.
  let inputReportsReleases = session.inputRuntime?.reportsKeyReleases === true;
  const inferringSink: JudgeCoreEffectSink = (effect) => {
    keyState.observe(effect);
    applyJudgeEffect(effect);
  };
  const step = (input: JudgeCoreInput): void => {
    runJudgeCoreStep(judgeCore, input, inputReportsReleases ? applyJudgeEffect : inferringSink);
  };
  const candidateChannelsBuffer = new Set<string>();
  const mapInputChannels = (tokens: readonly string[], additionalTokens?: readonly string[]): ReadonlySet<string> =>
    resolveJudgeInputChannels(
      judgeCore.config,
      inputTokenToChannels,
      candidateChannelsBuffer,
      tokens,
      additionalTokens,
    );
  const traceInput = (seconds: number, action: string, tokens: readonly string[]): void => {
    writeRuntimeEventLog(writeOutput, 'input', [
      ['time', formatSeconds(seconds)],
      ['action', action],
      ['tokens', tokens.join(',')],
    ]);
  };
  const createKeyState = () =>
    createKeyStateInference(
      judgeCore,
      step,
      uiEnabled ? undefined : (seconds, tokens) => traceInput(seconds, 'inferred-release', tokens),
    );
  let keyState = createKeyState();
  // The instant (playback-clock ms) the last press or release was stamped at. Each lane command is stamped as it is
  // drained: the playback clock read then, moved back by the age of its `pressedAt` on the wall clock. The playback
  // clock follows the audio clock, which moves a render quantum at a time (Web Audio's `currentTime`), while the wall
  // clock moves smoothly, so a command drained just after another can read older than it even though it happened later:
  // a short tap's release came out a few hundred µs before its press. Commands are drained in the order they happened,
  // so none is stamped before the one drained ahead of it.
  let lastStampMs = Number.NEGATIVE_INFINITY;
  const stampMs = (drainNowMs: number, pressedAt: number | undefined): number => {
    lastStampMs = Math.max(lastStampMs, resolveJudgeNowMsFromPressedAt(drainNowMs, pressedAt));
    return lastStampMs;
  };

  return {
    isSettled: () => coreJudge.isSettled(),
    isClosed: () => coreJudge.isClosed(),
    finish: () => coreJudge.finish(),
    settledThroughSeconds: () => coreJudge.settledThroughSeconds(),
    seek: (seconds) => {
      keyState.stop();
      judgeCore = createPlayJudgeCore(session, 1000 / tempoClock.initialTempo, seconds);
      coreJudge = judgeCoreJudge(session, judgeCore);
      keyState = createKeyState();
      lastStampMs = Number.NEGATIVE_INFINITY;
      return { judgments: [], heldLongNotes: [] };
    },
    judge: (tick) => {
      if (!inputReportsReleases) {
        keyState.releaseBefore(tick.nowSec);
      }
      step({ kind: 'advance', nowSec: tick.nowSec, nowMs: tempoClock.initialTempoMsAt(tick.nowMs) });
      // The presses drained since the last tick and this advance make one judging pass, as LR2's loop judges them.
      session.settleJudgeTiming();
    },
    judgedThroughSeconds: (tick) => tick.nowSec,
    handleLaneCommand: (command) => {
      const clock = session.clock;
      if (clock === undefined) {
        // Before the chart starts there is nothing to judge.
        return;
      }
      const commandSeconds = (): number => tempoClock.chartSecondsAt(clock.nowMs());
      if (command.kind === 'kitty-state') {
        if (!inputReportsReleases) {
          // The input reports its keys' state: its own releases take over from the inference.
          inputReportsReleases = true;
          keyState.stop();
        }
        if (!uiEnabled) {
          if (command.pressTokens.length > 0) traceInput(commandSeconds(), 'press', command.pressTokens);
          if (command.repeatTokens.length > 0) traceInput(commandSeconds(), 'repeat', command.repeatTokens);
          if (command.releaseTokens.length > 0) traceInput(commandSeconds(), 'release', command.releaseTokens);
        }
        step({ kind: 'hold', channels: mapInputChannels(command.pressTokens, command.repeatTokens) });
        const releasedChannels = mapInputChannels(command.releaseTokens);
        if (releasedChannels.size > 0) {
          const releaseNowMs = clock.nowMs();
          step({
            kind: 'release',
            channels: releasedChannels,
            tokens: command.releaseTokens,
            nowSec: tempoClock.chartSecondsAt(releaseNowMs),
            nowMs: tempoClock.initialTempoMsAt(releaseNowMs),
            // The replay records the release at the key event's own instant, like a press.
            recordSec: tempoClock.chartSecondsAt(stampMs(releaseNowMs, command.pressedAt)),
          });
        }
        return;
      }
      if (clock.isPaused()) {
        return;
      }
      // The runtime adapter (web / node) stamps the OS-level key event as `pressedAt`; moving the playback clock back by
      // the wall-clock delta judges the press at the player's true timing instead of the engine's drain time (see
      // `resolveJudgeNowMsFromPressedAt` for the bounds), and no earlier than the command drained before it.
      const pressedAtMs = stampMs(clock.nowMs(), command.pressedAt);
      const nowSec = tempoClock.chartSecondsAt(pressedAtMs);
      if (!uiEnabled) {
        traceInput(nowSec, 'lane-input', command.tokens);
      }
      // The volume changes due by the write head apply to the keysound the press plays.
      session.volumeChanges.triggerUntil(tempoClock.chartSecondsAt(clock.scheduledMs()));
      tracer.flushUntil(nowSec);
      const candidateChannels = mapInputChannels(command.tokens);
      if (candidateChannels.size === 0) {
        return;
      }
      const nowMs = tempoClock.initialTempoMsAt(pressedAtMs);
      if (!inputReportsReleases) {
        keyState.press(candidateChannels, command.tokens, nowSec, nowMs);
        return;
      }
      step({ kind: 'press', channels: candidateChannels, tokens: command.tokens, nowSec, nowMs });
    },
  };
}

/** Manual play: the player's keys, judged live. */
export const manualStrategy: JudgeStrategy = {
  mode: 'manual',
  estimatesActiveAudio: false,
  writeIntro: writeManualIntro,
  createJudge: createManualJudge,
};
