import { ClearLamp } from '../scoring/lamp.ts';

/** Display name and colour of each clear lamp, LR2 / beatoraja style. */
export const LAMP_STYLES: Readonly<Record<number, { label: string; color: string }>> = {
  [ClearLamp.FAILED]: { label: 'FAILED', color: '#7a1f2b' },
  [ClearLamp.ASSIST_EASY]: { label: 'ASSIST EASY', color: '#8a5cf6' },
  [ClearLamp.EASY]: { label: 'EASY CLEAR', color: '#3fb950' },
  [ClearLamp.NORMAL]: { label: 'CLEAR', color: '#3b82f6' },
  [ClearLamp.HARD]: { label: 'HARD CLEAR', color: '#e5e7eb' },
  [ClearLamp.EX_HARD]: { label: 'EX HARD CLEAR', color: '#f5c518' },
  [ClearLamp.FULL_COMBO]: { label: 'FULL COMBO', color: '#22d3ee' },
  [ClearLamp.PERFECT]: { label: 'PERFECT', color: '#f472b6' },
  [ClearLamp.MAX]: { label: 'MAX', color: '#ffffff' },
};

export function lampStyle(lamp: number): { label: string; color: string } {
  return LAMP_STYLES[lamp] ?? { label: 'NO PLAY', color: '#6b7280' };
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
