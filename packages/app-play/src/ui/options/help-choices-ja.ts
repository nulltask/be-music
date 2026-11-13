import type { OptionHelpChoice, OptionHelpChoices } from './help-choices.ts';

// The union of every ruleset's gauges: the help drops the ones the list does not offer under the rules in force.
const GAUGES: readonly OptionHelpChoice[] = [
  ['GROOVE', 'LR2 の通常ゲージ。20 % から始まり、80 % 以上で終えるとクリアです (LR2 のルールでの既定)。'],
  ['NORMAL', '通常ゲージ。ボーダー以上で終えるとクリアです (beatoraja と ???? のルールでの既定)。'],
  ['EASY', '通常ゲージよりミスで減りにくい回復ゲージ。クリアのボーダーは通常ゲージと同じです。'],
  ['ASSIST EASY', 'beatoraja の最もやさしいゲージ。クリアのボーダーが低く、7 鍵で 60 %、5 鍵で 50 % です。'],
  ['ASSISTED EASY', 'AC の最もやさしいゲージ。60 % でクリアになり、ランプは ASSIST EASY です。'],
  ['HARD', 'サバイバルゲージ。満タンから始まり、ミスで減って、空になるとプレイが終わります。'],
  ['EX-HARD', 'HARD より厳しいサバイバルゲージ。ゲージが少ないときのダメージ軽減がありません。'],
  ['DEATH', 'LR2 の HAZARD。BAD か POOR を 1 つ出すと空になり、クリアには 80 % 以上で終える必要もあります。'],
  ['DEATH corrected', '終了時の 80 % のボーダーをなくした DEATH。最後まで残ればクリアです。'],
  ['HAZARD', 'BAD か POOR を 1 つ出すと空になるサバイバルゲージ。LR2 のルールでは 80 % 以上で終える必要もあります。'],
  ['P.ATTACK', 'PERFECT ATTACK。PGREAT で回復し、GREAT で減り、GOOD 以下で終わるサバイバルゲージ。'],
  ['G.ATTACK', 'GOOD ATTACK。GOOD だけで回復し、ほかの判定では減るサバイバルゲージ。'],
];

// PRACTICE's GAUGE TYPE adds beatoraja's course gauges to the ruleset's own.
const PRACTICE_GAUGES: readonly OptionHelpChoice[] = [
  ...GAUGES,
  ['GRADE', 'beatoraja のコース用ゲージ CLASS。コースで GROOVE か EASY を選んだときのゲージです。'],
  ['EX GRADE', 'beatoraja のコース用ゲージ EXCLASS。コースで HARD を選んだときのゲージです。'],
  ['EXHARD GRADE', 'beatoraja のコース用ゲージ EXHARDCLASS。コースで HAZARD を選んだときのゲージです。'],
];

