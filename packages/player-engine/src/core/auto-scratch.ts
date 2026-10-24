/** Source AUTO SCRATCH switches, independently per play side. The older combined switch is a fallback only. */
export interface AutoScratchOptions {
  autoScratch?: boolean;
  autoScratch1P?: boolean;
  autoScratch2P?: boolean;
}

/** An explicit side switch takes precedence over the older combined setting for that side. */
export function resolveAutoScratchSides(options: Readonly<AutoScratchOptions>): {
  autoScratch1P: boolean;
  autoScratch2P: boolean;
} {
  return {
    autoScratch1P: options.autoScratch1P ?? options.autoScratch ?? false,
    autoScratch2P: options.autoScratch2P ?? options.autoScratch ?? false,
  };
}

/** Filters the chart's already-identified scratch channels to the sides actually assisted. */
export function resolveAutoScratchChannels(
  options: Readonly<AutoScratchOptions>,
  scratchChannels: Iterable<string>,
): ReadonlySet<string> {
  const sides = resolveAutoScratchSides(options);
  return new Set(
    [...scratchChannels].filter((channel) =>
      channel.startsWith('1') ? sides.autoScratch1P : channel.startsWith('2') && sides.autoScratch2P,
    ),
  );
}
