export type JudgeHudSide = '1P' | '2P';

export interface JudgeHudDisplay {
  judge: string;
  combo: number;
  x: number;
  maxWidth: number;
}

/**
 * Overlay combo / judge slots. Combo stays up while `runtime.combo > 0` even after `lastJudge` expires,
 * so a dense chart cannot hide the count by waiting out the popup window.
 */
export function resolveJudgeHudDisplays(
  runtime: {
    lastJudge?: string;
    combo?: number;
    judgeSides?: ReadonlyArray<{ side: JudgeHudSide; judge?: string; combo?: number }>;
  },
  playfield: {
    centerX: number;
    sideCenters: Partial<Record<JudgeHudSide, number>>;
  },
): JudgeHudDisplay[] {
  const isDoublePlay = playfield.sideCenters['2P'] !== undefined;
  const maxWidth = isDoublePlay ? 122 : 160;
  const liveSides = runtime.judgeSides?.filter((state) => typeof state.judge === 'string' && state.judge.length > 0);
  if (liveSides?.length) {
    return liveSides.map((state) => ({
      judge: state.judge!,
      combo: finiteCount(state.combo),
      x: playfield.sideCenters[state.side] ?? playfield.centerX,
      maxWidth,
    }));
  }
  const combo = finiteCount(runtime.combo);
  const judge = runtime.lastJudge ?? '';
  if (!judge && combo <= 0) return [];
  return [
    {
      judge,
      combo,
      x: playfield.sideCenters['1P'] ?? playfield.centerX,
      maxWidth,
    },
  ];
}

function finiteCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
