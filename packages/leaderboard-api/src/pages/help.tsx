/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { Lamp } from './components/basics.tsx';
import { LAMP_STYLES, lampStyle, formatLnMode, RULESET_LABELS } from './format.ts';
import { Layout, PageHeader } from './layout.tsx';
import { meta, PAGE_CACHE, type PageContext } from './page.tsx';

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
] as const;

type HelpId = (typeof HELP_SECTIONS)[number]['id'];

/** A link into the help, for the pages' own hints. */
export const helpHref = (id: HelpId): string => `/leaderboard/help#${id}`;

function Section(props: { id: HelpId; children: Child }) {
  const title = HELP_SECTIONS.find((section) => section.id === props.id)!.title;
  return (
    <section class="scroll-mt-6 space-y-3" id={props.id} aria-labelledby={`${props.id}-title`}>
      <h2 id={`${props.id}-title`} class="text-base font-semibold tracking-tight">
        {title}
      </h2>
      <div class="text-muted-foreground max-w-prose space-y-2 text-sm leading-relaxed [&_strong]:text-foreground [&_strong]:font-medium">
        {props.children}
      </div>
    </section>
  );
}

/** Label / meaning rows. */
function Terms(props: { rows: Array<[Child, Child]> }) {
  return (
    <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
      {props.rows.map(([term, meaning]) => (
        <>
          <dt class="text-foreground">{term}</dt>
          <dd>{meaning}</dd>
        </>
      ))}
    </dl>
  );
}

/** The DJ LEVEL steps: ninths of the maximum EX-Score. */
const DJ_LEVELS: Array<[string, number]> = [
  ['AAA', 8],
  ['AA', 7],
  ['A', 6],
  ['B', 5],
  ['C', 4],
  ['D', 3],
  ['E', 2],
];

