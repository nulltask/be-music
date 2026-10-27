import type { ScoreCardData } from './score-card-data.ts';

/** One stage on a course run's card: its chart, and how the run went on it. */
export interface CourseCardStage {
  title: string;
  /** The stage's EX-Score rate ("92.31%"); null when the run never reached it, or kept no per-stage figures. */
  rate: string | null;
  /** `cleared` / `failed` by the stage's own gauge; `played` when the run kept no per-stage figures. */
  state: 'cleared' | 'failed' | 'played' | 'unreached';
}

/**
 * What a course run's share card shows. The course run page hands it to the client script as JSON (built by
 * course-run-card.ts); client/course-card.ts draws the card from it. Kept free of DOM and Worker types and of the
 * engine, so both sides can import it. The result, the play's pills, the counts and the footer are a play's
 * card's; the heading names the course, and the panel on the right lists its stages.
 */
export interface CourseCardData extends Omit<ScoreCardData, 'genre' | 'title' | 'subtitle' | 'artist' | 'excerpt'> {
  /** "GRADE COURSE", "EXPERT COURSE" or "NONSTOP COURSE". */
  kindLabel: string;
  courseName: string;
  /** The best trophy the run earned, by name. */
  trophy: string | null;
  stagesPlayed: number;
  stages: CourseCardStage[];
}

/** What a course run's card says the course is: the kind, in the card's capitals. */
export function courseKindLabel(kind: string): string {
  return `${kind.toUpperCase()} COURSE`;
}

/** The line under the course's name: how many stages the run reached, and its trophy. */
export function courseCardByline(data: Pick<CourseCardData, 'stagesPlayed' | 'stages' | 'trophy'>): string {
  const reached = `${data.stagesPlayed} / ${data.stages.length} stages`;
  return data.trophy !== null && data.trophy.length > 0 ? `${reached}  ·  ${data.trophy}` : reached;
}

/** The text of a share: course, lamp, trophy, DJ Rank, EX-Score and rate, ruleset. */
export function courseShareText(
  data: Pick<
    CourseCardData,
    'courseName' | 'lamp' | 'trophy' | 'djRank' | 'exScore' | 'maxExScore' | 'rate' | 'rulesetLabel'
  >,
): string {
  const trophy = data.trophy !== null && data.trophy.length > 0 ? ` · ${data.trophy}` : '';
  return `${data.courseName} — ${data.lamp.label}${trophy} · ${data.djRank} · EX ${data.exScore}/${data.maxExScore} (${data.rate}) [${data.rulesetLabel}]`;
}
