// The Japanese half of the Options help (`help-template.ts` holds the English half and puts the two together).
import { html } from 'lit';
import { laneKeyHelp, screenKeyHelp } from './help-keys.ts';

export const OPTIONS_HELP_JA = html`
  <div class="help-lang" data-lang="ja" hidden>
    <h3 class="help-section-title">Options</h3>
    <ul class="help-list">
      <li>
        右上の <strong>Settings</strong> ボタン (歯車) で Options が開きます。タブごとに Play、View、Keys、Skin、
        Audio、Library、Leaderboard、Advanced の設定がまとまっています。Play options と View
        は項目が多いのでページに分かれています。各項目の横の <strong>?</strong> にカーソルを合わせると説明が出ます。
      </li>
      <li>
        設定はすべてこのブラウザに記憶され、次に開いたときに元に戻ります。<strong
          >Advanced → Reset settings and reload</strong
        >
        ですべて既定値に戻せます (ベスト記録は残ります)。
      </li>
      <li>
        プレイの内容を決める設定 (レーンのオプション、ゲージ、譜面の変更、判定)
        はプレイ中は変えられず、次の譜面から反映されます。ハイスピード、音量、一部の表示設定はプレイ中にも変えられます。
      </li>
    </ul>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">最上部</h4>
      <p class="help-menu-note">Library タブの最上部。</p>
      <dl class="help-menu-items">
        <dt>Status</dt>
        <dd>今の状態の表示 (読み取り専用)。</dd>
        <dt>Open folder</dt>
        <dd>譜面やスキンのフォルダを選んで読み込みます。ドロップと同じ扱いです。</dd>
        <dt>Open files (ZIP / replay)</dt>
        <dd>
          譜面の ZIP アーカイブ、または再生するリプレイ (<code>*.bmplay.json</code>、コースは
          <code>*.bmcourse.json</code>) を選びます。
        </dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Play options</h4>
      <p class="help-menu-note">
        特に書かない限りプレイ中は変えられません。譜面や表示を変えるだけのオプション (LR2・beatoraja・AC と付いたもの)
        はどのルールでも使え、その出典のアルゴリズムで動きます。判定のルールは Play options → Judgment windows
        で決まります。「…のときに表示」とある項目は、その条件で表示されます。「…のときに使います」とある項目は、その条件で設定できるようになり、それまでは同じ場所に無効のまま表示されます。
      </p>
      <dl class="help-menu-items">
        <dt>Judgment windows</dt>
        <dd>
          すべてのプレイが従うルール。LR2、beatoraja、????。判定の幅、ゲージ、選べるオプション、選曲画面に出すベスト記録が変わります。
        </dd>
        <dt>Record kept</dt>
        <dd>
          選んだオプションでプレイしたときに残る記録です。スコア・ランプ・プレイ回数のすべて、アシストのオプションが
          オンならランプとプレイ回数のみ、または何も残りません。原因のオプションと Leaderboard のボードも示します。
          譜面を実際に変えたときだけアシストになるオプションは、条件付きの文で示します。
        </dd>
        <dt>Auto play</dt>
        <dd>譜面を自動で演奏します。AUTO のプレイは記録に残りません。</dd>
        <dt>Gauge</dt>
        <dd>プレイに使うゲージ。選べる種類は Play options → Judgment windows のルールで変わります。</dd>
        <dt>Judge algorithm</dt>
        <dd>beatoraja のルールで、近くに複数のノーツがあるときにどれを判定するか。Combo (既定)、Duration、Lowest。</dd>
        <dt>Random 1P</dt>
        <dd>
          1P 側のレーンのオプション (1
          人プレイではこちらだけ)。どのオプションもどのルールでも選べ、その出典のアルゴリズムで動きます。出典ごとにまとめ、ルール自身の出典を先頭に並べます。S-RANDOM
          と CONVERGE は出典ごとに中身が違うため、LR2 と ???? で共通の S-RANDOM (LR2 / ????) と S-RANDOM (beatoraja)
          のように出典ごとに 1 つずつ並びます。RANDOM はどの出典でも同じなので 1 つだけです。
        </dd>
        <dt>Random 2P</dt>
        <dd>DP や 2 人プレイでの 2P 側のレーンのオプション。Random 1P と同じ一覧から選びます。</dd>
        <dt>H-RANDOM threshold BPM (beatoraja)</dt>
        <dd>H-RANDOM、ALL-SCR、7-to-9 のスクラッチで、連打とみなす 16 分音符の BPM。</dd>
        <dt>Include scratch 1P / 2P (LR2)</dt>
        <dd>
          5・7・10・14 KEY で、その側の MIRROR、RANDOM、LR2 S-RANDOM、SCATTER、LR2 CONVERGE
          の配置にスクラッチを含めます。
        </dd>
        <dt>Fixed key 1P (LR2; 0=default)</dt>
        <dd>LR2 の CONVERGE で 1P 側のノーツを集めるレーン。0 はモードの既定。</dd>
        <dt>Fixed key 2P (LR2; 0=default)</dt>
        <dd>
          LR2 の CONVERGE と CONVERGE corrected で 2P 側のノートを集めるレーン。0 はモードの既定。RANDOM
          では使いません。
        </dd>
        <dt>Seed 1P (-1=random)</dt>
        <dd>
          どのルールでも使う 1P 側のレーンのランダムのシード。固定すると同じ配置になります。-1
          ならプレイごとに新しく決めます。シードを使わない RANDOM_PLAYABLE では隠れます。
        </dd>
        <dt>Seed 2P (-1=random)</dt>
        <dd>2P 側のレーンのランダムのシード。Seed 1P と同じく、-1 ならプレイごとに新しく決めます。</dd>
        <dt>7-to-9 (beatoraja)</dt>
        <dd>7 鍵の譜面を、選んだ配置で 9 レーンで遊びます。</dd>
        <dt>7-to-9 scratch</dt>
        <dd>7-to-9 でスクラッチのノーツをどこに置くか。Fixed、Avoid repeated hits、Alternate。</dd>
        <dt>Reuse previous arrangement</dt>
        <dd>前回のプレイ (同じルールで遊んだもの) とまったく同じ配置で、同じ譜面をもう一度遊びます。</dd>
        <dt>New arrangement</dt>
        <dd>再利用している配置をやめ、シードを両方 -1 に戻します。</dd>
        <dt>bmson TOTAL 0</dt>
        <dd>
          TOTAL が 0 % の bmson 譜面でのゲージの増え方。Native compatibility (既定) は他のプレイヤーと同じく回復し、No
          recovery (bmson spec) はダメージはそのままで回復しません。回復しないプレイはランキング対象の記録になりません。
        </dd>
        <dt>Gauge auto-shift</dt>
        <dd>
          ゲージが尽きたときの扱い。NONE、CONTINUE、SURVIVAL TO GROOVE、BEST CLEAR、SELECT TO UNDER (beatoraja
          の方式)。LR2・AC では Be-Music の拡張として、各ルールのゲージ順に適用します。たとえば LR2 の難しい順は
          HAZARD、HARD、GROOVE、EASY です。
        </dd>
        <dt>Lowest auto-shift gauge</dt>
        <dd>
          BEST CLEAR と SELECT TO UNDER で下げてよい一番下のゲージ。LR2 には ASSIST EASY がないので、一番下は EASY
          です。
        </dd>
        <dt>ADD NOTES (LR2) · LOUDNESS (LR2) · ADD LONGNOTES (LR2) · ADD MINES (LR2)</dt>
        <dd>
          譜面を書き換える LR2 の隠しオプションです。0 でオフ、100 で最も強くなります。ADD NOTES
          は同時押しにノーツを足し、LOUDNESS は同時押しを全押しにします。どちらもロングノートを単発に戻し、
          プレイの記録は残りません。ADD LONGNOTES は次のノーツとの中間までノーツを伸ばし、ADD MINES
          はノーツの間に地雷を置きます。この 2 つはランプに上限が付きます。コースと PRACTICE では働きません。
        </dd>
        <dt>Scroll</dt>
        <dd>
          REMOVE (beatoraja) は BPM やスクロールの変化をなくして描き、ADD (beatoraja)
          はランダムなスクロールの変化を加えます。SOFTLANDING (LR2) はスクロール速度を 0.5〜2
          倍の範囲でランダムに変えます。LEVEL 1 は小節ごと、LEVEL 2 はノーツごとにも変わります。判定は変わりません。
        </dd>
        <dt>Scroll section lines</dt>
        <dd>
          <em class="help-menu-when">Scroll が ADD のときに使います。</em> スクロールの変化 1 回が続く小節線の数。
        </dd>
        <dt>Scroll rate</dt>
        <dd>
          <em class="help-menu-when">Scroll が ADD のときに使います。</em> スクロールの変化の強さ。0 (なし) 〜 1。
        </dd>
        <dt>Mines (beatoraja)</dt>
        <dd>REMOVE は地雷を取り除き、ADD RANDOM、ADD NEAR、ADD ALL は地雷を加えます。</dd>
        <dt>ANY KEY (PC)</dt>
        <dd>
          <em class="help-menu-when">Judgment windows → ???? のときに表示。</em> PC
          版のアシストです。どのキーでも、判定範囲内でいちばん近いノーツをレーンを問わず取ります。同時押しは押した数だけ取り、ロングノーツは先頭を取ったキーを離すまで押したままになります。記録は残りません。
        </dd>
        <dt>DP flip</dt>
        <dd>DP の譜面の 1P 側と 2P 側を入れ替えます。</dd>
        <dt>Auto scratch 1P</dt>
        <dd>1P 側のスクラッチを自動で処理します。</dd>
        <dt>Auto scratch 2P</dt>
        <dd>2P 側のスクラッチを自動で処理します。</dd>
        <dt>GUIDE SE (beatoraja)</dt>
        <dd>
          判定ごとに音を鳴らします。beatoraja テーマのサウンドセットの音 (guide-pg.wav から guide-ms.wav)
          を使い、セットにないときは鳴りません。キー音の音量に従い、プレイの開始時に読みます。
        </dd>
        <dt>Long notes</dt>
        <dd>
          LEGACY NOTE はチャージノートを通常ノーツに、LN REMOVE はすべてのロングノートを始点だけにし、ADD LN / CN / HCN
          / ALL (beatoraja)
          はどのルールでもロングノートを作ります。足したノーツはルールのロングノートとして判定するので、CN と HCN が LN
          と違うのは beatoraja のルールのときだけです。
        </dd>
        <dt>Battle</dt>
        <dd>
          バトルと変換のモード。出典ごとにまとめ、どのルールでも選べます。BATTLE (LR2) は 2
          人プレイで、各プレイヤーはルールで判定します (???? では 2P PLAY)。BATTLE (beatoraja) と BATTLE (????) は 1
          人で両側を遊びます。COUPLE は LR2 のルールだけです。
        </dd>
        <dt>Gauge 2P</dt>
        <dd>
          <em class="help-menu-when">2 人プレイ (Battle が BATTLE (LR2)、COUPLE、2P PLAY (????)) のときに表示。</em>
          2 人目のゲージ。
        </dd>
        <dt>M-RAN 1P</dt>
        <dd>
          <em class="help-menu-when">2 人プレイ (Battle が BATTLE (LR2)、COUPLE、2P PLAY (????)) のときに表示。</em>
          RANDOM 系のオプションのあと、1P のプレイヤーの側を左右反転します。
        </dd>
        <dt>M-RAN 2P</dt>
        <dd>
          <em class="help-menu-when">2 人プレイ (Battle が BATTLE (LR2)、COUPLE、2P PLAY (????)) のときに表示。</em>
          RANDOM 系のオプションのあと、2P のプレイヤーの側を左右反転します。
        </dd>
        <dt>D-BATTLE scratch (LR2)</dt>
        <dd>
          <em class="help-menu-when">Battle が D-BATTLE のときに表示。</em> スクラッチを BGM
          にせず、叩くノーツのまま残します。
        </dd>
        <dt>EXTRA MODE (LR2)</dt>
        <dd>LR2 の EXTRA MODE のように、BGM のキー音をノーツに変えて増やします。</dd>
        <dt>EXTRA minimum level (LR2)</dt>
        <dd>
          <em class="help-menu-when">EXTRA MODE (LR2) がオンのときに使います。</em> EXTRA MODE の最低の密度。LEVEL
          1〜3。
        </dd>
        <dt>LN MODE (beatoraja)</dt>
        <dd>
          <em class="help-menu-when">beatoraja のルールのときに表示。</em> ロングノートの種類を決めていない譜面を
          LN、CN、HCN のどれで遊ぶか。
        </dd>
        <dt>GAMBOL (LR2)</dt>
        <dd>
          <em class="help-menu-when">LR2 のルールのときに表示。</em> 判定の幅を狭める LR2 の隠しオプションです。LEVEL 1
          は VERY HARD に固定し、LEVEL 2 はさらに GREAT と GOOD を 12 ms にします。プレイは通常どおり記録します。
        </dd>
        <dt>CUSTOM JUDGE (beatoraja)</dt>
        <dd><em class="help-menu-when">beatoraja のルールのときに表示。</em> 下の倍率で判定の幅を変えます。</dd>
        <dt>Key PGREAT %</dt>
        <dd>
          <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> 鍵盤の PGREAT の判定幅
          (ルール本来の幅に対する割合)。
        </dd>
        <dt>Key GREAT %</dt>
        <dd>
          <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> 鍵盤の GREAT の判定幅
          (ルール本来の幅に対する割合)。
        </dd>
        <dt>Key GOOD %</dt>
        <dd>
          <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> 鍵盤の GOOD の判定幅
          (ルール本来の幅に対する割合)。
        </dd>
        <dt>Scratch PGREAT %</dt>
        <dd>
          <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> スクラッチの PGREAT の判定幅
          (ルール本来の幅に対する割合)。
        </dd>
        <dt>Scratch GREAT %</dt>
        <dd>
          <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> スクラッチの GREAT の判定幅
          (ルール本来の幅に対する割合)。
        </dd>
        <dt>Scratch GOOD %</dt>
        <dd>
          <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em> スクラッチの GOOD の判定幅
          (ルール本来の幅に対する割合)。
        </dd>
        <dt>LN margin %</dt>
        <dd>
          <em class="help-menu-when">CUSTOM JUDGE がオンのときに使います。</em>
          ロングノートを終わりより早く離しても成功とする余裕 (ルール本来の余裕に対する割合)。
        </dd>
        <dt>PRACTICE</dt>
        <dd>
          beatoraja の PRACTICE を、どのルールでも使えます。オンにして選曲すると、まず譜面を表示します。小節を押すと
          その小節を試聴し、Shift
          を押しながら押すかドラッグすると連続した小節を選べます。「練習を始める」を押すと、選んだ小節を Esc
          を押すまで繰り返します
          (小節を選ばなければ譜面全体)。下の設定もダイアログで変えられ、「練習せずに遊ぶ」では今回は通常のプレイになります。練習のプレイはリプレイも記録も残さず、Leaderboard
          にも送りません。
        </dd>
        <dt>GAUGE TYPE</dt>
        <dd><em class="help-menu-when">PRACTICE がオンのときに表示。</em> 練習で使うゲージ (そのルールのゲージ)。</dd>
        <dt>GAUGE CATEGORY</dt>
        <dd>
          <em class="help-menu-when">PRACTICE がオンで、beatoraja のルールのときに表示。</em>
          ゲージのカテゴリ。使う表が決まります。
        </dd>
        <dt>GAUGE VALUE</dt>
        <dd><em class="help-menu-when">PRACTICE がオンのときに表示。</em> 練習を始めるときのゲージの値。</dd>
        <dt>JUDGERANK (0 = chart)</dt>
        <dd>
          <em class="help-menu-when">PRACTICE がオンのときに表示 (???? のルールでは表示しません)。</em>
          練習で使う判定ランク。0 なら譜面の値。LR2 のルールでは LR2 の #RANK の表で読みます (25・50・75・100 が VERY
          HARD〜EASY)。
        </dd>
        <dt>TOTAL (0 = chart)</dt>
        <dd>
          <em class="help-menu-when">PRACTICE がオンのときに表示 (???? のルールでは表示しません)。</em> 練習で使う TOTAL
          (ゲージの増え方)。0 なら譜面の値。
        </dd>
        <dt>EXTRA depth (beatoraja)</dt>
        <dd>beatoraja の EXTRA。1 行あたり何個の BGM のキー音をノーツにするか。0 でオフ。</dd>
        <dt>EXTRA scratch (beatoraja)</dt>
        <dd>beatoraja の EXTRA。スクラッチのレーンにもノーツを足すか。</dd>
        <dt>Long-note add rate (beatoraja)</dt>
        <dd>
          <em class="help-menu-when">Long notes が ADD のどれかのときに使います。</em> ロングノートにする割合 (0〜1)。
        </dd>
        <dt>Auto judge timing</dt>
        <dd>
          手で遊んだときの叩いたタイミングから、Judge timing を自動で調整します。beatoraja の方式は 1 打ごとに、LR2
          の方式は 10 打ごとに 1 ミリ秒ずつ動かします。LR2 SILENT では譜面の音と BGA なしで遊び、判定も表示しません。
        </dd>
        <dt>Judge timing (ms)</dt>
        <dd>ノーツを描くタイミングをずらします (−500〜500 ミリ秒)。入力、音、判定はそのままです。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Replay / ghost</h4>
      <p class="help-menu-note">Play options の中。</p>
      <dl class="help-menu-items">
        <dt>Tempo</dt>
        <dd>オンならリプレイは録画時のテンポで、オフなら自分のテンポで再生します。</dd>
        <dt>Hi-speed</dt>
        <dd>オンならリプレイは録画時のハイスピードで、オフなら自分のハイスピードで流れます。</dd>
        <dt>SUDDEN+ / HIDDEN+</dt>
        <dd>オンならリプレイは録画時の SUDDEN+ / HIDDEN+ の動きを見せ、オフなら自分のカバーで見せます。</dd>
        <dt>LIFT</dt>
        <dd>オンならリプレイは録画時の LIFT で判定ラインを上げ、オフなら自分の LIFT で上げます。</dd>
        <dt>Target (beatoraja)</dt>
        <dd>
          ペースメーカーが目指すスコアです。A- から MAX- までのランク境界、MAX、NEXT RANK
          (自己ベストがまだ届いていない最初のランク) から選びます。ゴーストをペースメーカーとして
          表示しているときはゴーストが優先されます。IR のターゲットはその譜面の Leaderboard ランキングを読みます。IR
          NEXT は自分より指定の順位だけ上、IR RANK はその順位、IR RANK TOP
          は上位からその割合の位置です。プレイが始まって
          少ししてから表示され、ランキングのない譜面では表示されません。SCORE RATE は下の割合です。
          プレイ中にも切り替えられます。
        </dd>
        <dt>Target score rate (%)</dt>
        <dd>SCORE RATE のターゲットが目指す、最大スコアに対する割合。プレイ中にも変えられます。</dd>
        <dt>Ghost</dt>
        <dd>
          記録されたプレイを自分のプレイと一緒に見せます。自己ベスト、リプレイスロット、Leaderboard の 1
          位、リプレイファイルから選びます。OFF なら見せません。
        </dd>
        <dt>Ghost mode</dt>
        <dd>
          ゴーストの見せ方。2
          つ目のプレイフィールド、ペースメーカー、押下を自分のレーンに重ねるペースメーカーから選びます。
        </dd>
        <dt>Ghost status</dt>
        <dd>カーソルの譜面で選んだゴーストを見せられるか、見せられないときはその理由 (読み取り専用)。</dd>
        <dt>Ghost replay file…</dt>
        <dd>REPLAY FILE のゴーストが再生するリプレイファイルを選びます。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">View</h4>
      <p class="help-menu-note">View タブ: レーンの見え方。特に書かない限りプレイ中は変えられません。</p>
      <dl class="help-menu-items">
        <dt>HS-FIX</dt>
        <dd>
          <em class="help-menu-when">CLASSIC / Normal / FLOATING HI-SPEED がオンの間は無効。</em> BPM
          に合わせてスクロール速度を一定に保ちます。MAXBPM、MINBPM、AVERAGE、STARTBPM、CONSTANT
          (LR2。どのルールでも選べます)。
        </dd>
        <dt>Normal HI-SPEED (AC 32 measured)</dt>
        <dd>Hi-speed のスライダーの代わりに、AC で実測した 20 段階から速度を選びます。</dd>
        <dt>Normal HS level</dt>
        <dd>
          <em class="help-menu-when">Normal HI-SPEED がオンのときに使います。</em> レベル (1〜20)。それぞれ AC
          で実測した緑数字で流れます。
        </dd>
        <dt>Fixed display area (AC 34)</dt>
        <dd>プレイ中のカバーと LIFT の変更を受け付けません。Enter 2 回でフローティングの緑数字に戻します。</dd>
        <dt>FLOATING HI-SPEED (AC 32 measured)</dt>
        <dd>
          カバーを動かしても、ハイスピードを合わせて変えて緑数字を保ちます。プレイ中は上段またはテンキーの 0
          で切り替えます。
        </dd>
        <dt>Floating speed</dt>
        <dd>
          <em class="help-menu-when">FLOATING HI-SPEED がオンのときに使います。</em> FLOATING の起点のハイスピード (0.01
          刻み)。
        </dd>
        <dt>CLASSIC HI-SPEED</dt>
        <dd>Hi-speed のスライダーの代わりに、AC の CLASSIC の 11 段階から速度を選びます。</dd>
        <dt>Classic speed</dt>
        <dd><em class="help-menu-when">CLASSIC HI-SPEED がオンのときに使います。</em> 段階 (1.0〜4.0)。</dd>
        <dt>Hi-speed</dt>
        <dd>
          <em class="help-menu-when">CLASSIC / Normal / FLOATING HI-SPEED がオンの間は無効。</em>
          スクロールの速さ。プレイ中の ↑ / ↓ と同じく、すぐ反映されます。
        </dd>
        <dt>Display area info</dt>
        <dd>カバーの長さと緑数字をカバーの端に表示し続けます。OFF、ON、SUDDEN+ ONLY、HID+/LIFT ONLY。</dd>
        <dt>Effect 1P</dt>
        <dd>1P 側のレーンカバー。OFF、HIDDEN、SUDDEN、HID+SUD。</dd>
        <dt>Effect 2P</dt>
        <dd>2P 側のレーンカバー。OFF、HIDDEN、SUDDEN、HID+SUD。</dd>
        <dt>Lane cover</dt>
        <dd>レーンの上に LR2 のレーンカバーを出します。プレイ中にも変えられます。</dd>
        <dt>Cover height</dt>
        <dd>レーンカバーがレーンを隠す割合 (0〜1)。プレイ中にも変えられます。</dd>
        <dt>LIFT 1P (beatoraja)</dt>
        <dd>1P 側の判定ラインを上げます。プレイ中にも変えられます。</dd>
        <dt>LIFT 2P (beatoraja)</dt>
        <dd>2P 側の判定ラインを上げます。プレイ中にも変えられます。</dd>
        <dt>LIFT height 1P</dt>
        <dd>LIFT で 1P 側の判定ラインを上げる高さ (レーンに対する割合)。プレイ中にも変えられます。</dd>
        <dt>LIFT height 2P</dt>
        <dd>LIFT で 2P 側の判定ラインを上げる高さ (レーンに対する割合)。プレイ中にも変えられます。</dd>
        <dt>BPM GUIDE (beatoraja)</dt>
        <dd>これから来る BPM の変化をレーン上に表示します。</dd>
        <dt>BPM change warning (AC)</dt>
        <dd>
          BPM が変わる 2 秒前から、レーン上の箱に
          <code>今の BPM » 次の BPM</code> を表示します。速くなるときは青、遅くなるときは赤です。
        </dd>
        <dt>Visual CONSTANT (beatoraja)</dt>
        <dd>ハイスピードによらず、ノーツを判定ラインに届く直前の間だけ表示します。</dd>
        <dt>Note duration (ms)</dt>
        <dd>Visual CONSTANT で、ノーツを判定ラインの前に表示する時間。プレイ中にも変えられます。</dd>
        <dt>CONSTANT fade (ms)</dt>
        <dd>Visual CONSTANT で、表示範囲の境目でノーツがフェードインする時間。プレイ中にも変えられます。</dd>
        <dt>Judged notes</dt>
        <dd>判定したノーツを本来の時刻まで流す (LR2 と同じ) か、消すか。</dd>
        <dt>Lane brightness (AC)</dt>
        <dd>レーンの明るさ (%)。ノーツ、小節線、カバーの明るさは変わりません。プレイ中にも変えられます。</dd>
        <dt>Judgment display (AC)</dt>
        <dd>OFF にすると、プレイ画面に判定文字とコンボを表示しません。プレイ中にも切り替えられます。</dd>
        <dt>Judge detail (built-in skins)</dt>
        <dd>
          内蔵スキンで、判定文字の上にそのタイミングを表示します。FAST / SLOW か、ミリ秒のずれ (早いと負、遅いと正)
          です。プレイ中にも切り替えられます。
        </dd>
        <dt>Judge detail: keys and scratch apart</dt>
        <dd>スクラッチと鍵盤の最後のタイミングを横に並べて表示します。片方の判定でもう片方が消えません。</dd>
        <dt>Judgment counts (built-in skins)</dt>
        <dd>
          オフにすると、プレイ中に判定数、FAST / SLOW
          の数、タイミングのメーターを描きません。プレイ中にも切り替えられます。
        </dd>
        <dt>Judgment position (built-in skins, %)</dt>
        <dd>
          内蔵スキンの判定文字とコンボを、レーンの高さに対する割合 (%) で上 (-) または下 (+) に動かします。
          レーンの外には出ません。LR2 と beatoraja のスキンはそれぞれの配置のままです。プレイ中にも変えられます。
        </dd>
        <dt>Show judge area (beatoraja)</dt>
        <dd>
          判定ラインの上に、判定の幅を色付きの帯で表示します。PGREAT が青で、外側へ緑、黄、橙、赤の順です。
          帯の中にあるノーツは、いま押せばその判定になります。プレイ中にも切り替えられます。
        </dd>
        <dt>Mark processed notes (beatoraja)</dt>
        <dd>
          判定済みのノーツを、消えるまでスキンの処理済みノーツ画像で表示します。画像のないスキンでは薄く表示します。
          プレイ中にも切り替えられます。
        </dd>
        <dt>Auto scratch notes (AC)</dt>
        <dd>
          AUTO SCRATCH が演奏するスクラッチのノーツを表示するか。プレイ中にも切り替えられ、演奏と記録は変わりません。
        </dd>
        <dt>LR2 mania options</dt>
        <dd>
          LR2 の隠しパネルにある、ノーツの描画だけを変えるオプションです: ACCELERATION, EARTHQUAKE, TORNADO, SUPERLOOP,
          CHAR, HEARTBEAT, NABEATSU, SINCURVE, WAVE, SPIRAL effect, SIDEJUMP。 ACCELERATION
          はモードを選び、スライダーのものは 0 でオフ、100 で最も強くなります。プレイ中にも
          切り替えられ、判定と記録は変わりません。ノーツ単位の演出は beatoraja スキンでは描画しません。
        </dd>
        <dt>Show invisible notes</dt>
        <dd>不可視オブジェクトを表示します。プレイ中にも切り替えられ、判定は変わりません。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Key config</h4>
      <p class="help-menu-note">
        Keys タブ。行のキーをクリックしてから、割り当てたいキーを押します。Esc
        で取り消し。そのページのほかのレーンが使っているキーなら、そのレーンには元のキーが入れ替わりで入り、同じ画面のほかの操作が使っているキーは使えません。Esc、Pause、F5、Backspace、上下の矢印はプレイ用です。プレイの開始時に読むので、プレイ中は変えられません。
      </p>
      <dl class="help-menu-items">
        ${laneKeyHelp('ja')}
        <dt>1P START</dt>
        <dd>
          1P 側の START。既定は LR2 と同じ Q。各画面はレーンのキーと合わせて読むので、レーンと同じキーにはできません。
        </dd>
        <dt>1P SELECT</dt>
        <dd>
          1P 側の SELECT。既定は LR2 と同じ W。各画面はレーンのキーと合わせて読むので、レーンと同じキーにはできません。
        </dd>
        <dt>2P START</dt>
        <dd>
          2P 側の START。既定は LR2 と同じ O。各画面はレーンのキーと合わせて読むので、レーンと同じキーにはできません。
        </dd>
        <dt>2P SELECT</dt>
        <dd>
          2P 側の SELECT。既定は LR2 と同じ P。各画面はレーンのキーと合わせて読むので、レーンと同じキーにはできません。
        </dd>
        <dt>Built-in skin controls</dt>
        <dd>
          内蔵スキンの画面がどちらのキー操作に従うか: LR2 か beatoraja。LR2 スキンと beatoraja
          スキンは常にそれぞれのキー操作に従います。
        </dd>
        ${screenKeyHelp('ja')}
        <dt>Reset screen keys to defaults</dt>
        <dd>すべての操作を既定のキーに戻します。</dd>
        <dt>Reset keys to defaults</dt>
        <dd>このページのレーンを既定のキーに戻します。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Tempo</h4>
      <dl class="help-menu-items">
        <dt>Enabled</dt>
        <dd>再生速度の変更を有効にします。</dd>
        <dt>Tempo (%)</dt>
        <dd>譜面を何 % 速く、または遅く再生するか。ピッチがテンポに従う設定なら、プレイ中にも変えられます。</dd>
        <dt>Pitch</dt>
        <dd>ピッチをテンポに合わせて変える (LR2 と同じ) か、保つか。</dd>
        <dt>Keep-pitch stretcher</dt>
        <dd>ピッチを保つ方法。WSOLA か Signalsmith Stretch。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Course</h4>
      <dl class="help-menu-items">
        <dt>Skip stage results</dt>
        <dd>コースのステージごとのリザルト画面を飛ばします。</dd>
        <dt>My courses…</dt>
        <dd>自分で作ったコースの名前の変更、削除、書き出し。</dd>
        <dt>NONSTOP placement</dt>
        <dd>NONSTOP のコースを意図どおりにつなぐか、LR2 の挙動 (不具合も含む) のとおりにつなぐか。</dd>
        <dt>Table URL</dt>
        <dd>コースを読み込む難易度表の URL。</dd>
        <dt>Import table courses</dt>
        <dd>Table URL の難易度表からコースを読み込みます。次に開いたときにも読み込みます。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Skin &amp; display</h4>
      <dl class="help-menu-items">
        <dt>Skin system</dt>
        <dd>
          内蔵、LR2、beatoraja のどのスキンで描くか。読み込んでいなければドロップを求めます。プレイ中にも変えられます。
        </dd>
        <dt>Built-in skin</dt>
        <dd>(Built-in タブ) 使う内蔵スキン。Synesthesia、Plain、Native。</dd>
        <dt>Skin effects</dt>
        <dd>(Built-in タブ) 内蔵スキンの演出の量。Full、Reduced、Off。</dd>
        <dt>Skin settings</dt>
        <dd>(Built-in タブ) 選んだスキンの設定。Reset to defaults で既定値に戻せます。</dd>
        <dt>Load LR2 skin…</dt>
        <dd>(LR2 タブ) LR2 のテーマのドロップか選択を促し、読み込みます。</dd>
        <dt>LR2 theme</dt>
        <dd>(LR2 タブ) 読み込んだ LR2 のテーマから選びます。</dd>
        <dt>Load beatoraja skin…</dt>
        <dd>(beatoraja タブ) beatoraja のスキンのドロップか選択を促し、読み込みます。</dd>
        <dt>Beatoraja skins</dt>
        <dd>(beatoraja タブ) 画面とキーモードごとに beatoraja のスキンを選びます。</dd>
        <dt>Render resolution</dt>
        <dd>
          キャンバスを描く解像度 (0.5× から画面のピクセル比まで)。フレームレートが落ちるときは下げます。1×
          未満は画がぼやけますが、1× でも追いつかない GPU 向けです。
        </dd>
        <dt>Auto-detect resolution</dt>
        <dd>表示中の画面で解像度ごとにフレームレートを測り、保てるいちばん高い解像度にします。</dd>
        <dt>Renderer (applies on reload)</dt>
        <dd>
          WebGL 2 (既定) か WebGPU。多くのノート PC の内蔵グラフィックスでは WebGL 2
          がいちばん速く描けます。次に読み込んだときから反映されます。
        </dd>
        <dt>Play layout</dt>
        <dd>Auto、Desktop、Touch (画面のレーンとボタンで操作)。</dd>
        <dt>Toggle fullscreen</dt>
        <dd>フルスクリーンに入る / 出る。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Audio</h4>
      <dl class="help-menu-items">
        <dt>Mute</dt>
        <dd>プレイヤーの音を消します。音量の設定はそのまま残ります。</dd>
        <dt>Master (%)</dt>
        <dd>プレイヤーが鳴らすすべての音の音量。</dd>
        <dt>Key sound (%)</dt>
        <dd>鍵盤を押して鳴るキー音の音量。</dd>
        <dt>BGM (%)</dt>
        <dd>譜面の BGM の音量。</dd>
        <dt>Play in silent mode</dt>
        <dd>iPhone の消音モードでも音を鳴らします (ブラウザが対応している場合)。</dd>
        <dt>Peak gain (next play)</dt>
        <dd>次のプレイから、一番大きい音が −3 dBFS 近くになるよう音量を上げます。</dd>
        <dt>Compressor</dt>
        <dd>
          キー音と BGM の音量差をならします。オンにして段を選び、それぞれのコンプレッサーを調整できます (リセットあり)。
        </dd>
        <dt>Enabled</dt>
        <dd>(Compressor) コンプレッサーをオンにします。プレイ中にも反映されます。</dd>
        <dt>Key</dt>
        <dd>(段ごとのオン / オフ) 分割コンプレッサーのキー音の段を使うか。プレイ中にも反映されます。</dd>
        <dt>BGM</dt>
        <dd>(段ごとのオン / オフ) 分割コンプレッサーの BGM の段を使うか。プレイ中にも反映されます。</dd>
        <dt>Master</dt>
        <dd>(段ごとのオン / オフ) 分割コンプレッサーの全体の段を使うか。プレイ中にも反映されます。</dd>
        <dt>Threshold (dB)</dt>
        <dd>(Compressor) この音量を超えた音を下げ始めます。プレイ中の譜面にもすぐ反映されます。</dd>
        <dt>Knee (dB)</dt>
        <dd>(Compressor) しきい値の前後で、どれだけなだらかに圧縮を始めるか。</dd>
        <dt>Ratio (x:1)</dt>
        <dd>(Compressor) しきい値を超えた分をどれだけ下げるか。4 なら 4 dB 超えるごとに 1 dB だけ通します。</dd>
        <dt>Attack (ms)</dt>
        <dd>(Compressor) 大きな音をどれだけ速く下げるか。</dd>
        <dt>Release (ms)</dt>
        <dd>(Compressor) 大きな音のあと、どれだけ速く元に戻すか。</dd>
        <dt>Reset to default</dt>
        <dd>(Compressor) このコンプレッサーの設定を既定に戻します。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">BGA camera</h4>
      <dl class="help-menu-items">
        <dt>Show camera in BGA</dt>
        <dd>
          プレイ画面の BGA の枠に、譜面の BGA
          の代わりにカメラの映像を映します。どのスキンでも使えます。手元を写して打鍵の様子を見せたり、配信で顔を出したりするときに使います。オンのときだけプレイ中にカメラを起動し、ほかの画面では止めます。プレイ中にも切り替えられます。映像はどこにも送りませんが、Capture
          で録画すると BGA の枠ごと映像も記録されます。
        </dd>
        <dt>Camera</dt>
        <dd>
          映すカメラ。既定はブラウザの既定のカメラです。選んだカメラはこの端末に記憶します。カメラが抜かれたり、許可が取り消されたりすると、BGA
          に戻ります。
        </dd>
        <dt>Allow camera access</dt>
        <dd>一度だけブラウザにカメラの許可を求め、一覧にカメラの名前が出るようにします。カメラはすぐ止めます。</dd>
        <dt>Mirror camera</dt>
        <dd>映像を左右反転します。手元を写すときに必要になることがあります。</dd>
        <dt>Preview camera</dt>
        <dd>
          選んだカメラを、BGA
          の枠と同じ向きでここに映します。プレイの前に画角を合わせるのに使います。カメラはプレビューの間だけ動き、Stop
          preview を押す、このタブを離れる、Options を閉じる、のいずれかで止まります。
        </dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Library &amp; records</h4>
      <dl class="help-menu-items">
        <dt>Music ZIP URL</dt>
        <dd><code>?music=</code> と同じく、読み込む譜面の ZIP の URL。</dd>
        <dt>Skin ZIP URL</dt>
        <dd><code>?skin=</code> と同じく、読み込むスキンの ZIP の URL。</dd>
        <dt>Load from URLs</dt>
        <dd>上の 2 つの URL の ZIP を読み込みます。</dd>
        <dt>Auto-save replays</dt>
        <dd>プレイが終わるたびにリプレイをダウンロードします。</dd>
        <dt>Clear best records</dt>
        <dd>このブラウザのベスト記録を消します (確認があります)。</dd>
        <dt>Local data…</dt>
        <dd>
          プレイヤーがこのブラウザに保存しているもの (localStorage のキー、自作コース・リプレイスロット・解析済み譜面の
          IndexedDB データベース、使っている容量)
          を表示します。読むだけなので、データは消すための各操作から消してください。
        </dd>
        <dt>Slot 1 auto-save</dt>
        <dd>
          (Replay slots) リザルトでスロット 1 にリプレイを保存する条件 (beatoraja の規則)。EX
          スコア、BP、最大コンボ、クリアランプの更新
          (同じも含むかどうか)、いずれか、常に、保存しない、から選びます。キー 1
          での手動保存はこの設定によらず使えます。
        </dd>
        <dt>Slot 2 auto-save</dt>
        <dd>
          (Replay slots) リザルトでスロット 2 にリプレイを保存する条件。スロット 1 と同じ一覧から選びます。キー 2
          での手動保存はこの設定によらず使えます。
        </dd>
        <dt>Slot 3 auto-save</dt>
        <dd>
          (Replay slots) リザルトでスロット 3 にリプレイを保存する条件。スロット 1 と同じ一覧から選びます。キー 3
          での手動保存はこの設定によらず使えます。
        </dd>
        <dt>Slot 4 auto-save</dt>
        <dd>
          (Replay slots) リザルトでスロット 4 にリプレイを保存する条件。スロット 1 と同じ一覧から選びます。キー 4
          での手動保存はこの設定によらず使えます。
        </dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Select</h4>
      <p class="help-menu-note">
        Library タブの中。選曲画面の一覧の設定です。プレイには使わないので、いつでも変えられます。
      </p>
      <dl class="help-menu-items">
        <dt>Sort</dt>
        <dd>内蔵スキンと LR2 スキンの選曲画面での一覧の並び順。</dd>
        <dt>Key filter</dt>
        <dd>内蔵スキンと LR2 スキンの選曲画面に並べるキーモード。</dd>
        <dt>Difficulty filter</dt>
        <dd>内蔵スキンと LR2 スキンの選曲画面に並べる難易度。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Capture</h4>
      <dl class="help-menu-items">
        <dt>● Record gameplay video</dt>
        <dd>次のプレイを動画として録画してダウンロードします。BGA の枠に映したカメラの映像も記録されます。</dd>
        <dt>Video format</dt>
        <dd>動画のコンテナとコーデック。既定は MP4 · H.264 で、MP4 / WebM と H.265・AV1・VP9・VP8 から選べます。</dd>
        <dt>📸 Screenshot</dt>
        <dd>画面を PNG で保存します。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Leaderboard</h4>
      <dl class="help-menu-items">
        <dt>Submit to Leaderboard</dt>
        <dd>プレイが終わるたびに Leaderboard へ送ります (既定はオフ)。</dd>
        <dt>Submit when</dt>
        <dd>
          その譜面の自己ベスト EX-SCORE を超えたプレイだけ (初回は必ず、既定)
          か、毎回送るかを選びます。コースは常に送ります。
        </dd>
        <dt>Account</dt>
        <dd>Leaderboard にログイン中のアカウント (読み取り専用)。</dd>
        <dt>Keep this account</dt>
        <dd>
          ゲストアカウントをパスキー・Google・Discord で保存します。ほかの端末からログインでき、ランキングにも載ります。
        </dd>
        <dt>Sign in</dt>
        <dd>Accounts から Leaderboard にログインします。</dd>
        <dt>Sign out</dt>
        <dd>Leaderboard からログアウトします。</dd>
      </dl>
    </section>
    <section class="help-menu-folder">
      <h4 class="help-menu-folder-title">Advanced</h4>
      <dl class="help-menu-items">
        <dt>CPU workers</dt>
        <dd>譜面の読み込みや音の伸縮を並列で行うワーカーの数。</dd>
        <dt>Auto pause on blur</dt>
        <dd>ページからフォーカスが外れたらプレイを一時停止します。</dd>
        <dt>FPS</dt>
        <dd>フレームレートのグラフ。</dd>
        <dt>BGA video transcode</dt>
        <dd>BGA の動画を WebCodecs で変換するかと、縮小するサイズ。</dd>
        <dt>Use WebCodecs encoder</dt>
        <dd>
          (BGA video transcode) ブラウザに WebCodecs のエンコーダーがあれば BGA
          の動画をそれで変換します。次の譜面から反映されます。
        </dd>
        <dt>Resize</dt>
        <dd>(BGA video transcode) BGA の動画を縮小するサイズ。Off なら縮小しません。次の譜面から反映されます。</dd>
        <dt>Reset settings and reload</dt>
        <dd>すべての設定を既定値に戻して再読み込みします。ベスト記録は残ります。</dd>
      </dl>
    </section>

    <h3 class="help-section-title">オプションと録画</h3>
    <ul class="help-list">
      <li>
        <strong>Play options</strong> には、レーンのオプション (RANDOM、S-RANDOM、SCATTER
        など)、ゲージ、バトル、譜面の変更、HS-FIX、レーンカバーがあります。<strong
          >Play options → Judgment windows</strong
        >
        で選んだ LR2 や beatoraja の仕様に従います。リプレイにはプレイしたときのオプションが記録されます。
      </li>
      <li>
        <strong>Record gameplay video</strong> ボタンを押すと、次の再生を動画（<strong>Video format</strong>
        で選んだ形式、既定は MP4 · H.264）として録画してダウンロードできます (ブラウザが MediaRecorder
        に対応している必要があります — Acknowledgements / Browser checks を参照)。
      </li>
      <li>
        選曲画面で現在のスキンの <strong>PLAY OPTION</strong> パネルからも、同じオプション (Random / Mirror /
        Auto-scratch / ゲージ / hi-speed など) を設定できます。
      </li>
    </ul>
  </div>
`;
