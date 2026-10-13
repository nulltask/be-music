/**
 * What a play's share card shows. The score page hands it to the client script as JSON; client/score-card.ts draws
 * the card from it. Kept free of DOM and Worker types, so both sides can import it.
 */
export interface ScoreCardData {
  genre: string | null;
  title: string;
  subtitle: string | null;
  artist: string | null;
  playerName: string;
  handle: string;
  avatarUrl: string;
  /** The ruleset the play was played under, e.g. "LR2". */
  rulesetLabel: string;
  lamp: { label: string; color: string };
  exScore: number;
  maxExScore: number;
  /** "77.88%" */
  rate: string;
  djRank: string;
  bp: number;
  maxCombo: number;
  judges: { pgreat: number; great: number; good: number; bad: number; poor: number };
  /** "GROOVE 100.0%" */
  gauge: string;
  /** Epoch ms. */
  playedAt: number;
}

/** The text of a share: chart, lamp, DJ Rank, EX-Score and rate, ruleset. */
export function shareText(
  data: Pick<ScoreCardData, 'title' | 'lamp' | 'djRank' | 'exScore' | 'maxExScore' | 'rate' | 'rulesetLabel'>,
): string {
  return `${data.title} — ${data.lamp.label} · ${data.djRank} · EX ${data.exScore}/${data.maxExScore} (${data.rate}) [${data.rulesetLabel}]`;
}

/** The share hashtag (docs/leaderboard.md). */
export const SHARE_HASHTAG = 'bemusic';

/** A post on X with the text, the page and the hashtag filled in. */
export function xIntentUrl(text: string, url: string): string {
  const params = new URLSearchParams({ text, url, hashtags: SHARE_HASHTAG });
  return `https://x.com/intent/post?${params.toString()}`;
}
