import { ClearLamp } from '../scoring/lamp.ts';

/** Display name and colour of each clear lamp, LR2 / beatoraja style. */
export const LAMP_STYLES: Readonly<Record<number, { label: string; color: string; meaning: string }>> = {
  [ClearLamp.FAILED]: { label: 'FAILED', color: '#7a1f2b', meaning: 'Did not clear.' },
  [ClearLamp.ASSIST_EASY]: { label: 'ASSIST EASY', color: '#8a5cf6', meaning: 'Cleared on the ASSIST EASY gauge.' },
  [ClearLamp.EASY]: { label: 'EASY CLEAR', color: '#3fb950', meaning: 'Cleared on the EASY gauge.' },
  [ClearLamp.NORMAL]: { label: 'CLEAR', color: '#3b82f6', meaning: 'Cleared on the normal gauge (GROOVE / NORMAL).' },
  [ClearLamp.HARD]: { label: 'HARD CLEAR', color: '#e5e7eb', meaning: 'Cleared on the HARD gauge.' },
  [ClearLamp.EX_HARD]: {
    label: 'EX HARD CLEAR',
    color: '#f5c518',
    meaning: 'Cleared on the EX-HARD, DEATH or HAZARD gauge.',
  },
  [ClearLamp.FULL_COMBO]: {
    label: 'FULL COMBO',
    color: '#22d3ee',
    meaning: 'No BAD and no missed POOR (empty POORs do not count). The top lamp under LR2 and IIDX.',
  },
  [ClearLamp.PERFECT]: { label: 'PERFECT', color: '#f472b6', meaning: 'A full combo without a GOOD (beatoraja).' },
  [ClearLamp.MAX]: { label: 'MAX', color: '#ffffff', meaning: 'Every note a PGREAT (beatoraja).' },
};

export function lampStyle(lamp: number): { label: string; color: string; meaning: string } {
  return LAMP_STYLES[lamp] ?? { label: 'NO PLAY', color: '#6b7280', meaning: 'Not played.' };
}

export const RULESET_LABELS: Readonly<Record<string, string>> = { lr2: 'LR2', beatoraja: 'beatoraja', iidx: 'IIDX' };

/** EX score rate in percent with two decimals (`ex / (notes × 2)`), or `-` without notes. */
export function formatScoreRate(exScore: number, noteCount: number): string {
  if (noteCount <= 0) return '-';
  return `${((exScore / (noteCount * 2)) * 100).toFixed(2)}%`;
}

/** DJ LEVEL on the IIDX ninths (AAA from 8/9 of the maximum EX score down to F). */
export function djLevel(exScore: number, noteCount: number): string {
  if (noteCount <= 0) return '-';
  const ninths = Math.floor((exScore / (noteCount * 2)) * 9);
  return ['F', 'F', 'E', 'D', 'C', 'B', 'A', 'AA', 'AAA', 'AAA'][Math.max(0, Math.min(9, ninths))]!;
}

/** `2026-10-13 14:51` in UTC, so a cached page reads the same everywhere. */
export function formatTimestamp(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** A chart's display title, falling back to its fingerprint when the play log carried no title. */
export function chartTitle(title: string | null, chartFingerprint: string): string {
  return title !== null && title.trim().length > 0 ? title : `${chartFingerprint.slice(0, 18)}…`;
}

/**
 * The gauge at the end of a play: its type and percentage with one decimal (`GROOVE 82.4%`), or just the type for
 * plays stored before the final value was recorded.
 */
export function formatGauge(type: string, final: number | null): string {
  return final === null ? type : `${type} ${final.toFixed(1)}%`;
}

/**
 * The software that recorded a play, from its play log's `recorder`: `be-music-web 0.5.0 (build 6471cd16, engine 0.8.0,
 * web)`, or `unknown` for logs written before the field existed.
 */
export function formatRecorder(recorder: Record<string, string> | null): string {
  if (recorder === null) return 'unknown';
  const name = [recorder.name, recorder.version].filter((part) => part !== undefined && part !== '').join(' ');
  const extras = [
    recorder.build !== undefined ? `build ${recorder.build}` : undefined,
    recorder.engine !== undefined ? `engine ${recorder.engine}` : undefined,
    recorder.platform,
  ].filter((part): part is string => part !== undefined && part !== '');
  const head = name !== '' ? name : 'unknown app';
  return extras.length > 0 ? `${head} (${extras.join(', ')})` : head;
}

/** EX-Score with its maximum and rate: `81 / 104 (77.88%)` (the maximum is two per note). */
export function formatExScore(exScore: number, noteCount: number): string {
  if (noteCount <= 0) return String(exScore);
  return `${exScore} / ${noteCount * 2} (${formatScoreRate(exScore, noteCount)})`;
}

/** `7keys` → `7 KEYS`, `popn-9k` → `POPN-9K`: a play log's lane mode as players name it. */
export function formatLaneMode(laneMode: string | null): string {
  if (laneMode === null || laneMode.length === 0) return '-';
  const keys = /^(\d+)keys?$/i.exec(laneMode);
  return keys !== null ? `${keys[1]} KEYS` : laneMode.toUpperCase();
}

const RANK_NAMES = ['VERY HARD', 'HARD', 'NORMAL', 'EASY', 'VERY EASY'];

/**
 * The judge rank as the chart wrote it, then the window it gives: `#RANK 2 (NORMAL) · 75%`, `#DEFEXRANK 120 · 90%`,
 * or the percentage alone (bmson `judge_rank`, or no rank written).
 */
export function formatJudgeRank(
  judgeRank: { percent: number; sourceRank?: number; sourceExRank?: number } | null,
): string {
  if (judgeRank === null) return '-';
  const percent = `${Number(judgeRank.percent.toFixed(2))}%`;
  if (judgeRank.sourceExRank !== undefined) return `#DEFEXRANK ${judgeRank.sourceExRank} · ${percent}`;
  if (judgeRank.sourceRank !== undefined) {
    const name = RANK_NAMES[judgeRank.sourceRank];
    return `#RANK ${judgeRank.sourceRank}${name !== undefined ? ` (${name})` : ''} · ${percent}`;
  }
  return percent;
}

/** Long-note mode: 1 LN, 2 CN (charge note), 3 HCN (hell charge note). */
export function formatLnMode(lnMode: number | null): string {
  return lnMode === 1 ? 'LN' : lnMode === 2 ? 'CN' : lnMode === 3 ? 'HCN' : '-';
}

/** A 0–1 rate as `77.88%`, or `-`. */
export function formatPercent(rate: number | null): string {
  return rate === null ? '-' : `${(rate * 100).toFixed(2)}%`;
}
