import type { BeMusicJson } from '@be-music/json';
import type { PlayerOptions } from '@be-music/player/core/engine';
import { chartPlayVariantForBeatorajaVariant, type BeatorajaPlayableVariant } from '../../skin/beatoraja/theme.ts';

/** Engine options a beatoraja gameplay host may supply (the view owns the runtime factories). */
export type BeatorajaEngineOptions = Omit<
  PlayerOptions,
  'createAudioSession' | 'createInputRuntime' | 'createUiRuntime' | 'auto'
>;

/** The `PixiBeatorajaGameplayViewOptions` fields the engine options are composed from. */
export interface BeatorajaEngineOptionsInput {
  variant?: BeatorajaPlayableVariant;
  chartPath?: string;
  dpFlip?: boolean;
  randomOutcomes?: ReadonlyArray<number>;
  sourceChart?: BeMusicJson;
  engineOptions?: BeatorajaEngineOptions;
}

/**
 * Compose the engine's `PlayerOptions` for the run, defaulting `laneModeExtension` from the
 * chart's filename when the host didn't already supply one. Without the extension hint the
 * engine's content-based `resolveLaneMode` heuristic only classifies as `9-key` when the chart
 * declares `#PLAYER 3` AND uses channel 17 — `#PLAYER 1` PMS / BME-Pop'n charts that omit
 * channel 17 fall through to `7-key-sp`, which clamps lane bindings to channels 11..15 + 16
 * (scratch) + 18/19, treats channel 17 as FREE ZONE, and silently drops channels 16's POPN
 * key behavior. The autoplay loop iterates `scorableNotes` (= playable notes minus active
 * free-zone channels) so notes on the misclassified lanes never fire `flash-lane`, and the
 * matching keybeam / bomb / judge timers never stamp.
 *
 * Mirrors {@link extractBeatorajaChartExtension} → {@link PlayerOptions.laneModeExtension}.
 * Host-set values win so explicit overrides keep working.
 *
 * Play-log recording: host-supplied `engineOptions.recordPlaylog` fields (gauge pick, chart hash, ...) are preserved;
 * the view adds what it owns: the DP-flip intent it applied to the chart, the values the chart's `#RANDOM` /
 * `#SWITCH` lines were resolved with (`play.randomOutcomes`, so a verifier can rebuild the played chart), the source
 * chart the fingerprints are computed from (the engine plays a resolved, possibly DP-flipped copy), and the chart path
 * in `native` so a dropped play-log can be matched back to its song.
 */
export function composeBeatorajaEngineOptions(options: BeatorajaEngineOptionsInput): BeatorajaEngineOptions {
  const supplied = options.engineOptions;
  const inferred = extractBeatorajaChartExtension(options.chartPath);
  // **`playVariant` direct override** (`engine.ts` `PlayerOptions.playVariant`).  The host
  // already classified the chart via `pickBeatorajaPlayableVariant` and passes the result
  // here as `options.variant` (= `chartVariant`).  Forwarding it as a direct lane-mode
  // override means the engine routes channels 16/17/18/19 through POPN-9 bindings even when
  // its content-based heuristic would have under-classified the chart as 7-key (e.g. `.bme`
  // with `#PLAYER 1`).  Host-provided `engineOptions.playVariant` wins so callers that
  // explicitly override the variant (rare) keep the same precedence model as
  // `laneModeExtension`.
  const result = { ...supplied };
  if (result.laneModeExtension === undefined && inferred !== undefined) {
    result.laneModeExtension = inferred;
  }
  if (result.playVariant === undefined && options.variant !== undefined) {
    result.playVariant = chartPlayVariantForBeatorajaVariant(options.variant);
  }
  result.recordPlaylog = {
    ...supplied?.recordPlaylog,
    ...(options.dpFlip !== undefined ? { dpFlip: options.dpFlip } : {}),
    ...(options.randomOutcomes !== undefined && options.randomOutcomes.length > 0
      ? { randomOutcomes: [...options.randomOutcomes] }
      : {}),
    ...(options.sourceChart !== undefined ? { sourceChart: options.sourceChart } : {}),
    ...(options.chartPath !== undefined
      ? { native: { ...supplied?.recordPlaylog?.native, chartPath: options.chartPath } }
      : {}),
  };
  return result;
}

/**
 * Returns the lowercased filename extension (with leading dot, e.g. `.pms` / `.bme` / `.bms`) of
 * `chartPath`, or `undefined` when the path doesn't include a recognizable suffix. Mirrors
 * the LR2 path's `extractChartExtension` (`scene/lr2/gameplay.ts:5602`) so both gameplay surfaces
 * derive `laneModeExtension` identically. Anchors the extension on the LAST PATH SEGMENT so
 * dotted directory names (e.g. `Bok.fps/01.bms`) don't get mistaken for the chart's own
 * extension.
 */
function extractBeatorajaChartExtension(chartPath: string | undefined): string | undefined {
  if (typeof chartPath !== 'string' || chartPath.length === 0) return undefined;
  const lastSlash = Math.max(chartPath.lastIndexOf('/'), chartPath.lastIndexOf('\\'));
  const lastDot = chartPath.lastIndexOf('.');
  if (lastDot < 0 || lastDot < lastSlash) return undefined;
  const ext = chartPath.slice(lastDot).toLowerCase();
  return ext.length > 1 ? ext : undefined;
}
