/** The Help page's sections, so other pages can point into them (`helpHref`) and the page can list them. */

/** Where each part of the help lives, for the contents and for links from other pages (`/leaderboard/help#lamps`). */
export const HELP_SECTIONS = [
  { id: 'rows', title: 'Reading a play' },
  { id: 'lamps', title: 'Clear lamps' },
  { id: 'scores', title: 'EX-Score, rate and DJ LEVEL' },
  { id: 'judgments', title: 'Judgments and BP' },
  { id: 'rules', title: 'Scoring rules' },
  { id: 'gauges', title: 'Gauges' },
  { id: 'long-notes', title: 'Long notes' },
  { id: 'filters', title: 'Ranking switches' },
  { id: 'verification', title: 'Verification' },
  { id: 'visibility', title: 'Who sees a play' },
] as const;

export type HelpId = (typeof HELP_SECTIONS)[number]['id'];

/** A link into the help, for the pages' own hints. */
export const helpHref = (id: HelpId): string => `/leaderboard/help#${id}`;
