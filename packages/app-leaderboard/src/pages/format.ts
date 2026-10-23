import { clearLampRank, computeScoreRate, resolve____RankLabel } from '@be-music/player-engine/ruleset';
import { en, type Messages } from './i18n/en.ts';

/** Display name and colour of each clear lamp, LR2 / beatoraja style, by the rank the Leaderboard stores it as. */
export const LAMP_STYLES: Readonly<Record<number, { label: string; color: string; meaning: string }>> = {
  [clearLampRank('FAILED')]: { label: 'FAILED', color: '#7a1f2b', meaning: 'Did not clear.' },
  [clearLampRank('ASSIST_EASY')]: {
    label: 'ASSIST EASY',
    color: '#8a5cf6',
    meaning: 'Cleared on the ASSIST EASY gauge.',
  },
  [clearLampRank('EASY')]: { label: 'EASY CLEAR', color: '#3fb950', meaning: 'Cleared on the EASY gauge.' },
  [clearLampRank('NORMAL')]: {
    label: 'CLEAR',
    color: '#3b82f6',
    meaning: 'Cleared on the normal gauge (GROOVE / NORMAL).',
  },
  [clearLampRank('HARD')]: { label: 'HARD CLEAR', color: '#e5e7eb', meaning: 'Cleared on the HARD gauge.' },
  [clearLampRank('EX_HARD')]: {
    label: 'EX HARD CLEAR',
    color: '#f5c518',
    meaning: 'Cleared on the EX-HARD, DEATH or HAZARD gauge.',
  },
  [clearLampRank('FULL_COMBO')]: {
    label: 'FULL COMBO',
    color: '#22d3ee',
    meaning:
      'No BAD and no missed POOR (empty POORs do not count). The top lamp under LR2 and That-Which-Must-Not-Be-Named.',
  },
  [clearLampRank('PERFECT')]: {
    label: 'PERFECT',
    color: '#f472b6',
    meaning: 'A full combo without a GOOD (beatoraja).',
  },
  [clearLampRank('MAX')]: { label: 'MAX', color: '#ffffff', meaning: 'Every note a PGREAT (beatoraja).' },
};

export function lampStyle(lamp: number): { label: string; color: string; meaning: string } {
  return LAMP_STYLES[lamp] ?? { label: 'NO PLAY', color: '#6b7280', meaning: 'Not played.' };
}

export const RULESET_LABELS: Readonly<Record<string, string>> = { lr2: 'LR2', beatoraja: 'beatoraja', ____: '????' };

/**
 * A ruleset as the pages name it: "LR2 rules". The bare name reads like the software a play came from; a ruleset is
 * only how the Leaderboard scores the play.
 */
export function rulesetName(ruleset: string): string {
  return `${RULESET_LABELS[ruleset] ?? ruleset} rules`;
}

/** What a ruleset is, for tooltips next to ruleset names. */
export const RULESET_MEANING =
  'Every play is scored under each ruleset: the judgment windows, gauges and clear lamps of LR2, beatoraja or That-Which-Must-Not-Be-Named, applied by the be-music engine to the replay. It is how the score is counted, not the software the play came from.';

/** EX score rate in percent with two decimals (`ex / (notes × 2)`), or `-` without notes. */
export function formatScoreRate(exScore: number, noteCount: number): string {
  if (noteCount <= 0) return '-';
  return `${(computeScoreRate({ exScore, total: noteCount }) * 100).toFixed(2)}%`;
}

/** DJ LEVEL on the That-Which-Must-Not-Be-Named ninths (AAA from 8/9 of the maximum EX score down to F), or `-` without notes. */
export const djLevel = (exScore: number, noteCount: number): string => resolve____RankLabel(exScore, noteCount);

/** A length of time for totals: `3h 25m`, `25m 12s`, `48s`. */
export function formatPlayTime(ms: number, duration: Messages['duration'] = en.duration): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return duration.hoursMinutes(hours, minutes);
  if (minutes > 0) return duration.minutesSeconds(minutes, seconds % 60);
  return duration.seconds(seconds);
}

/** `2026-10-13 14:51` in UTC, so a cached page reads the same everywhere. */
export function formatTimestamp(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** A chart's display title, falling back to its fingerprint when the replay carried no title. */
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
 * The software that recorded a play, from its replay's `recorder`: `be-music-web 0.5.0 (build 6471cd16, engine 0.8.0,
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

/** `7keys` → `7 KEYS`, `popn-9k` → `POPN-9K`: a replay's lane mode as players name it. */
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

/**
 * How the chart's long notes are judged (`#LNMODE`, or the default LN when the chart names none): 1 LN, 2 CN (charge
 * note), 3 HCN (hell charge note), each with what it means. The mode applies only if the chart has long notes.
 */
export function formatLNMode(lnMode: number | null): string {
  return lnMode === 1
    ? 'LN — the start is judged; hold to the end'
    : lnMode === 2
      ? 'CN — the release is judged too'
      : lnMode === 3
        ? 'HCN — the release is judged, and holding gains or drains the gauge'
        : '-';
}

/** A 0–1 rate as `77.88%`, or `-`. */
export function formatPercent(rate: number | null): string {
  return rate === null ? '-' : `${(rate * 100).toFixed(2)}%`;
}

const DIFFICULTY_NAMES = ['BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'INSANE'];

/** `#DIFFICULTY` by name: 1 BEGINNER .. 5 INSANE, or undefined for anything else. */
export function difficultyName(difficulty: number | null): string | undefined {
  return difficulty === null ? undefined : DIFFICULTY_NAMES[difficulty - 1];
}

/**
 * A lane mode the short way players write it: `7 KEY SP` → `7K`, `14 KEY DP` → `14K`, `5 KEY DP` → `10K`,
 * `9 KEY (PMS-STD)` → `9K`, and the older `7keys` → `7K`. Undefined when there is none or it names no key count.
 */
export function shortLaneMode(laneMode: string | null): string | undefined {
  const keys = laneMode === null ? null : /^(\d+)\s*keys?(?:\s+(SP|DP))?/i.exec(laneMode);
  if (keys === null) return undefined;
  const count = Number(keys[1]);
  return `${keys[2]?.toUpperCase() === 'DP' && count === 5 ? 10 : count}K`;
}

/** A chart's mode and level in one short label: `7K ☆12`, `14K`, `☆★5`; undefined when neither is known. */
export function formatChartLevel(laneMode: string | null, playLevel: string | null): string | undefined {
  const parts = [shortLaneMode(laneMode), playLevel !== null && playLevel !== '' ? `☆${playLevel}` : undefined];
  const label = parts.filter((part) => part !== undefined).join(' ');
  return label === '' ? undefined : label;
}

/** A signed difference for a change against an earlier best: `+23`, `−5` (a minus sign, not a hyphen), `±0`. */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : '±0';
}

/** Whether a play's gauge is worth showing next to its lamp: only when it did not clear, where it tells how close. */
export function showsGauge(clearLamp: number): boolean {
  return clearLamp <= clearLampRank('FAILED');
}

/** What a verification layer means (docs/leaderboard.md section 5.3), for its tooltip and the info panel. */
export function verificationMeaning(verification: string): string {
  return verification === 'L4'
    ? 'L4 — the chart played is known to be this one'
    : verification === 'L3'
      ? 'L3 — the chart played matches its fingerprint'
      : verification;
}
