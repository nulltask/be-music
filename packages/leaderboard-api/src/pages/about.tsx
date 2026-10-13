/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { Layout, PageHeader, SOURCE_URL } from './layout.tsx';
import { meta, PAGE_CACHE, type PageContext } from './page.tsx';

const LINK = 'text-foreground underline underline-offset-4 hover:text-primary';

/** One section of the page: a heading and its paragraphs or list. */
function Section(props: { id: string; title: string; children: Child }) {
  return (
    <section class="space-y-2" aria-labelledby={props.id}>
      <h2 id={props.id} class="text-base font-semibold tracking-tight">
        {props.title}
      </h2>
      <div class="text-muted-foreground max-w-prose space-y-2 text-sm leading-relaxed [&_li]:ms-5 [&_li]:list-disc [&_strong]:text-foreground [&_strong]:font-medium">
        {props.children}
      </div>
    </section>
  );
}

/** What the Leaderboard is and how it counts a play: scoring, charts, accounts, checks, and its beta state. */
export function aboutPage(c: PageContext<'/leaderboard/about'>) {
  c.header('cache-control', PAGE_CACHE);
  return c.html(
    <Layout
      meta={meta(c, 'About', 'What the be-music Leaderboard is and how it scores a play.', [
        { label: 'About', kind: 'about' },
      ])}
    >
      <PageHeader title="About" kind="about">
        Rankings for BMS charts played in be-music.
      </PageHeader>
      <div class="space-y-8">
        <Section id="scoring" title="How a play is scored">
          <p>
            When a play ends, the player sends its <strong>play log</strong>: the chart’s notes and every key press with
            its time. The server does not take the score the player saw; it replays the log on the be-music engine and
            counts the result itself.
          </p>
          <p>
            It does so three times, under the <strong>LR2</strong>, <strong>beatoraja</strong> and <strong>IIDX</strong>{' '}
            scoring rules: their judge windows, gauges and clear lamps. Every play is in all three rankings. The rules a
            play was <em>played with</em> are marked on it; the rules the pages show are yours to pick in the header.
            They are how a play is counted, not the software it came from.
          </p>
        </Section>
        <Section id="charts" title="Charts">
          <p>
            A chart is known by its <strong>fingerprint</strong>, taken from its notes and timing rather than its file,
            so a re-saved or re-encoded copy shares one ranking. Each chart file is also known by its SHA-256 and MD5,
            which link it to the LR2IR Archive, Mocha-Repository, MinIR and BMS Search, and let a ranking narrow to one
            file.
          </p>
          <p>
            A chart is <strong>listed</strong> once two players with a passkey have played it, which keeps a chart
            someone made up from passing as a real one.
          </p>
        </Section>
        <Section id="accounts" title="Accounts">
          <p>
            Playing needs no sign-up: your first submitted play makes an <strong>anonymous</strong> account in that
            browser. Rankings leave anonymous players out unless you ask for them.
          </p>
          <p>
            <strong>Create a passkey</strong> to keep the account: you can sign in with it on another device, and your
            plays join the rankings. Sign-in with Google and Discord is on the way.
          </p>
        </Section>
        <Section id="checks" title="What is checked">
          <ul class="space-y-1">
            <li>The score is always recounted from the inputs, never read from the log.</li>
            <li>Auto play and plays quit with ESC are refused; failed plays count.</li>
            <li>
              Plays with an assist (auto scratch, a widened judge window) are <strong>ranked apart</strong>.
            </li>
            <li>
              The chart in the log must match its fingerprint (<strong>L3</strong>), and the chart played must be known
              to be this one (<strong>L4</strong>): no <code>#RANDOM</code>, or a branch seen before.
            </li>
          </ul>
          <p>
            A fabricated stream of inputs cannot be told from a human one with certainty; such plays are left to reports
            and moderation.
          </p>
        </Section>
        <Section id="bests" title="Personal bests">
          <p>
            Your best EX-Score, best clear lamp and fewest misses (BP) on a chart are kept apart, each from the play
            that set it, so a best lamp from one play and a best score from another both count. Every play is kept.
          </p>
        </Section>
        <Section id="beta" title="Beta">
          <p>
            The fingerprint (<code>bmfp0</code>) and the scoring rules are still version 0. While they settle, rankings
            may be reset.
          </p>
          <p>
            be-music is open source:{' '}
            <a class={LINK} href={SOURCE_URL} rel="noopener noreferrer" target="_blank">
              nulltask/be-music on GitHub
            </a>
            . The{' '}
            <a class={LINK} href="/leaderboard/api">
              API
            </a>{' '}
            is open too.
          </p>
        </Section>
      </div>
    </Layout>,
  );
}
