/** @jsxImportSource hono/jsx */
import { CircleHelp, Code, FileMusic, Folder, History, Info, ListMusic, Settings, Trophy, User } from 'lucide-static';

/**
 * Icons that tell the Leaderboard's kinds of page apart: a chart, a chartset (the charts of one work), a course (charts
 * played in a row), a player, a score (a play or a course run), and the site's own pages. Each kind keeps one Lucide icon and one colour wherever it appears (page headings,
 * breadcrumbs, the header). The SVGs are inlined: no font to load, crisp at any size, coloured by the text colour.
 */
export type EntityKind =
  | 'chart'
  | 'chartset'
  | 'course'
  | 'player'
  | 'score'
  | 'latest'
  | 'settings'
  | 'api'
  | 'about'
  | 'help';

const ENTITIES: Readonly<Record<EntityKind, { svg: string; color: string; label: string }>> = {
  chart: { svg: FileMusic, color: 'text-sky-600 dark:text-sky-400', label: 'Chart' },
  chartset: { svg: Folder, color: 'text-amber-600 dark:text-amber-400', label: 'Chartset' },
  course: { svg: ListMusic, color: 'text-rose-600 dark:text-rose-400', label: 'Course' },
  player: { svg: User, color: 'text-violet-600 dark:text-violet-400', label: 'Player' },
  score: { svg: Trophy, color: 'text-emerald-600 dark:text-emerald-400', label: 'Score' },
  latest: { svg: History, color: 'text-muted-foreground', label: 'Latest' },
  settings: { svg: Settings, color: 'text-muted-foreground', label: 'Settings' },
  api: { svg: Code, color: 'text-muted-foreground', label: 'API' },
  about: { svg: Info, color: 'text-muted-foreground', label: 'About' },
  help: { svg: CircleHelp, color: 'text-muted-foreground', label: 'Help' },
};

/** The entity's name, for screen readers next to an icon that stands alone. */
export const entityLabel = (kind: EntityKind): string => ENTITIES[kind].label;

/** Size classes for the three places icons appear. */
const SIZES = { sm: '[&>svg]:size-3.5', md: '[&>svg]:size-4', lg: '[&>svg]:size-6' } as const;

/** An entity's icon in its colour. Decorative: the text next to it names the entity. */
export function EntityIcon(props: { kind: EntityKind; size?: keyof typeof SIZES; class?: string }) {
  const entity = ENTITIES[props.kind];
  return (
    <span
      class={`inline-flex shrink-0 ${SIZES[props.size ?? 'md']} ${entity.color} ${props.class ?? ''}`}
      aria-hidden="true"
      data-entity={props.kind}
      // Trusted markup from lucide-static, trimmed of its leading comment and whitespace.
      dangerouslySetInnerHTML={{ __html: entity.svg.trim() }}
    />
  );
}
