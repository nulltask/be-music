/** @jsxImportSource hono/jsx */
/** The About page's text, one version per page language. */
import type { Child } from 'hono/jsx';
import { PROSE_LINK, ProseSection as Section } from './components/prose.tsx';
import type { Locale } from './i18n/index.ts';
import { SOURCE_URL } from './layout.tsx';

interface Point {
  title: string;
  text: string;
  /** The section below that tells it in full. */
  more: string;
}

export interface AboutContent {
  title: string;
  description: string;
  lead: string;
  apart: string;
  moreBelow: string;
  /** What the Leaderboard does that other Internet Rankings do not, for the top of the page. */
  highlights: ReadonlyArray<Point>;
  /** The rest of what it does differently, one line each under the highlights. */
  also: ReadonlyArray<Point>;
  /** The sections: scoring, charts, accounts, checks, bests, replays, the open parts and the beta state. */
  body: () => Child;
}

const en: AboutContent = {
  title: 'About',
  description: 'What the be-music Leaderboard is and how it scores a play.',
  lead: 'Rankings for BMS charts played in be-music.',
  apart: 'What sets it apart',
  moreBelow: 'More below',
  highlights: [
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
  ],
  also: [
    {
      title: 'Checked charts',
      text: 'a made-up chart is not listed until two players with a passkey play it.',
      more: 'checks',
    },
    { title: 'Every play a replay', text: 'download any play log and watch it judged again.', more: 'replays' },
    { title: 'No sign-up to start', text: 'play anonymously; a passkey keeps the account.', more: 'accounts' },
    {
      title: 'Bests kept apart',
      text: 'best EX-Score, lamp and fewest misses, each from its own play.',
      more: 'bests',
    },
    {
      title: 'In the browser, in the open',
      text: 'play and send from the browser; the API and the source are open.',
      more: 'open',
    },
  ],
  body: () => (
    <>
      <Section id="scoring" title="How a play is scored">
        <p>
          When a play ends, the player sends its <strong>play log</strong>: the chart’s notes and every key press with
          its time. The server does not take the score the player saw; it replays the log on the be-music engine and
          counts the result itself.
        </p>
        <p>
          It does so three times, under the <strong>LR2</strong>, <strong>beatoraja</strong> and <strong>IIDX</strong>{' '}
          scoring rules: their judge windows, gauges and clear lamps. Every play is in all three rankings. The rules a
          play was <em>played with</em> are marked on it; the rules the pages show are yours to pick in the header. They
          are how a play is counted, not the software it came from.
        </p>
      </Section>
      <Section id="charts" title="Charts">
        <p>
          A chart is known by its <strong>fingerprint</strong>, taken from its notes and timing rather than its file, so
          a re-saved or re-encoded copy shares one ranking. Each chart file is also known by its SHA-256 and MD5, which
          link it to the LR2IR Archive, Mocha-Repository, MinIR and BMS Search, and let a ranking narrow to one file.
        </p>
        <p>
          A chart is <strong>listed</strong> once two players with a passkey have played it, which keeps a chart someone
          made up from passing as a real one.
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
            The chart in the log must match its fingerprint (<strong>L3</strong>), and the chart played must be known to
            be this one (<strong>L4</strong>): no <code>#RANDOM</code>, or a branch seen before.
          </li>
        </ul>
        <p>
          A fabricated stream of inputs cannot be told from a human one with certainty; such plays are left to reports
          and moderation.
        </p>
      </Section>
      <Section id="bests" title="Personal bests">
        <p>
          Your best EX-Score, best clear lamp and fewest misses (BP) on a chart are kept apart, each from the play that
          set it, so a best lamp from one play and a best score from another both count. Every play is kept.
        </p>
      </Section>
      <Section id="replays" title="Replays">
        <p>
          Every play is kept with its <strong>play log</strong>, not just the best ones. Download it from the play’s
          page and drop it on the player to watch it again: it replays the same key presses on the same engine, so it is
          judged exactly as it was.
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
          <a class={PROSE_LINK} href={SOURCE_URL} rel="noopener noreferrer" target="_blank">
            nulltask/be-music on GitHub
          </a>
          . The{' '}
          <a class={PROSE_LINK} href="/leaderboard/api">
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
    </>
  ),
};