/** What the figures and marks on the pages mean: one place for the legend, the terms and the switches. */
export function helpPage(c: PageContext<'/leaderboard/help'>) {
  c.header('cache-control', PAGE_CACHE);
  return c.html(
    <Layout
      meta={meta(c, 'Help', 'What the figures and marks on the be-music Leaderboard mean.', [
        { label: 'Help', kind: 'help' },
      ])}
    >
      <PageHeader title="Help" kind="help">
        {/* One span: the header's line is a flex row, which would set the full stop apart from the link. */}
        <span>
          What the figures and marks on these pages mean. For how plays are counted, see{' '}
          <a class="text-foreground underline underline-offset-4" href="/leaderboard/about">
            About
          </a>
          .
        </span>
      </PageHeader>
      <nav aria-label="Contents" class="flex flex-wrap gap-2">
        {HELP_SECTIONS.map((section) => (
          <a class="btn" data-size="sm" data-variant="outline" href={`#${section.id}`}>
            {section.title}
          </a>
        ))}
      </nav>
      <div class="space-y-10">
        <Section id="rows">
          <p>Every play in a list reads the same way:</p>
          <Terms
            rows={[
              ['Colour bar', 'The play’s clear lamp (below).'],
              [<>7K ☆12</>, 'The chart’s key mode and level (#PLAYLEVEL); its difficulty name on hover.'],
              ['EASY CLEAR → CLEAR', 'A lamp the play raised over the player’s earlier best.'],
              ['BP 21 −5', 'Misses, and how many fewer than the player’s earlier best.'],
              [
                'RANDOM',
                'The lane option the play used; OFF is not shown. MIRROR / RANDOM gives both sides of a double play, FLIP a swap of the sides.',
              ],
              ['#3 / 12', 'Where the play’s EX-Score stands among the players on the chart.'],
              ['played with LR2 rules', 'The rules the player played under (their judge windows and gauge).'],
              [<>+23 81</>, 'The EX-Score, with how far it beat the player’s earlier best.'],
              ['AA 64.48%', 'The DJ LEVEL and the score rate.'],
              ['ⓘ', 'The play’s details: gauge, lane option, assists, length, verification and the app it came from.'],
            ]}
          />
        </Section>
        <Section id="lamps">
          <p>The best a play reached, lowest first. Each ruleset tops out at its own lamp.</p>
          <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
            {Object.keys(LAMP_STYLES).map((lamp) => (
              <>
                <dt>
                  <Lamp lamp={Number(lamp)} />
                </dt>
                <dd>{lampStyle(Number(lamp)).meaning}</dd>
              </>
            ))}
          </dl>
        </Section>
        <Section id="scores">
          <p>
            <strong>EX-Score</strong> is 2 for each PGREAT and 1 for each GREAT, so the maximum is twice the note count.
            The <strong>rate</strong> is the EX-Score over that maximum. Rankings order by EX-Score; ties share a rank.
          </p>
          <p>
            The <strong>DJ LEVEL</strong> marks the rate in ninths:
          </p>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            {DJ_LEVELS.map(([label, ninths]) => (
              <span>
                <span class="text-foreground font-medium">{label}</span> {((ninths / 9) * 100).toFixed(2)}%+
              </span>
            ))}
            <span>
              <span class="text-foreground font-medium">F</span> below
            </span>
          </div>
        </Section>
        <Section id="judgments">
          <Terms
            rows={[
              ['PG · GR · GD', 'PGREAT, GREAT and GOOD: hits, best first. They keep the combo.'],
              ['BD · PR', 'BAD and POOR (a missed note). They break the combo.'],
              ['EPR', 'Empty POOR: a press with no note to hit.'],
              ['BP', 'Misses: BAD + POOR + empty POOR, as LR2 and beatoraja count them. Lower is better.'],
            ]}
          />
        </Section>
        <Section id="rules">
          <p>
            Every play is scored under all three rulesets, each with its own judge windows, gauges and lamps. Pick the
            one the pages show from the menu in the header; it is kept for your next visit.
          </p>
          <Terms
            rows={[
              [`${RULESET_LABELS.lr2} rules`, 'LR2’s judge windows, gauges and lamps; FULL COMBO is the top lamp.'],
              [
                `${RULESET_LABELS.beatoraja} rules`,
                'beatoraja’s, with PERFECT (no GOOD) and MAX (all PGREAT) above FULL COMBO.',
              ],
              [`${RULESET_LABELS.iidx} rules`, 'beatmania IIDX’s, with charge notes; FULL COMBO is the top lamp.'],
              ['selected', 'On a play’s page: the ruleset the pages show.'],
              ['played with', 'The ruleset the player played under.'],
            ]}
          />
        </Section>
        <Section id="gauges">
          <p>
            The gauge a play chose, named as each ruleset names it (GROOVE is beatoraja’s NORMAL; DEATH and HAZARD share
            a lamp with EX-HARD). A failed play shows how far its gauge got.
          </p>
        </Section>
        <Section id="long-notes">
          <Terms
            rows={[1, 2, 3].map((mode) => {
              const [name, meaning] = formatLnMode(mode).split(' — ');
              return [name, `${meaning!.charAt(0).toUpperCase()}${meaning!.slice(1)}.`];
            })}
          />
          <p>A chart sets its mode with #LNMODE; LN when it does not. It matters only on charts with long notes.</p>
        </Section>
        <Section id="filters">
          <Terms
            rows={[
              [
                'Every play',
                'Each play on its own row, so a player can appear more than once. Off: each player’s best.',
              ],
              ['Assisted', 'Plays with an assist (auto scratch, a widened judge window), ranked apart from the rest.'],
              ['Anonymous players', 'Players who have not made a passkey yet, left out unless turned on.'],
              ['File', 'One chart can come in several files (re-saves, re-encodes); rank one file’s plays only.'],
            ]}
          />
        </Section>
        <Section id="verification">
          <Terms
            rows={[
              ['L3', 'The chart in the play log matches its fingerprint.'],
              ['L4', 'The chart played is known to be this one: it has no #RANDOM, or this branch was seen before.'],
            ]}
          />
          <p>Every play is recounted from its inputs whatever its layer.</p>
        </Section>
      </div>
    </Layout>,
  );
}
