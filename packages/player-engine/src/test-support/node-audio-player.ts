import {
  autoPlay as runAutoPlay,
  manualPlay as runManualPlay,
  type PlayerOptions,
  type PlayerSummary,
} from '../index.ts';
import type { BeMusicJSON } from '@be-music/chart-source';
import { createNodeAudioSession, loadNodeAudioSampleDurations } from '@be-music/player-node-audio';
export function autoPlay(json: BeMusicJSON, options: PlayerOptions = {}): Promise<PlayerSummary> {
  return runAutoPlay(json, {
    createAudioSession: createNodeAudioSession,
    loadAudioSampleDurations: loadNodeAudioSampleDurations,
    ...options,
  });
}
export function manualPlay(json: BeMusicJSON, options: PlayerOptions = {}): Promise<PlayerSummary> {
  return runManualPlay(json, {
    createAudioSession: createNodeAudioSession,
    loadAudioSampleDurations: loadNodeAudioSampleDurations,
    ...options,
  });
}
