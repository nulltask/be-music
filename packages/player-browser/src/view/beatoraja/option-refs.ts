import type { BeMusicJSON } from '@be-music/chart-source';
import type { PlayOptions } from '@be-music/player-scene-model';
import {
  resolveBeatorajaOptionIndex,
  resolveBeatorajaPlayOptionIndex,
  type BeatorajaOptionIndexInput,
} from '@be-music/skin-beatoraja/scene';

/**
 * The long-note mode a chart names itself (`#LNMODE`, bmson `ln_type`), numbered from 1; `undefined` for a chart that
 * leaves it to the player's LN MODE.
 */
export function chartOwnLongNoteMode(json: BeMusicJSON): number | undefined {
  if (json.sourceFormat === 'bms') return json.bms.lnMode;
  const lnType = json.bmson.info.lnType;
  return lnType === undefined || lnType === 0 ? undefined : lnType;
}

/**
 * The image index of an option image on beatoraja's decide, play and result screens: the LNMODE image shows the
 * chart's own mode on the play and result screens (`chart`), else the player's LN MODE, and the option buttons' labels
 * read the play options. `undefined` for a ref that is no option image.
 */
export function resolveBeatorajaOptionRef(
  ref: number,
  input: { chart?: BeMusicJSON; playOptions?: Partial<PlayOptions> } & Omit<
    BeatorajaOptionIndexInput,
    'lnMode' | 'longNoteMode' | 'hsFix'
  >,
): number | undefined {
  const playOptions = input.playOptions ?? {};
  const lnMode = input.chart === undefined ? undefined : chartOwnLongNoteMode(input.chart);
  return (
    resolveBeatorajaOptionIndex(ref, {
      ...(lnMode !== undefined ? { lnMode } : {}),
      ...(playOptions.longNoteMode !== undefined ? { longNoteMode: playOptions.longNoteMode } : {}),
      ...(playOptions.hsFix !== undefined ? { hsFix: playOptions.hsFix } : {}),
      ...(input.lamp !== undefined ? { lamp: input.lamp } : {}),
      ...(input.lampOp !== undefined ? { lampOp: input.lampOp } : {}),
    }) ?? resolveBeatorajaPlayOptionIndex(ref, playOptions)
  );
}
