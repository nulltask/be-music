import { describe, expect, it } from 'vite-plus/test';
import * as display from './display.ts';
import * as engine from './index.ts';
import * as lanes from './lanes.ts';
import * as playlog from './playlog/index.ts';
import * as signals from './signals.ts';

/** The values an entry exports, sorted: the barrels are curated, so a new or dropped name shows up here. */
function exportedValues(entry: object): string[] {
  return Object.keys(entry).sort();
}

describe('designed entries', () => {
  it('@be-music/player exports the engine and nothing the other entries carry', () => {
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

  it('@be-music/player/playlog leaves the score vocabulary to @be-music/player/ruleset', () => {
    for (const name of ['computeScoreRate', 'resolveIidxRankLabel', 'IIDX_RANK_LABELS']) {
      expect(playlog).not.toHaveProperty(name);
    }
  });

  it('@be-music/player/signals exports the buses, the state signals and the high-speed controls', () => {
    expect(exportedValues(signals)).toEqual([
      'DEFAULT_HIGH_SPEED',
      'HIGH_SPEED_STEP',
      'MAX_HIGH_SPEED',
      'MIN_HIGH_SPEED',
      'applyHighSpeedControlAction',
      'createPlayerInputSignalBus',
      'createPlayerStateSignals',
      'createPlayerUiSignalBus',
      'resolveHighSpeedControlActionFromLaneChannels',
      'resolveHighSpeedMultiplier',
    ]);
  });

  it('@be-music/player/lanes exports the lane layout and the key bindings', () => {
    expect(exportedValues(lanes)).toEqual([
      'appendFreeZoneInputChannels',
      'createInputTokenToChannelsMap',
      'createLaneBindings',
      'isPlayableInputChannel',
      'isScratch',
      'resolveKeyChannel',
      'resolveLaneChannels',
      'resolveLaneDisplayMode',
      'resolveLaneOptionChannels',
      'resolveLr2LaneIndex',
      'resolvePlayVariantLaneChannels',
      'resolveSideKeySlot',
      'resolveSideRelativeLaneIndex',
      'resolveWheelLaneDirection',
    ]);
  });

  it('@be-music/player/display exports what a host shows, and no chart-layer names', () => {
    expect(exportedValues(display)).toEqual([
      'DEFAULT_IMAGE_RESIZE_ALGORITHM',
      'DEFAULT_POOR_BGA_DISPLAY_SECONDS',
      'DEFAULT_TUI_NOTE_HEIGHT',
      'IMAGE_RESIZE_ALGORITHMS',
      'MAX_TUI_NOTE_HEIGHT',
      'MIN_TUI_NOTE_HEIGHT',
      'ScrollDistanceMapper',
      'TUI_NOTE_HEIGHT_HALF',
      'createScrollDistanceMapper',
      'extractInvisiblePlayableNotes',
      'extractLandmineNotes',
      'extractPlayableNotes',
      'extractTimedNotes',
      'formatSeconds',
      'isImageResizeAlgorithm',
      'pickActiveBgaCue',
      'pickActiveBgaKey',
      'resolveAltModifierLabel',
      'resolveDisplayedDifficultyValue',
      'resolveDisplayedJudgeRankLabel',
      'resolveDisplayedJudgeRankValue',
      'resolveDisplayedPlayLevelValue',
      'toTimedInvisibleNote',
      'toTimedLandmineNote',
      'toTimedPlayableNote',
    ]);
  });
});
