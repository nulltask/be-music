/**
 * Barrel for the `@be-music/player-browser/audio` entry: how the player sounds outside the play loop. The audio service
 * (one system AudioContext for the BGM, cues, jingles, chart preview and skin sounds, and the per-play graphs; ADR 0007),
 * the audio bus with its compressor parameters, the master volume, the platform audio session, and the chart preview
 * engine the service drives.
 *
 * The lower-level runtime helpers (engine driver, web-audio session, web-input runtime, web-ui runtime, the play's
 * audio graph) stay internal: they back the audio service and the play session but aren't part of the public contract.
 */
export * from './audio-bus.ts';
export * from './audio-service.ts';
export * from './master-volume.ts';
// The platform audio session (`navigator.audioSession`) — distinct from the internal engine `WebAudioSession` noted above.
export * from './system-audio-session.ts';

// The chart preview the audio service plays on the select screen (`AudioService.preview`).
export {
  CHART_PREVIEW_STOP_FADE_OUT_SECONDS,
  ChartPreviewEngine,
  DEFAULT_CHART_PREVIEW_FALLBACK_DURATION_SECONDS,
  LR2_PREVIEW_FOCUS_DELAY_MS,
  type ChartPreviewEngineOptions,
  type ChartPreviewTarget,
} from '../chart/preview.ts';