const LANE_OPTIONS: readonly OptionHelpChoice[] = [
  ['OFF', '譜面のレーンのまま遊びます。'],
  ['MIRROR', '鍵盤のレーンの並びを左右反転します。スクラッチはそのままです。'],
  ['RANDOM', '鍵盤のレーンを譜面全体で 1 回だけ入れ替えます。スクラッチはそのままです。'],
  [
    'S-RANDOM (LR2 / ????)',
    'ノーツをタイムラインごとにランダムな鍵盤のレーンへ置きます。同じレーンの連打は避けません。',
  ],
  [
    'S-RANDOM 9KEY corrected (LR2)',
    '9 鍵の譜面用の LR2 の S-RANDOM。9 つの鍵盤の中だけで選ぶので、叩けない位置に置きません。',
  ],
  ['SCATTER (LR2)', 'ノーツをランダムなレーンへ置きます。直前のタイムラインで使ったレーンは避けます。'],
  ['SCATTER 9KEY corrected (LR2)', '9 鍵の譜面用の SCATTER。9 つの鍵盤の中だけで選びます。'],
  ['CONVERGE (LR2)', 'ノーツを Fixed key のレーンに集めます。そこが埋まっていれば空いた鍵盤のレーンへ置きます。'],
  ['CONVERGE corrected (LR2)', '2P 側も選んだキーに集め、9 鍵の譜面では 9 つの鍵盤の中だけで選ぶ CONVERGE。'],
  ['R-RANDOM (beatoraja)', '鍵盤のレーン全体を、そのままの向きか逆向きで回転します。スクラッチはそのままです。'],
  ['S-RANDOM (beatoraja)', 'ノーツをタイムラインごとに置きます。直前 40 ms 以内に叩いたレーンは避けます。'],
  [
    'SPIRAL (beatoraja)',
    'タイムラインごとに鍵盤のレーンを 1 段ずつ回転します。ロングノートを押している間は回転を止めます。',
  ],
  [
    'H-RANDOM (beatoraja)',
    'S-RANDOM に似ていますが、H-RANDOM threshold BPM の 16 分音符以内に叩いたレーンは避けます。',
  ],
  [
    'ALL-SCR (beatoraja)',
    'タイムラインごとにノーツ 1 つを空いたスクラッチへ移し、残りは H-RANDOM のように置きます。9 鍵では不可。',
  ],
  ['RANDOM-EX (beatoraja)', 'スクラッチのレーンも鍵盤と一緒に入れ替える RANDOM。9 鍵では使えません。'],
  ['S-RANDOM-EX (beatoraja)', '鍵盤とスクラッチを対象にした S-RANDOM (beatoraja)。9 鍵では使えません。'],
  [
    'RANDOM PLAYABLE (beatoraja)',
    '9 鍵専用。9 つの鍵盤を 1 回入れ替えます。同時押しが押せない 3 つ押しの形にならない並びを選びます。',
  ],
  ['S-RANDOM PLAYABLE (beatoraja)', '9 鍵専用。タイムラインごとに置き、3〜6 個の同時押しを押せる形に保ちます。'],
  ['CONVERGE (beatoraja)', '9 鍵専用。空いているレーンのうち、連打がいちばん長く続いているレーンへ置きます。'],
  ['SYNCHRONIZE RANDOM (????)', '1P の鍵盤に RANDOM を 1 回かけ、2P の鍵盤も同じレーン番号にします。'],
  ['SYMMETRY RANDOM (????)', '1P の鍵盤に RANDOM を 1 回かけ、2P の鍵盤はその左右反転にします。'],
];

const LANE_COVERS: readonly OptionHelpChoice[] = [
  ['OFF', 'この側にカバーを出しません。'],
  ['HIDDEN', '判定ラインのすぐ上を隠します (HIDDEN+)。'],
  ['SUDDEN', 'レーンの上側を隠します (SUDDEN+)。'],
  ['HID+SUD', '両方のカバーを出します。高さはどちらも Cover height です。'],
];

const REPLAY_AUTO_SAVE_RULES: readonly OptionHelpChoice[] = [
  ['Never (save by hand)', '自動では保存しません。リザルト画面のスロットのキーでの保存は使えます。'],
  ['Better EX score', 'EX スコアがベスト記録を上回ったときに保存します (スロット 1 の既定)。'],
  ['Better or equal EX score', 'EX スコアがベスト記録以上のときに保存します。'],
  ['Fewer BP', 'BP がベスト記録より少ないときに保存します (スロット 3 の既定)。'],
  ['Fewer or equal BP', 'BP がベスト記録以下のときに保存します。'],
  ['Better max combo', '最大コンボがベスト記録を上回ったときに保存します。'],
  ['Better or equal max combo', '最大コンボがベスト記録以上のときに保存します。'],
  ['Better clear lamp', 'クリアランプがベスト記録を上回ったときに保存します (スロット 2 の既定)。'],
  ['Better or equal clear lamp', 'クリアランプがベスト記録以上のときに保存します。'],
  ['Any of them better', 'EX スコア、BP、最大コンボ、クリアランプのどれかが更新されたときに保存します。'],
  ['Always', 'スコアを残せるプレイを毎回保存します。最新のプレイが残ります (スロット 4 の既定)。'],
];

