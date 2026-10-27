export interface ConstantVisibility {
  readonly enabled: boolean;
  readonly durationMs: number;
  readonly fadeMs: number;
}

/**
 * beatoraja 0.8.9 PlayConfig bounds. LaneRenderer draws CONSTANT off in its practice configurator preview and in a
 * course with the `NO_SPEED` constraint (`noSpeed`), which turns it off for every stage.
 */
export function resolveConstantVisibility(
  input: Partial<ConstantVisibility> & { practicePreview?: boolean; noSpeed?: boolean } = {},
): ConstantVisibility {
  return {
    enabled: input.enabled === true && input.practicePreview !== true && input.noSpeed !== true,
    durationMs:
      typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
        ? Math.max(1, Math.min(10000, Math.round(input.durationMs)))
        : 500,
    fadeMs:
      typeof input.fadeMs === 'number' && Number.isFinite(input.fadeMs)
        ? Math.max(-1000, Math.min(1000, Math.round(input.fadeMs)))
        : 100,
  };
}

/** Source LaneRenderer's per-timeline visibility. A positive fade extends before the horizon; a negative one fades after it. */
export function resolveConstantAlpha(
  eventSeconds: number,
  displaySeconds: number,
  options: Readonly<ConstantVisibility>,
): number {
  if (!options.enabled) return 1;
  if (!Number.isFinite(eventSeconds) || !Number.isFinite(displaySeconds)) return 0;
  const deltaMs = (eventSeconds - displaySeconds) * 1000;
  if (options.fadeMs === 0) return deltaMs < options.durationMs ? 1 : 0;
  if (options.fadeMs > 0) return Math.max(0, Math.min(1, 1 - (deltaMs - options.durationMs) / options.fadeMs));
  return deltaMs >= options.durationMs ? 0 : Math.min(1, (options.durationMs - deltaMs) / -options.fadeMs);
}
