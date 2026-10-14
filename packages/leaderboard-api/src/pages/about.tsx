/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { Layout, PageHeader, SOURCE_URL } from './layout.tsx';
import { meta, PAGE_CACHE, type PageContext } from './page.tsx';

const LINK = 'text-foreground underline underline-offset-4 hover:text-primary';

/**
 * What the Leaderboard does that other Internet Rankings do not, for the top of the page: each with the section below
 * that tells it in full.
 */
const HIGHLIGHTS: ReadonlyArray<{ title: string; text: string; more: string }> = [
  {
    title: 'The server counts the score',
    text: 'The player sends the key presses, not a score. The server replays them on the be-music engine and counts the result itself, so an edited number never reaches a ranking.',
    more: 'scoring',
  },
  {
    title: 'One play, three sets of rules',
    text: 'Every play is scored under LR2, beatoraja and IIDX rules at once, so plays from any of them meet in one ranking, measured the same way.',
    more: 'scoring',
  },
  {
    title: 'Charts known by what they are',
    text: 'A chart is identified by its notes and timing, every #RANDOM branch included, not by its file: re-saved and re-encoded copies share one ranking.',
    more: 'charts',
  },
];

/** The rest of what it does differently, one line each under the highlights. */
const ALSO: ReadonlyArray<{ title: string; text: string; more: string }> = [
  {
    title: 'Checked charts',
    text: 'a made-up chart is not listed until two players with a passkey play it.',
    more: 'checks',
  },
  { title: 'Every play a replay', text: 'download any play log and watch it judged again.', more: 'replays' },
  { title: 'No sign-up to start', text: 'play anonymously; a passkey keeps the account.', more: 'accounts' },
  { title: 'Bests kept apart', text: 'best EX-Score, lamp and fewest misses, each from its own play.', more: 'bests' },
  {
    title: 'In the browser, in the open',
    text: 'play and send from the browser; the API and the source are open.',
    more: 'open',
  },
];

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
      <section aria-labelledby="different" class="space-y-3">
        <h2 id="different" class="text-base font-semibold tracking-tight">
          What sets it apart
        </h2>
        <ul class="grid gap-3 sm:grid-cols-3">
          {HIGHLIGHTS.map((item) => (
            <li class="card flex flex-col gap-2 px-4 py-4">
              <h3 class="text-sm font-semibold">{item.title}</h3>
              <p class="text-muted-foreground text-sm leading-relaxed">{item.text}</p>
              <a class="text-foreground mt-auto pt-1 text-xs underline underline-offset-4" href={`#${item.more}`}>
                More below
              </a>
            </li>
          ))}
        </ul>
        <ul class="text-muted-foreground grid gap-x-6 gap-y-1.5 pt-2 text-sm sm:grid-cols-2">
          {ALSO.map((item) => (
            <li>
              <a class="text-foreground underline-offset-4 hover:underline" href={`#${item.more}`}>
                {item.title}
              </a>{' '}
              — {item.text}
            </li>
          ))}
        </ul>
      </section>
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
        <Section id="replays" title="Replays">
          <p>
            Every play is kept with its <strong>play log</strong>, not just the best ones. Download it from the play’s
            page and drop it on the player to watch it again: it replays the same key presses on the same engine, so it
            is judged exactly as it was.
          </p>
          <p>
            Each play’s page also has a <strong>share card</strong>, an image of the result your browser draws for links
            on social sites.
          </p>
        </Section>
        <Section id="open" title="In the browser, in the open">
          <p>
            be-music runs in the browser: play a BMS folder you drop on it, and send the play from there. Nothing to
            install.
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
        <Section id="beta" title="Beta">
          <p>
            The fingerprint (<code>bmfp0</code>) and the scoring rules are still version 0. While they settle, rankings
            may be reset.
          </p>
        </Section>
      </div>
    </Layout>,
  );
}
