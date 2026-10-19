/** @jsxImportSource hono/jsx */
/** The Help page's text, one version per page language. */
import type { Child } from 'hono/jsx';
import { Lamp } from './components/basics.tsx';
import { PROSE_LINK, ProseSection } from './components/prose.tsx';
import { LAMP_STYLES, RULESET_LABELS } from './format.ts';
import { HELP_SECTIONS, type HelpId } from './help-topics.ts';
import type { Locale, Messages } from './i18n/index.ts';

export interface HelpContent {
  title: string;
  description: string;
  lead: Child;
  contents: string;
  /** Each section's title, in the order of `HELP_SECTIONS`. */
  sections: Readonly<Record<HelpId, string>>;
  body: (t: Messages) => Child;
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

/** Every clear lamp with its meaning, lowest first. */
function LampTerms(props: { t: Messages }) {
  return (
    <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
      {Object.keys(LAMP_STYLES).map((lamp) => (
        <>
          <dt>
            <Lamp lamp={Number(lamp)} />
          </dt>
          <dd>{props.t.lampMeanings[Number(lamp)]}</dd>
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

function DjLevels(props: { below: string }) {
  return (
    <div class="flex flex-wrap gap-x-4 gap-y-1">
      {DJ_LEVELS.map(([label, ninths]) => (
        <span>
          <span class="text-foreground font-medium">{label}</span> {((ninths / 9) * 100).toFixed(2)}%+
        </span>
      ))}
      <span>
        <span class="text-foreground font-medium">F</span> {props.below}
      </span>
    </div>
  );
}

/** The long-note modes as name / meaning rows, from the catalog's "LN — meaning" lines. */
function lnModeRows(t: Messages): Array<[Child, Child]> {
  return ([1, 2, 3] as const).map((mode) => {
    const [name, meaning] = t.lnModes[mode].split(' — ');
    return [
      name,
      meaning === undefined
        ? ''
        : `${meaning.charAt(0).toUpperCase()}${meaning.slice(1)}${t.locale === 'ja' ? '。' : '.'}`,
    ];
  });
}

const en: HelpContent = {
  title: 'Help',
  description: 'What the figures and marks on the be-music Leaderboard mean.',
  // One span: the header's line is a flex row, which would set the full stop apart from the link.
  lead: (
    <span>
      What the figures and marks on these pages mean. For how plays are counted, see{' '}
      <a class={PROSE_LINK} href="/about">
        About
      </a>
      .
    </span>
  ),
  contents: 'Contents',
  sections: Object.fromEntries(HELP_SECTIONS.map((section) => [section.id, section.title])) as Record<HelpId, string>,
  body: (t) => (
    <>
      <Section id="rows" t={t}>
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
      <Section id="lamps" t={t}>
        <p>The best a play reached, lowest first. Each ruleset tops out at its own lamp.</p>
        <LampTerms t={t} />
      </Section>
      <Section id="scores" t={t}>
        <p>
          <strong>EX-Score</strong> is 2 for each PGREAT and 1 for each GREAT, so the maximum is twice the note count.
          The <strong>rate</strong> is the EX-Score over that maximum. Rankings order by EX-Score; ties share a rank.
        </p>
        <p>
          The <strong>DJ LEVEL</strong> marks the rate in ninths:
        </p>
        <DjLevels below="below" />
      </Section>
      <Section id="judgments" t={t}>
        <Terms
          rows={[
            ['PG · GR · GD', 'PGREAT, GREAT and GOOD: hits, best first. They keep the combo.'],
            ['BD · PR', 'BAD and POOR (a missed note). They break the combo.'],
            ['EPR', 'Empty POOR: a press with no note to hit.'],
            ['BP', 'Misses: BAD + POOR + empty POOR, as LR2 and beatoraja count them. Lower is better.'],
          ]}
        />
      </Section>
      <Section id="rules" t={t}>
        <p>
          Every play is scored under all three rulesets, each with its own judge windows, gauges and lamps. Pick the one
          the pages show from the menu in the header; it is kept for your next visit.
        </p>
        <Terms
          rows={[
            [t.rules.name(RULESET_LABELS.lr2!), 'LR2’s judge windows, gauges and lamps; FULL COMBO is the top lamp.'],
            [
              t.rules.name(RULESET_LABELS.beatoraja!),
              'beatoraja’s, with PERFECT (no GOOD) and MAX (all PGREAT) above FULL COMBO.',
            ],
            [t.rules.name(RULESET_LABELS.iidx!), 'beatmania IIDX’s, with charge notes; FULL COMBO is the top lamp.'],
            [t.score.selected, 'On a play’s page: the ruleset the pages show.'],
            [t.score.playedWith, 'The ruleset the player played under.'],
          ]}
        />
      </Section>
      <Section id="gauges" t={t}>
        <p>
          The gauge a play chose, named as each ruleset names it (GROOVE is beatoraja’s NORMAL; DEATH and HAZARD share a
          lamp with EX-HARD). A failed play shows how far its gauge got.
        </p>
      </Section>
      <Section id="long-notes" t={t}>
        <Terms rows={lnModeRows(t)} />
        <p>A chart sets its mode with #LNMODE; LN when it does not. It matters only on charts with long notes.</p>
      </Section>
      <Section id="filters" t={t}>
        <Terms
          rows={[
            [
              t.filters.everyPlay,
              'Each play on its own row, so a player can appear more than once. Off: each player’s best.',
            ],
            [
              t.filters.assisted,
              'Plays with an assist (auto scratch, a widened judge window), ranked apart from the rest.',
            ],
            [t.filters.anonymous, 'Players who have not created an account yet, shown when turned on.'],
            [t.filters.file, 'One chart can come in several files (re-saves, re-encodes); rank one file’s plays only.'],
          ]}
        />
      </Section>
      <Section id="verification" t={t}>
        <Terms
          rows={[
            ['L3', 'The chart in the play log matches its fingerprint.'],
            ['L4', 'The chart played is known to be this one: it has no #RANDOM, or this branch was seen before.'],
          ]}
        />
        <p>Every play is recounted from its inputs whatever its layer.</p>
      </Section>
      <Section id="visibility" t={t}>
        <p>
          A play by a player with an account on a listed chart is <strong>public</strong>: it is in the rankings, Latest
          and its player’s page. A play that is not shows to its own player marked{' '}
          <strong>{t.visibility.notPublic}</strong> or <strong>{t.visibility.hidden}</strong>, with the reason under its
          “?”.
        </p>
        <Terms
          rows={[
            [
              'Chart not listed yet',
              'A new chart is listed once two players with an account have played it. Until then its plays reach the lists and rankings only for their own player, and search engines skip them.',
            ],
            [
              'Anonymous',
              'Plays made before creating an account show in the rankings and Latest only with “Anonymous players” on. Create an account and they become public.',
            ],
            [
              'Hidden',
              'A play its player hid: kept, but out of the rankings, the personal bests, the figures and every list, and only its player can open it. They can show it again from its page.',
            ],
            [t.filters.assisted, 'Plays with an assist are public, but ranked apart from the rest.'],
          ]}
        />
      </Section>
    </>
  ),
};

const ja: HelpContent = {
  title: 'ヘルプ',
  description: 'be-music Leaderboard の数字や記号の意味。',
  lead: (
    <span>
      このサイトの数字や記号の意味です。プレイの採点方法は
      <a class={PROSE_LINK} href="/about">
        このサイトについて
      </a>
      をご覧ください。
    </span>
  ),
  contents: '目次',
  sections: {
    rows: 'プレイの見方',
    lamps: 'クリアランプ',
    scores: 'EX スコア・レート・DJ LEVEL',
    judgments: '判定と BP',
    rules: '採点ルール',
    gauges: 'ゲージ',
    'long-notes': 'ロングノーツ',
    filters: 'ランキングの切り替え',
    verification: '検証',
    visibility: 'プレイの公開範囲',
  },
  body: (t) => (
    <>
      <Section id="rows" t={t}>
        <p>リストのプレイは、どれも同じように読めます。</p>
        <Terms
          rows={[
            ['色のバー', 'プレイのクリアランプ（下記）。'],
            [<>7K ☆12</>, '譜面のキーモードとレベル（#PLAYLEVEL）。ホバーで難易度名を表示。'],
            ['EASY CLEAR → CLEAR', 'それまでの自己ベストから更新したランプ。'],
            ['BP 21 −5', 'ミス数と、それまでの自己ベストから減った数。'],
            [
              'RANDOM',
              'プレイで使ったレーンオプション（OFF は表示しません）。MIRROR / RANDOM はダブルプレイの左右両方、FLIP は左右の入れ替え。',
            ],
            ['#3 / 12', 'その譜面のプレイヤーの中での EX スコアの順位。'],
            [t.rules.playedWith(t.rules.name('LR2')), 'プレイヤーが遊んだルール（判定幅とゲージ）。'],
            [<>+23 81</>, 'EX スコアと、それまでの自己ベストからの伸び。'],
            ['AA 64.48%', 'DJ LEVEL とスコアレート。'],
            ['ⓘ', 'プレイの詳細: ゲージ、レーンオプション、アシスト、長さ、検証、送信したアプリ。'],
          ]}
        />
      </Section>
      <Section id="lamps" t={t}>
        <p>プレイが到達した最高のランプを、低い順に並べています。ルールごとに最上位のランプが異なります。</p>
        <LampTerms t={t} />
      </Section>
      <Section id="scores" t={t}>
        <p>
          <strong>EX スコア</strong>は PGREAT 1 つにつき 2、GREAT 1 つにつき 1 で、最大はノーツ数の 2 倍です。
          <strong>レート</strong>は EX スコアをその最大で割ったもの。ランキングは EX スコア順で、同点は同順位です。
        </p>
        <p>
          <strong>DJ LEVEL</strong> はレートを 9 分の 1 刻みで表します。
        </p>
        <DjLevels below="未満" />
      </Section>
      <Section id="judgments" t={t}>
        <Terms
          rows={[
            ['PG · GR · GD', 'PGREAT・GREAT・GOOD: ヒット（良い順）。コンボが続きます。'],
            ['BD · PR', 'BAD と POOR（見逃し）。コンボが途切れます。'],
            ['EPR', '空 POOR: ノーツのない所での空打ち。'],
            ['BP', 'ミス数: BAD + POOR + 空 POOR（LR2 と beatoraja の数え方）。少ないほど良い。'],
          ]}
        />
      </Section>
      <Section id="rules" t={t}>
        <p>
          どのプレイも 3
          つのルールすべてで採点します。判定幅・ゲージ・ランプはルールごとに異なります。ページに表示するルールはヘッダーのメニューで選べ、次に来たときも引き継がれます。
        </p>
        <Terms
          rows={[
            [t.rules.name(RULESET_LABELS.lr2!), 'LR2 の判定幅・ゲージ・ランプ。最上位のランプは FULL COMBO。'],
            [
              t.rules.name(RULESET_LABELS.beatoraja!),
              'beatoraja のもの。FULL COMBO の上に PERFECT（GOOD なし）と MAX（すべて PGREAT）があります。',
            ],
            [
              t.rules.name(RULESET_LABELS.iidx!),
              'beatmania IIDX のもの（チャージノート付き）。最上位のランプは FULL COMBO。',
            ],
            [t.score.selected, 'プレイのページで、ページの表示に使っているルール。'],
            [t.score.playedWith, 'プレイヤーが遊んだルール。'],
          ]}
        />
      </Section>
      <Section id="gauges" t={t}>
        <p>
          プレイで選んだゲージを、ルールごとの呼び名で表示します（GROOVE は beatoraja の NORMAL。DEATH と HAZARD
          のランプは EX-HARD と同じです）。FAILED のプレイには、ゲージがどこまで残ったかを表示します。
        </p>
      </Section>
      <Section id="long-notes" t={t}>
        <Terms rows={lnModeRows(t)} />
        <p>譜面は #LNMODE でモードを指定します。指定がなければ LN です。ロングノーツのある譜面でのみ意味があります。</p>
      </Section>
      <Section id="filters" t={t}>
        <Terms
          rows={[
            [
              t.filters.everyPlay,
              'プレイを 1 行ずつ表示します。同じプレイヤーが複数回並ぶことがあります。オフでは各プレイヤーのベスト。',
            ],
            [
              t.filters.assisted,
              'アシスト（オートスクラッチ、判定幅の拡大）を使ったプレイ。ほかとは別にランキングします。',
            ],
            [t.filters.anonymous, 'アカウントを作っていないプレイヤー。オンにすると表示します。'],
            [
              t.filters.file,
              '1 つの譜面が複数のファイル（保存し直し、再エンコード）で配られることがあります。1 ファイルのプレイだけでランキングします。',
            ],
          ]}
        />
      </Section>
      <Section id="verification" t={t}>
        <Terms
          rows={[
            ['L3', 'プレイログの譜面が譜面 ID と一致する。'],
            ['L4', '遊んだ譜面がこの譜面だと確かめられる: #RANDOM がない、または既に確認済みの分岐。'],
          ]}
        />
        <p>どの段階でも、スコアは打鍵の記録から計算し直しています。</p>
      </Section>
      <Section id="visibility" t={t}>
        <p>
          アカウントを持つプレイヤーの、公開された譜面でのプレイは<strong>公開</strong>
          され、ランキング、最新のプレイ、プレイヤーのページに載ります。公開されていないプレイは本人にだけ
          <strong>{t.visibility.notPublic}</strong>または<strong>{t.visibility.hidden}</strong>
          の印つきで表示され、「?」から理由を確認できます。
        </p>
        <Terms
          rows={[
            [
              '譜面が公開前',
              '新しい譜面は、アカウントを持つプレイヤー 2 人が遊ぶと公開されます。それまでは、そのプレイはリストとランキングで本人にだけ表示され、検索エンジンにも載りません。',
            ],
            [
              '匿名',
              'アカウントを作る前のプレイは、「匿名プレイヤー」をオンにしたときだけランキングと最新のプレイに表示されます。アカウントを作ると、これまでのプレイも公開されます。',
            ],
            [
              '非表示',
              'プレイヤーが非表示にしたプレイ。プレイは保存されたまま、ランキング・自己ベスト・集計・すべてのリストから外れ、本人だけが見られます。プレイのページから表示に戻せます。',
            ],
            [t.filters.assisted, 'アシストを使ったプレイも公開されますが、ほかとは別にランキングします。'],
          ]}
        />
      </Section>
    </>
  ),
};

export const HELP: Readonly<Record<Locale, HelpContent>> = { en, ja };

/** A help section, titled in the page's language. */
function Section(props: { id: HelpId; t: Messages; children: Child }) {
  return (
    <ProseSection id={props.id} title={HELP[props.t.locale as Locale].sections[props.id]} loose>
      {props.children}
    </ProseSection>
  );
}
