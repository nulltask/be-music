import { describe, expect, it } from 'vite-plus/test';
import * as display from './display.ts';
import * as engine from './index.ts';
import * as lanes from './lanes.ts';
import * as replay from './replay/index.ts';
import * as signals from './signals.ts';

/** The values an entry exports, sorted: the barrels are curated, so a new or dropped name shows up here. */
function exportedValues(entry: object): string[] {
  return Object.keys(entry).sort();
}

describe('designed entries', () => {
  it('@be-music/player-engine exports the engine and nothing the other entries carry', () => {
    expect(exportedValues(engine)).toEqual([
      'PlayerInterruptedError',
      'autoPlay',
      'createTempoClock',
      'manualPlay',
      'preparePlaybackChart',
      'resolveChartRulesetFacts',
      'resolvePlayChart',
    ]);
  });

  it('@be-music/player-engine/replay leaves the score vocabulary to @be-music/player-engine/ruleset', () => {
    for (const name of ['computeScoreRate', 'resolve____RankLabel', '_____RANK_LABELS']) {
      expect(replay).not.toHaveProperty(name);
    }
  });

  it('@be-music/player-engine/signals exports the buses, the state signals and the high-speed controls', () => {
    expect(exportedValues(signals)).toEqual([
      'DEFAULT_HIGH_SPEED',
      'HIGH_SPEED_STEP',
      'MAX_HIGH_SPEED',
      'MIN_HIGH_SPEED',
      'applyHighSpeedControlAction',
      'createPlayerInputSignalBus',
      'createPlayerStateSignals',
      'createPlayerUISignalBus',
      'resolveHighSpeedControlActionFromLaneChannels',
      'resolveHighSpeedMultiplier',
    ]);
  });

  it('@be-music/player-engine/lanes exports the lane layout and the key bindings', () => {
    expect(exportedValues(lanes)).toEqual([
      'addLongNotes',
      'appendFreeZoneInputChannels',
      'applySevenToNine',
      'clampExtraNoteDepth',
      'clampHRandomThresholdBPM',
      'clampLongNoteRate',
      'clampScrollRate',
      'clampScrollSection',
      'createBeatorajaLaneRandom',
      'createInputTokenToChannelsMap',
      'createLaneBindings',
      'drawLaneRandomIndex',
      'isPlayableInputChannel',
      'isScratch',
      'parseLaneRandomSeed',
      'prepareMineModifier',
      'randomizeAllScratchNotes',
      'randomizeHRandomNotes',
      'randomizeLR2ConvergeNotes',
      'randomizeLR2ScatterNotes',
      'randomizePMSConvergeNotes',
      'randomizePMSPlayableLanes',
      'randomizePMSPlayableNotes',
      'randomizeSRandomNotes',
      'randomizeSpiralNotes',
      'resolveAutoScratchChannels',
      'resolveAutoScratchSides',
      'resolveEffectiveBattleMode',
      'resolveKeyChannel',
      'resolveLR2LaneIndex',
      'resolveLaneChannels',
      'resolveLaneDisplayMode',
      'resolveLaneOptionChannels',
      'resolvePlayVariantLaneChannels',
      'resolveSideKeySlot',
      'resolveSideRelativeLaneIndex',
      'resolveWheelLaneDirection',
    ]);
  });

  it('@be-music/player-engine/display exports what a host shows, and no chart-layer names', () => {
    expect(exportedValues(display)).toEqual([
      'BmsonBGAController',
      'DEFAULT_IMAGE_RESIZE_ALGORITHM',
      'DEFAULT_POOR_BGA_DISPLAY_SECONDS',
      'DEFAULT_TUI_NOTE_HEIGHT',
      'IMAGE_RESIZE_ALGORITHMS',
      'JUDGE_TIMING_AUTO_ADJUST_MODES',
      'KeyBoundBGAController',
      'MAX_TUI_NOTE_HEIGHT',
      'MIN_TUI_NOTE_HEIGHT',
      'ScrollDistanceMapper',
      'TUI_NOTE_HEIGHT_HALF',
      'adjustBeatorajaJudgeTiming',
      'createLR2ConstantScrollMapper',
      'createScrollDistanceMapper',
      'extractInvisiblePlayableNotes',
      'extractLandmineNotes',
      'extractPlayableNotes',
      'extractTimedNotes',
      'formatSeconds',
      'isImageResizeAlgorithm',
      'isLR2JudgeTimingAutoAdjust',
      'pickActiveBGACue',
      'pickActiveBGAKey',
      'resolveAltModifierLabel',
      'resolveDisplayedDifficultyValue',
      'resolveDisplayedJudgeRankLabel',
      'resolveDisplayedJudgeRankValue',
      'resolveDisplayedPlayLevelValue',
      'resolveJudgeTimingAutoAdjust',
      'toTimedInvisibleNote',
      'toTimedLandmineNote',
      'toTimedPlayableNote',
    ]);
  });
});