export const OPTION_HELP_CHOICES_JA: OptionHelpChoices = {
  'Play options': {
    'Judgment windows': [
      ['LR2', 'LR2 の判定幅、ゲージ、ランプ。ロングノートは始点だけを判定します (既定)。'],
      ['beatoraja', 'beatoraja の判定幅とゲージ。LN MODE、CUSTOM JUDGE、Judge algorithm を選べます。'],
      ['????', 'AC の固定の判定幅とゲージ。ロングノートはすべてチャージノートで、ANY KEY (PC) を選べます。'],
    ],
    Gauge: GAUGES,
    'Judge algorithm': [
      ['Source default', 'LR2 と ???? のルールでは、届く範囲でいちばん早いノーツを常に判定します。'],
      ['Combo', '前のノーツが GOOD の判定幅を過ぎてから、後ろのノーツの判定に移ります (既定)。'],
      ['Duration', '押した時刻にいちばん近いノーツを判定します。'],
      ['Lowest', '届く範囲でいちばん早いノーツを常に判定します。'],
    ],
    'bmson TOTAL 0': [
      ['Native compatibility', 'TOTAL が 0 の bmson 譜面を、beatoraja と同じく既定の TOTAL で回復させます (既定)。'],
      [
        'No recovery (bmson spec)',
        'どの判定でもゲージは増えず、ダメージはそのままです。ランキング対象外で保存され、ベスト記録も更新しません。',
      ],
    ],
    'Gauge auto-shift': [
      ['NONE', 'サバイバルゲージが空になるとプレイが終わります (既定)。'],
      ['CONTINUE', '空になったゲージのまま最後まで遊びます。ゲージは 0 のままです。'],
      ['SURVIVAL TO GROOVE', 'サバイバルゲージが空になると、開始から並行して動かしていた通常ゲージで続けます。'],
      ['BEST CLEAR', 'すべてのゲージを並行して動かし、クリアできるうちで最も難しいゲージで遊びます。'],
      ['SELECT TO UNDER', 'BEST CLEAR と同じですが、選んだゲージより上には上がりません。'],
    ],
    'Lowest auto-shift gauge': [
      ['ASSIST EASY', 'BEST CLEAR と SELECT TO UNDER で ASSIST EASY まで下げます (既定)。'],
      ['ASSISTED EASY', 'BEST CLEAR と SELECT TO UNDER で ASSISTED EASY まで下げます (既定)。'],
      ['EASY', 'BEST CLEAR と SELECT TO UNDER で EASY より下には下げません。'],
      ['NORMAL', 'BEST CLEAR と SELECT TO UNDER で NORMAL より下には下げません。'],
      ['GROOVE', 'BEST CLEAR と SELECT TO UNDER で GROOVE より下には下げません。'],
    ],
    'LN MODE (beatoraja)': [
      ['LONG NOTE', 'ロングノートの種類を決めていない譜面を LN で遊びます。始点だけを判定します (既定)。'],
      ['CHARGE NOTE', 'そのような譜面を CN で遊びます。終点も判定します。'],
      ['HELL CHARGE NOTE', 'そのような譜面を HCN で遊びます。終点も判定し、押していない間はゲージが減ります。'],
    ],
    'GAMBOL (LR2)': [
      ['OFF', '判定幅は譜面の #RANK に従います (既定)。'],
      ['LEVEL 1', '判定幅を VERY HARD に固定します。PGREAT ±8 ms、GREAT ±24 ms、GOOD ±40 ms。'],
      ['LEVEL 2', 'LEVEL 1 に加えて、GREAT と GOOD を ±12 ms に狭めます。'],
    ],
    'Auto judge timing': [
      ['OFF', 'Judge timing は自分で変えたときだけ動きます (既定)。'],
      ['beatoraja', '±150 ms 以内の PGREAT、GREAT、GOOD のたびに、そのずれの 30 分の 1 だけ動かします。'],
      ['LR2 ON', '10 打ごとに、叩いたタイミングが偏っている側へ 1 ms 動かします。'],
      ['LR2 SILENT', 'LR2 ON と同じく調整し、譜面の音と BGA なしで遊びます。判定とコンボも表示しません。'],
    ],
    'Random 1P': LANE_OPTIONS,
    'Random 2P': LANE_OPTIONS,
    '7-to-9 (beatoraja)': [
      ['OFF', '7 鍵の譜面をそのままのレーンで遊びます (既定)。'],
      ['SC1 KEY2–8', 'スクラッチをレーン 1、鍵盤をレーン 2〜8 に置きます。レーン 9 が予備です。'],
      ['SC1 KEY3–9', 'スクラッチをレーン 1、鍵盤をレーン 3〜9 に置きます。レーン 2 が予備です。'],
      ['SC2 KEY3–9', 'スクラッチをレーン 2、鍵盤をレーン 3〜9 に置きます。レーン 1 が予備です。'],
      ['SC8 KEY1–7', '鍵盤をレーン 1〜7、スクラッチをレーン 8 に置きます。レーン 9 が予備です。'],
      ['SC9 KEY1–7', '鍵盤をレーン 1〜7、スクラッチをレーン 9 に置きます。レーン 8 が予備です。'],
      ['SC9 KEY2–8', '鍵盤をレーン 2〜8、スクラッチをレーン 9 に置きます。レーン 1 が予備です。'],
    ],
    '7-to-9 scratch': [
      ['Fixed', 'スクラッチのノーツをすべてスクラッチのレーンに置きます。'],
      [
        'Avoid repeated hits',
        'スクラッチのレーンを H-RANDOM threshold BPM の 16 分音符以内に叩いていれば、予備のレーンへ移します。',
      ],
      ['Alternate', 'スクラッチのレーンと予備のレーンのうち、最後に叩いてから長く空いているほうに置きます。'],
    ],
    Battle: [
      ['OFF', '譜面をそのまま遊びます。'],
      ['CHART HEADER', 'LR2 のルールで BMS 譜面の #PLAYER に従います。2 は COUPLE、4 は 2 人プレイの BATTLE です。'],
      ['BATTLE (LR2)', '2 人プレイ。判定とゲージはプレイヤーごとです。5 鍵と 7 鍵の譜面は各プレイヤーに複製します。'],
      ['COUPLE (LR2)', '2 人プレイ。10 鍵と 14 鍵の譜面の片側ずつを、書かれたとおりに遊びます。'],
      [
        'D-BATTLE (LR2)',
        '5 鍵と 7 鍵の譜面を両側に複製し、1 人で両側を遊びます。スクラッチのノーツは BGM になります。',
      ],
      [
        'SP TO DP (LR2)',
        '5 鍵と 7 鍵の譜面を両側に振り分けます。10 鍵と 14 鍵の譜面は 1P 側にまとめ、9 鍵は 7 鍵に畳みます。',
      ],
      [
        'SP TO DP corrected (LR2)',
        'SP TO DP と同じですが、DP flip でも 1P 側にまとめた 10 鍵と 14 鍵の譜面を動かしません。',
      ],
      ['BATTLE (beatoraja)', '1 人で両側を遊びます。5 鍵、7 鍵、24 鍵の譜面を地雷も含めて 2P 側に複製します。'],
      ['BATTLE AS (beatoraja)', 'BATTLE (beatoraja) に加えて、両側のスクラッチのノーツを BGM にします。'],
      ['BATTLE (????)', '7 鍵の譜面を両側に複製し、1 人で両側を遊びます。プレイの記録は残りません。'],
      [
        '2P PLAY (????)',
        '2 人プレイ。判定とゲージはプレイヤーごとです。5 鍵と 7 鍵の譜面は地雷も含めてまるごと複製します。',
      ],
    ],
    'Gauge 2P': GAUGES,
    Scroll: [
      ['OFF', '譜面のとおりにスクロールします (既定)。'],
      ['REMOVE (beatoraja)', 'BPM の変化、STOP、スクロールの変化をなくし、最初の BPM のまま描きます。'],
      [
        'ADD (beatoraja)',
        'Scroll section lines の小節線ごとに、Scroll rate の範囲でスクロール速度をランダムに変えます。',
      ],
      ['SOFTLANDING LEVEL 1 (LR2)', '小節ごとに、スクロール速度を 0.5〜2 倍の範囲でランダムに変えます。'],
      ['SOFTLANDING LEVEL 2 (LR2)', 'LEVEL 1 に加えて、ノーツと地雷ごとにも変えます。'],
    ],
    'Mines (beatoraja)': [
      ['OFF', '地雷は譜面のままです (既定)。'],
      ['REMOVE', '地雷をすべて取り除きます。'],
      ['ADD RANDOM', '空いているマスに、10 分の 1 の確率で地雷を置きます。'],
      ['ADD NEAR', '同じ行で隣のレーンにノーツがある空きマスに地雷を置きます。'],
      ['ADD ALL', '空いているマスすべてに地雷を置きます。'],
    ],
    'Long notes': [
      ['OFF', 'ロングノートは譜面のままです (既定)。'],
      [
        'LEGACY NOTE (AC 34)',
        'チャージノートとバックスピンスクラッチを始点のノーツにします。LN と HCN はそのままです。',
      ],
      ['LN REMOVE (beatoraja)', 'スクラッチのレーンも含め、すべてのロングノートを始点のノーツにします。'],
      ['ADD LN (beatoraja)', 'ノーツを次の行まで伸ばして LN にします。割合は Long-note add rate で決まります。'],
      ['ADD CN (beatoraja)', 'ADD LN と同じく CN を作ります。LN と違うのは beatoraja のルールのときだけです。'],
      ['ADD HCN (beatoraja)', 'ADD LN と同じく HCN を作ります。LN と違うのは beatoraja のルールのときだけです。'],
      ['ADD ALL (beatoraja)', 'ADD LN と同じく作り、足すノーツごとに LN、CN、HCN のどれかを選びます。'],
    ],
    'EXTRA minimum level (LR2)': [
      ['LEVEL 1', '元のノーツとの間隔を最も広く取ります。足すノーツは最も少なくなります (既定)。'],
      ['LEVEL 2', '間隔を狭め、足すノーツが増えます。LEVEL 1 もオブジェクトが 1,000 個以上ならこの動作です。'],
      ['LEVEL 3', '間隔が最も狭く、足すノーツが最も多くなります。密度の高い譜面では下のレベルもこの動作です。'],
    ],
    'GAUGE TYPE': PRACTICE_GAUGES,
    'GAUGE CATEGORY': [
      ['Play mode', '譜面のプレイモードのゲージの表を使います。'],
      ['FIVEKEYS', 'beatoraja の 5 鍵と 10 鍵のゲージの表を使います。'],
      ['SEVENKEYS', 'beatoraja の 7 鍵と 14 鍵のゲージの表を使います。'],
      ['PMS', 'beatoraja の 9 鍵のゲージの表を使います。ゲージの上限は 120 です。'],
      ['KEYBOARD', 'beatoraja の 24 鍵のモードのゲージの表を使います。'],
      ['LR2', 'beatoraja の LR2 風のゲージの表を使います。'],
    ],
  },
  Tempo: {
    Pitch: [
      ['Pitch follows tempo (LR2)', '音を速く、または遅く再生します。ピッチはテンポに合わせて変わります (既定)。'],
      ['Keep pitch', '音を読み込むときに時間方向に伸縮し、ピッチを保ちます。'],
    ],
    'Keep-pitch stretcher': [
      ['WSOLA', '内蔵の伸縮処理。2 つのうち軽いほうです (既定)。'],
      ['Signalsmith Stretch', 'Signalsmith Stretch ライブラリ。動かせないブラウザでは WSOLA を使います。'],
    ],
  },
  'Replay / ghost': {
    'Target (beatoraja)': [
      [
        [
          'RANK A-',
          'RANK A',
          'RANK A+',
          'RANK AA-',
          'RANK AA',
          'RANK AA+',
          'RANK AAA-',
          'RANK AAA',
          'RANK AAA+',
          'RANK MAX-',
        ],
        'ランク境界のスコア。最大スコアの 17/27 (A-) から 26/27 (MAX-) まで。既定は RANK AAA です。',
        'RANK A- – RANK MAX-',
      ],
      ['MAX', '最大スコア (ノーツ数の 2 倍)。'],
      ['NEXT RANK', '自己ベストの EX スコアがまだ届いていない最初のランク境界。'],
      [
        ['IR NEXT 1RANK', 'IR NEXT 2RANK', 'IR NEXT 3RANK', 'IR NEXT 4RANK', 'IR NEXT 5RANK', 'IR NEXT 10RANK'],
        'その譜面の Leaderboard ランキングで、自分より n 位上のスコア。',
        'IR NEXT n RANK',
      ],
      [
        ['IR RANK 1', 'IR RANK 5', 'IR RANK 10', 'IR RANK 20', 'IR RANK 30', 'IR RANK 40', 'IR RANK 50'],
        'ランキングの n 位のスコア。n 位までいないときは最下位のスコア。',
        'IR RANK n',
      ],
      [
        [
          'IR RANK TOP 5%',
          'IR RANK TOP 10%',
          'IR RANK TOP 15%',
          'IR RANK TOP 20%',
          'IR RANK TOP 25%',
          'IR RANK TOP 30%',
          'IR RANK TOP 35%',
          'IR RANK TOP 40%',
          'IR RANK TOP 45%',
          'IR RANK TOP 50%',
        ],
        'ランキングの上位からその割合の位置のスコア。',
        'IR RANK TOP n%',
      ],
      ['SCORE RATE', '最大スコアに対する Target score rate (%) の割合のスコア。'],
    ],
    Ghost: [
      ['OFF', 'ゴーストを見せません (既定)。'],
      ['OWN BEST', 'その譜面のリプレイスロットのうち、EX スコアが最も高いリプレイ。'],
      [
        ['REPLAY SLOT 1', 'REPLAY SLOT 2', 'REPLAY SLOT 3', 'REPLAY SLOT 4'],
        'その譜面の、その番号のスロットのリプレイ。',
        'REPLAY SLOT 1 – 4',
      ],
      ['LEADERBOARD TOP', 'その譜面の Leaderboard ランキング (今のルール) の 1 位のリプレイ。'],
      ['REPLAY FILE', 'Ghost replay file… で選んだファイル。その譜面で記録したものだけ使えます。'],
    ],
    'Ghost mode': [
      [
        'SECOND PLAYFIELD',
        'ゴーストを隣の 2 つ目のプレイフィールドで見せます。内蔵スキンの 5 鍵と 7 鍵の 1 人プレイ用です (既定)。',
      ],
      ['PACEMAKER', 'ゴーストをスコアの目標にします。どのスキンでも、どの譜面でも使えます。'],
      [
        'PACEMAKER + LANES',
        'ペースメーカーに加えて、ゴーストの押下と判定を自分のレーンに重ねます。内蔵スキンで使えます。',
      ],
    ],
  },
  View: {
    'HS-FIX': [
      ['OFF', 'スクロール速度は BPM に従います (既定)。'],
      ['MAXBPM', '最大 BPM のときに設定したハイスピードになります。遅い区間はそのぶん遅く流れます。'],
      ['MINBPM', '最小 BPM のときに設定したハイスピードになります。速い区間はそのぶん速く流れます。'],
      ['AVERAGE', 'メインの BPM (ノーツがいちばん多い BPM) のときに設定したハイスピードになります。'],
      ['CONSTANT', 'LR2 の CONSTANT。BPM によらず一定の速さで流れ、STOP では止まります。'],
      ['STARTBPM', '譜面ヘッダーの開始 BPM のときに設定したハイスピードになります。'],
    ],
    'Display area info': [
      ['OFF', '表示はスキンに任せます (既定)。'],
      ['ON', '出ているカバーすべての端に、カバーの長さと緑数字を表示し続けます。'],
      ['SUDDEN+ ONLY', 'SUDDEN+ の端だけに表示し続けます。'],
      ['HID+/LIFT ONLY', 'HIDDEN+ と LIFT の端だけに表示し続けます。'],
    ],
    'Effect 1P': LANE_COVERS,
    'Effect 2P': LANE_COVERS,
    'Judged notes': [
      ['Keep until its time (LR2)', '早く叩いたノーツも判定ラインまで流れます。LR2 と beatoraja と同じです (既定)。'],
      ['Hide on judge', 'ノーツは判定した瞬間に消えます。'],
    ],
    'Judge detail (built-in skins)': [
      ['OFF', '判定文字の上にタイミングを表示しません (既定)。'],
      ['FAST / SLOW', '早い押下に FAST、遅い押下に SLOW と表示します。PGREAT では表示しません。'],
      ['±ms', 'タイミングのある判定すべてで、ずれをミリ秒で表示します。早いと負、遅いと正です。'],
    ],
    'Judgment display (AC)': [
      ['Skin default', '判定文字とコンボをスキンのとおりに表示します。'],
      ['OFF', 'プレイ画面に判定文字とコンボを表示しません。判定数とスコアは変わりません。'],
    ],
    'Auto scratch notes (AC)': [
      ['Show', 'AUTO SCRATCH が演奏するスクラッチのノーツを表示します (既定)。'],
      ['Hide', 'AUTO SCRATCH が演奏するスクラッチのレーンにノーツを表示しません。キービームとボムは表示します。'],
    ],
  },
  'Key config': {
    'Built-in skin controls': [
      ['LR2', '内蔵スキンの画面が LR2 のキー操作に従います (既定)。'],
      ['beatoraja', '内蔵スキンの画面が beatoraja のキー操作に従います。'],
    ],
  },
  'Skin & display': {
    'Skin system': [
      [
        'Auto (prefer loaded theme)',
        '読み込んだ beatoraja スキン、なければ LR2 スキン、どちらもなければ内蔵スキンで描きます (既定)。',
      ],
      ['Built-in', '常に内蔵スキンで描きます。'],
      [['LR2', 'LR2 (drop a skin)'], 'LR2 スキンで描きます。読み込んでいなければドロップを求めます。', 'LR2'],
      [
        ['beatoraja', 'beatoraja (drop a skin)'],
        'beatoraja スキンで描きます。読み込んでいなければドロップを求めます。',
        'beatoraja',
      ],
    ],
    'Built-in skin': [
      ['Synesthesia', '残り火と金色の粒子の世界。音楽に合わせて飛び、群れ、弾けます。'],
      ['Plain', 'Canvas 2D API で描く最小限のスキン。'],
      [
        'Native (DOM + Canvas)',
        'HTML の画面とスコア HUD に、Canvas のコンポーネントのプレイフィールドを組み合わせます。',
      ],
    ],
    'Skin effects': [
      ['Full', 'すべての演出を出します。'],
      ['Reduced', '画面の揺れと全画面のフラッシュをなくし、パーティクルを減らします。'],
      ['Off', '動かない画面と簡素なヒットフラッシュだけにします。'],
    ],
    'Renderer (applies on reload)': [
      ['WebGL 2', '多くのノート PC の内蔵グラフィックスでいちばん速く描けます (既定)。'],
      ['WebGPU', '合う GPU 向け。ブラウザで起動できないときは WebGL 2 を使います。'],
    ],
    'Play layout': [
      ['Auto', 'スマートフォンとタブレットではタッチ用、それ以外ではデスクトップ用のレイアウトを選びます。'],
      ['Desktop', '標準のレイアウト。'],
      ['Touch', 'タップ用に等幅のレーンをステージいっぱいに並べます。判定ラインが少し下がり、BGA は出ません。'],
    ],
  },
  'Library & records': {
    'Slot 1 auto-save': REPLAY_AUTO_SAVE_RULES,
    'Slot 2 auto-save': REPLAY_AUTO_SAVE_RULES,
    'Slot 3 auto-save': REPLAY_AUTO_SAVE_RULES,
    'Slot 4 auto-save': REPLAY_AUTO_SAVE_RULES,
  },
  Select: {
    Sort: [
      ['OFF', 'ライブラリの順のまま並べます。'],
      ['LEVEL', 'レベルの低い順に並べます。同じレベルはタイトル順です。'],
      ['TITLE', 'タイトル順に並べます。'],
      ['CLEAR', 'クリアランプ順。記録が並び順に反映されるまでは、タイトル順に並べます。'],
    ],
    'Key filter': [
      ['ALL', 'すべてのキーモードを並べます。'],
      ['KEYS_5', '5 鍵の譜面だけを並べます。'],
      ['KEYS_7', '7 鍵の譜面だけを並べます。'],
      ['KEYS_10', '10 鍵 (DP) の譜面だけを並べます。'],
      ['KEYS_14', '14 鍵 (DP) の譜面だけを並べます。'],
      ['KEYS_9', '9 鍵の譜面だけを並べます。'],
    ],
    'Difficulty filter': [
      ['ALL', 'すべての難易度を並べます。'],
      ['BEGINNER', '#DIFFICULTY が 1 の譜面だけを並べます。'],
      ['NORMAL', '#DIFFICULTY が 2 の譜面だけを並べます。'],
      ['HYPER', '#DIFFICULTY が 3 の譜面だけを並べます。'],
      ['ANOTHER', '#DIFFICULTY が 4 の譜面だけを並べます。'],
      ['INSANE', '#DIFFICULTY が 5 の譜面だけを並べます。'],
    ],
  },
  Course: {
    'NONSTOP placement': [
      ['intended', '各ステージを前のステージの位置から始めます。bmson のステージもつなげます (既定)。'],
      ['lr2', 'LR2 の挙動 (不具合も含む) のとおりにステージを置きます。BMS のステージだけ使えます。'],
    ],
  },
  Leaderboard: {
    'Submit when': [
      [
        'EX-SCORE improves (first play always)',
        'その譜面の自己ベスト EX-SCORE を超えたプレイだけ送ります。初回のプレイは必ず送ります (既定)。',
      ],
      ['Always', 'すべてのプレイを送ります。'],
    ],
  },
};
