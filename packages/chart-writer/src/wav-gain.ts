import { collectBmsWAVCmdVolumeMultipliers } from '@be-music/chart-model';
import { cloneJSON, createEmptyJSON, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';

export function intrinsicWAVGains(json: BeMusicJSON): Array<[string, number]> {
  return Object.entries(json.resources.wavGain ?? {}).filter(([key, gain]) => {
    if (!Number.isFinite(gain) || gain < 0) throw new RangeError(`Invalid intrinsic WAV gain: ${key}`);
    return gain !== 1;
  });
}

/** Convert exactly representable slot gain into MacBeat percentage volume; never round audible gain. */
export function applyIntrinsicWAVGainForBMS(json: BeMusicJSON): BeMusicJSON {
  const gains = intrinsicWAVGains(json);
  if (!gains.length) return json;
  if (json.bms.controlFlow.length)
    throw new RangeError('Resolve BMS control flow before exporting intrinsic WAV gain.');
  const volumes = collectBmsWAVCmdVolumeMultipliers(json.bms.wavCmds, resolveBMSBase(json));
  const output = cloneJSON(json);
  for (const [key, gain] of gains) {
    if (!/^[0-9A-Za-z]{2}$/u.test(key))
      throw new RangeError('Intrinsic WAV gain slot cannot be represented by BMS; export Be-Music JSON.');
    const combined = (volumes.get(key) ?? 1) * gain;
    const percent = Math.round(combined * 100);
    if (!Number.isSafeInteger(percent) || percent / 100 !== combined) {
      throw new RangeError(
        'Intrinsic WAV gain cannot be represented exactly as BMS percentage volume; export Be-Music JSON.',
      );
    }
    output.bms.wavCmds.push(`01 ${key} ${percent}`);
  }
  delete output.resources.wavGain;
  // A new volume command must not be hidden by the preserved source, even when callers skip validation.
  output.preservation = createEmptyJSON(output.sourceFormat).preservation;
  return output;
}
