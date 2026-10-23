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
      text: 'Every play is scored under LR2, beatoraja and That-Which-Must-Not-Be-Named rules at once, so plays from any of them meet in one ranking, measured the same way.',
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
      text: 'a new chart is listed once two players with an account have played it.',
      more: 'checks',
    },
    { title: 'Every play a replay', text: 'download any replay and watch it judged again.', more: 'replays' },
    {
      title: 'No sign-up to start',
      text: 'play anonymously, and create an account whenever you like.',
      more: 'accounts',
    },
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
          When a play ends, the player sends its <strong>replay</strong>: the chart’s notes and every key press with its
          time. The server does not take the score the player saw; it replays the log on the be-music engine and counts
          the result itself.
        </p>
        <p>
          It does so three times, under the <strong>LR2</strong>, <strong>beatoraja</strong> and{' '}
          <strong>That-Which-Must-Not-Be-Named</strong> scoring rules: their judgment windows, gauges and clear lamps.
          Every play is in all three rankings. The rules a play was <em>played with</em> are marked on it; the rules the
          pages show are yours to pick in the header. They are how a play is counted, not the software it came from.
        </p>
      </Section>
      <Section id="charts" title="Charts">
        <p>
          A chart is known by its <strong>fingerprint</strong>, taken from its notes and timing rather than its file, so
          a re-saved or re-encoded copy shares one ranking. Each chart file is also known by its SHA-256 and MD5, which
          link it to the LR2IR Archive, Mocha-Repository, MinIR and BMS Search, and let a ranking narrow to one file.
        </p>
        <p>
          A new chart is <strong>listed</strong> once two players with an account have played it, so the rankings list
          only charts that really exist.
        </p>
      </Section>
      <Section id="accounts" title="Accounts">
        <p>
          Playing needs no sign-up: your plays are recorded <strong>anonymously</strong> in that browser. Rankings show
          anonymous plays when you turn them on.
        </p>
        <p>
          <strong>Create an account</strong> and your plays so far come with you and join the rankings, and you can sign
          in on another device. Signing in uses a passkey (your device’s fingerprint, face or PIN). Sign-in with Google
          and Discord is coming soon.
        </p>
      </Section>
      <Section id="checks" title="What is checked">
        <ul class="space-y-1">
          <li>The score is always recounted from the inputs, never read from the log.</li>
          <li>Auto play and plays quit with ESC are not recorded; failed plays are.</li>
          <li>
            Plays with an assist (auto scratch, a widened judgment window) are <strong>ranked apart</strong>.
          </li>
          <li>
            The chart in the log must match its fingerprint (<strong>L3</strong>), and the chart played must be known to
            be this one (<strong>L4</strong>): no <code>#RANDOM</code>, or a branch seen before.
          </li>
        </ul>
        <p>
          Machine-generated inputs cannot always be told from a person’s, so such plays are handled through reports and
          moderation.
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
          Every play is kept with its <strong>replay</strong>, not just the best ones. Download it from the play’s page
          and drop it on the player to watch it again: it replays the same key presses on the same engine, so it is
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
          <a class={PROSE_LINK} href="/api-reference">
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
  description: 'be-music Leaderboard の特長と、プレイの採点方法。',
  lead: 'be-music で遊んだ BMS 譜面のランキング。',
  apart: 'ほかのランキングとの違い',
  moreBelow: '詳しくは下へ',
  highlights: [
    {
      title: 'スコアはサーバーが計算',
      text: 'プレイヤーが送るのはスコアではなく打鍵の記録です。サーバーがそれを be-music エンジンで再生してスコアを計算し直すので、ランキングには正しく計算されたスコアだけが並びます。',
      more: 'scoring',
    },
    {
      title: '1 プレイを 3 つのルールで採点',
      text: 'すべてのプレイを LR2・beatoraja・That-Which-Must-Not-Be-Named のルールで同時に採点します。どのルールで遊んだプレイも、同じ基準で 1 つのランキングに並びます。',
      more: 'scoring',
    },
    {
      title: '譜面は中身で見分ける',
      text: '譜面はファイルではなく、ノーツとタイミング（#RANDOM のすべての分岐を含む）で見分けます。保存し直したり再エンコードしたりしたファイルも、同じランキングにまとまります。',
      more: 'charts',
    },
  ],
  also: [
    {
      title: '譜面の確認',
      text: '新しい譜面は、アカウントを持つプレイヤー 2 人が遊ぶと公開されます。',
      more: 'checks',
    },
    {
      title: 'すべてのプレイをリプレイで',
      text: 'どのプレイもリプレイをダウンロードして、もう一度見られます。',
      more: 'replays',
    },
    { title: '登録なしで始められる', text: '匿名ですぐに遊べて、あとからアカウントを作れます。', more: 'accounts' },
    {
      title: '自己ベストは項目ごと',
      text: 'EX スコア・クリアランプ・最少ミスのベストを、それぞれ記録したプレイから取ります。',
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
          プレイが終わると、プレイヤーは<strong>リプレイ</strong>
          （譜面のノーツと、すべての打鍵とその時刻）を送ります。サーバーはプレイヤーの画面に出たスコアを使わず、ログを
          be-music エンジンで再生してスコアを計算し直します。
        </p>
        <p>
          この計算を <strong>LR2</strong>・<strong>beatoraja</strong>・<strong>That-Which-Must-Not-Be-Named</strong>{' '}
          の採点ルール（判定幅・ゲージ・クリアランプ）でそれぞれ行うので、どのプレイも 3
          つのランキングすべてに載ります。プレイヤーが<em>実際に遊んだ</em>
          ルールはプレイごとに表示され、ページに表示するルールはヘッダーで切り替えられます。ルールはスコアの計算方法を表すもので、プレイしたソフトとは関係ありません。
        </p>
      </Section>
      <Section id="charts" title="譜面">
        <p>
          譜面はファイルではなく、ノーツとタイミングから求める<strong>譜面 ID</strong>
          （フィンガープリント）で見分けます。保存し直したり再エンコードしたりしたファイルも、同じランキングにまとまります。譜面ファイルごとの
          SHA-256 と MD5 も記録しており、LR2IR Archive・Mocha-Repository・MinIR・BMS Search へのリンクや、ランキングを 1
          ファイルに絞り込むのに使います。
        </p>
        <p>
          新しい譜面は、アカウントを持つプレイヤー 2 人が遊ぶと<strong>公開</strong>
          されます。実在する譜面だけがランキングに並ぶようにするためです。
        </p>
      </Section>
      <Section id="accounts" title="アカウント">
        <p>
          遊ぶのに登録は要りません。最初にプレイを送信すると、そのブラウザで<strong>匿名</strong>
          のまま記録されます。ランキングは、設定でオンにしない限り匿名のプレイを表示しません。
        </p>
        <p>
          <strong>アカウントを作る</strong>
          と、それまでのプレイも引き継いでランキングに載り、ほかの端末からもログインできます。ログインにはパスキー（端末の指紋認証や
          PIN）を使います。Google と Discord でのログインも準備中です。
        </p>
      </Section>
      <Section id="checks" title="確認していること">
        <ul class="space-y-1">
          <li>スコアは常に打鍵の記録から計算し直し、ログに書かれた値は使いません。</li>
          <li>オートプレイと、ESC で途中終了したプレイは記録されません。FAILED のプレイは記録されます。</li>
          <li>
            アシスト（オートスクラッチ、判定幅の拡大）を使ったプレイは<strong>別枠のランキング</strong>になります。
          </li>
          <li>
            ログの譜面が譜面 ID と一致すること（<strong>L3</strong>）と、遊んだ譜面がこの譜面だと確かめられること（
            <strong>L4</strong>: <code>#RANDOM</code> がない、または既に確認済みの分岐）を確認します。
          </li>
        </ul>
        <p>
          機械的に作られた打鍵を人の打鍵と確実に見分けることはできないため、そうしたプレイには通報とモデレーションで対応します。
        </p>
      </Section>
      <Section id="bests" title="自己ベスト">
        <p>
          譜面ごとの EX
          スコア・クリアランプ・最少ミス（BP）のベストは、それぞれを記録したプレイから別々に取ります。あるプレイのベストランプと、別のプレイのベストスコアがどちらも有効です。プレイはすべて保存します。
        </p>
      </Section>
      <Section id="replays" title="リプレイ">
        <p>
          ベストだけでなく、すべてのプレイを<strong>リプレイ</strong>
          付きで保存しています。プレイのページからダウンロードしてプレイヤーにドロップすると、もう一度見られます。同じエンジンで同じ打鍵を再生するので、判定もそのときと同じです。
        </p>
        <p>
          各プレイのページには<strong>共有カード</strong>もあります。SNS
          でリンクを共有したときに表示される結果の画像で、ブラウザが描画します。
        </p>
      </Section>
      <Section id="open" title="ブラウザで、オープンに">
        <p>
          be-music はブラウザで動きます。BMS
          のフォルダをドロップして遊び、そのままプレイを送信できます。インストールは要りません。
        </p>
        <p>
          be-music はオープンソースです:{' '}
          <a class={PROSE_LINK} href={SOURCE_URL} rel="noopener noreferrer" target="_blank">
            GitHub の nulltask/be-music
          </a>
          。
          <a class={PROSE_LINK} href="/api-reference">
            API
          </a>{' '}
          も公開しています。
        </p>
      </Section>
      <Section id="beta" title="ベータ版">
        <p>
          譜面 ID（<code>bmfp0</code>）と採点ルールはまだバージョン 0
          です。内容が固まるまでの間、ランキングがリセットされることがあります。
        </p>
      </Section>
    </>
  ),
};

export const ABOUT: Readonly<Record<Locale, AboutContent>> = { en, ja };