const ja: AboutContent = {
  title: 'このサイトについて',
  description: 'be-music Leaderboard とは何か、プレイをどう採点するか。',
  lead: 'be-music で遊んだ BMS 譜面のランキング。',
  apart: 'ほかとの違い',
  moreBelow: '詳しくは下へ',
  highlights: [
    {
      title: 'スコアはサーバーが数える',
      text: 'プレイヤーが送るのはスコアではなく打鍵の記録です。サーバーがそれを be-music エンジンで再生して結果を数え直すので、書き換えた数字がランキングに載ることはありません。',
      more: 'scoring',
    },
    {
      title: '1 プレイを 3 つのルールで',
      text: 'すべてのプレイを LR2・beatoraja・IIDX のルールで同時に採点します。どのルールで遊んだプレイも、同じ物差しで 1 つのランキングに並びます。',
      more: 'scoring',
    },
    {
      title: '譜面は中身で見分ける',
      text: '譜面はファイルではなく、ノーツとタイミング（#RANDOM のすべての分岐を含む）で識別します。保存し直したり再エンコードしたりしたコピーも同じランキングです。',
      more: 'charts',
    },
  ],
  also: [
    {
      title: '譜面の確認',
      text: 'でっち上げの譜面は、パスキーを持つプレイヤー 2 人が遊ぶまで一般公開されません。',
      more: 'checks',
    },
    {
      title: 'すべてのプレイがリプレイ',
      text: 'どのプレイログもダウンロードして、判定し直す様子を見られます。',
      more: 'replays',
    },
    { title: '登録なしで始められる', text: '匿名で遊べて、パスキーでアカウントを残せます。', more: 'accounts' },
    {
      title: 'ベストは項目ごと',
      text: 'ベスト EX スコア・ランプ・最少ミスを、それぞれ記録したプレイから取ります。',
      more: 'bests',
    },
    {
      title: 'ブラウザで、オープンに',
      text: 'ブラウザで遊んでそのまま送信。API もソースコードも公開しています。',
      more: 'open',
    },
  ],
  body: () => (
    <>
      <Section id="scoring" title="プレイの採点">
        <p>
          プレイが終わると、プレイヤーは<strong>プレイログ</strong>
          を送ります。譜面のノーツと、すべての打鍵とその時刻です。サーバーはプレイヤーが見たスコアを受け取らず、ログを
          be-music エンジンで再生して結果を数え直します。
        </p>
        <p>
          これを <strong>LR2</strong>・<strong>beatoraja</strong>・<strong>IIDX</strong>{' '}
          の採点ルール（判定幅・ゲージ・クリアランプ）で 3 回行います。どのプレイも 3
          つのランキングすべてに載ります。プレイが<em>実際に遊んだ</em>
          ルールはプレイに表示され、ページに表示するルールはヘッダーで選べます。ルールはプレイの数え方であって、プレイしたソフトウェアのことではありません。
        </p>
      </Section>
      <Section id="charts" title="譜面">
        <p>
          譜面はファイルではなく、ノーツとタイミングから求める<strong>フィンガープリント</strong>
          で識別します。保存し直したり再エンコードしたりしたコピーも同じランキングです。譜面ファイルごとの SHA-256 と
          MD5 も記録しており、LR2IR Archive・Mocha-Repository・MinIR・BMS Search へのリンクや、ランキングを 1
          ファイルに絞り込むのに使います。
        </p>
        <p>
          譜面は、パスキーを持つプレイヤー 2 人が遊ぶと<strong>一般公開</strong>
          されます。誰かがでっち上げた譜面が本物として載るのを防ぐためです。
        </p>
      </Section>
      <Section id="accounts" title="アカウント">
        <p>
          遊ぶのに登録は要りません。最初にプレイを送信すると、そのブラウザに<strong>匿名</strong>
          アカウントができます。ランキングは、指定しない限り匿名プレイヤーを表示しません。
        </p>
        <p>
          アカウントを残すには<strong>パスキーを作成</strong>
          してください。ほかの端末からもサインインでき、プレイがランキングに載ります。Google と Discord
          でのサインインも準備中です。
        </p>
      </Section>
      <Section id="checks" title="確認していること">
        <ul class="space-y-1">
          <li>スコアは常に入力から数え直し、ログの値は使いません。</li>
          <li>オートプレイと ESC で中断したプレイは受け付けません。FAILED のプレイは数えます。</li>
          <li>
            アシスト（オートスクラッチ、判定幅の拡大）を使ったプレイは<strong>別のランキング</strong>になります。
          </li>
          <li>
            ログの譜面がフィンガープリントと一致すること（<strong>L3</strong>
            ）、遊んだ譜面がこの譜面だとわかっていること（<strong>L4</strong>: <code>#RANDOM</code>{' '}
            がないか、既に見た分岐）を確かめます。
          </li>
        </ul>
        <p>
          でっち上げた入力の列を人の入力と確実に見分けることはできません。そうしたプレイは通報とモデレーションで対応します。
        </p>
      </Section>
      <Section id="bests" title="自己ベスト">
        <p>
          譜面ごとのベスト EX
          スコア・ベストクリアランプ・最少ミス（BP）は、それぞれを記録したプレイから別々に取ります。あるプレイのベストランプと、別のプレイのベストスコアがどちらも有効です。プレイはすべて残します。
        </p>
      </Section>
      <Section id="replays" title="リプレイ">
        <p>
          ベストだけでなく、すべてのプレイを<strong>プレイログ</strong>
          付きで残しています。プレイのページからダウンロードしてプレイヤーにドロップすると、もう一度見られます。同じエンジンで同じ打鍵を再生するので、判定もそのときのとおりです。
        </p>
        <p>
          各プレイのページには<strong>共有カード</strong>
          もあります。SNS のリンクに表示される結果の画像で、ブラウザが描画します。
        </p>
      </Section>
      <Section id="open" title="ブラウザで、オープンに">
        <p>
          be-music はブラウザで動きます。BMS
          フォルダをドロップして遊び、そのままプレイを送信できます。インストールは要りません。
        </p>
        <p>
          be-music はオープンソースです:{' '}
          <a class={PROSE_LINK} href={SOURCE_URL} rel="noopener noreferrer" target="_blank">
            GitHub の nulltask/be-music
          </a>
          。
          <a class={PROSE_LINK} href="/leaderboard/api">
            API
          </a>{' '}
          も公開しています。
        </p>
      </Section>
      <Section id="beta" title="ベータ版">
        <p>
          フィンガープリント（<code>bmfp0</code>
          ）と採点ルールはまだバージョン 0 です。固まるまでの間、ランキングはリセットされることがあります。
        </p>
      </Section>
    </>
  ),
};

export const ABOUT: Readonly<Record<Locale, AboutContent>> = { en, ja };
