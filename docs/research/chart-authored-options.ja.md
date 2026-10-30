[English](./chart-authored-options.md)

# 譜面指定オプション: #835 の調査資料

2026-10-30 調査。ネイティブの文書、実機の観測、Be-Music への接続案を区別します。この資料自体は実装済み機能の宣言ではありません。

## 一次資料

- [nanasigroove 1.552 の公式配布物、2013-12-28 の保存](https://web.archive.org/web/20131228034524/http://d11x.sakura.ne.jp/software/nanasigroove/nanasi_1552_full.zip): `nanasi/nanasi_manual.chm` 内の `_RESOURCE/11_1_bms.html`（書式）と `_RESOURCE/05_8_3_playoption.html`（オプション解説）。現在の[作者のページ](https://d11x.sakura.ne.jp/asdf/ナナシグルーヴ/)も同じ配布物を参照しますが、現行のダウンロード先は 404 でした。ゲーム本体を起動せず書庫と CHM を読みました。
- [charatbeatHDX 1.18 の公式配布物、2021-12-14 の保存](https://web.archive.org/web/20211214030536/http://www.charatsoft.com/software/download/charatbeatHDX_v1.18.zip): `FILES/html/06.html` が対応命令、`FILES/html/05.html` が既定値を説明します。HDX の HTML は UTF-8、nanasigroove の文書は Shift_JIS です。
- [hitkey のオプション一覧](https://hitkey.nekokan.dyndns.info/option.htm)が新旧 ID を比較し、[命令の観測資料](https://hitkey.nekokan.dyndns.info/cmdsJP.htm#OPTION)が宣言の優先順位を説明します。これらは実装コードではなく観測資料です。
- [2018-11-03 の実機検証](https://hitkey.nekokan.dyndns.info/diary1811.php)は同時刻の A6 の競合を直接調べています。

## 書式と実行時期

nanasigroove の書式説明は、`#OPTION` ごとに `774:カテゴリ_オプション名` という文字列 ID を指定します。CRAZY は複数を併用でき、同じ内部系列では競合します。`#CHANGEOPTIONxx` は `01`–`ZZ` に宣言を割り当て、チャンネル `A6` が実行します。HI-SPEED・CHANGE-HS・HIDDEN と、判定変動・ADDMINE を除く CRAZY が動的に適用可能です。レーン RANDOM は初期指定だけなので、この方言には A6 による長押し中のレーン再配置は必要ありません。大文字小文字、空白区切りの複数 ID、コースとの優先順位、seek の規則は確認できませんでした。

観測資料では、初期指定は異なる系列を保持し、同じ排他的系列では後の行を優先します。宣言全体と順序を保持してください。空白で分割すると HDX の引数が壊れます。同時刻の A6 については単純な後勝ちを裏付けません。2018 年の検証は STEALTH、OFF の順で同位置に置いて STEALTH が適用されました。ネイティブの順序を再現できない場合は Be-Music の安定した実行順を明記する必要があります。

## ID 一覧

以下は書式の識別子であり、Be-Music の対応宣言ではありません。nanasigroove の ID には `774:` を付けます。ネイティブ文書が系列を説明し、[一覧](https://hitkey.nekokan.dyndns.info/option.htm)が厳密な ID と別名を記録しています。

| 系列                | 新形式の接尾辞・引数                                                                                                                                                                                                                                 | A6   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `HI-SPEED_`         | `xY.ZZ`                                                                                                                                                                                                                                              | 可   |
| `CHANGE-HS_`        | `OFF`, `ACCEL`, `BRAKE`, `LINE`, `NAZO`, `NAZO2`, `RANDOM`, `COMBO-UP`, `COMBO-DN`, `COMBO-RD`, `LINENAZO`, `WARP`, `S-WARP`, `LINE2`, `LINEACCEL`, `CHAOS`, `RANDOM2`                                                                               | 可   |
| `HIDDEN_`           | `OFF`, `HIDDEN`, `HIDDEN2`, `HIDDEN3`, `SUDDEN`, `SUDDEN2`, `SUDDEN3`, `M-SUDDEN`, `HID-SUD`, `HID-SUD2`, `HID-SUD3`, `MIST`, `DEEPMIST`, `BLINK`, `BLINK2`, `STEALTH`                                                                               | 可   |
| `RANDOM_`           | `OFF`, `MIRROR`, `RANDOM`, `RANDOM+`, `ALL`, `ALL+`                                                                                                                                                                                                  | 不可 |
| `NOTES_`            | `OFF`, `DOUBLE`, `COPY`, `DBLCOPY`                                                                                                                                                                                                                   | 不可 |
| `CRAZY_` 表示       | `OFF`, `STAR`, `SPIN`, `CLONE`, `CLONE2`, `S-CLONE`, `LINEMOVE`, `LINEMOVE2`, `XWAVE`, `XWAVE2`, `YWAVE`, `YWAVE2`, `XYWAVE`, `XYWAVE2`, `3DWAVE`, `3DWAVE2`, `HIDJUDGE`, `DARK`, `DARK2`, `REVERSE`, `SMALL`, `BIG`, `FADEIN`, `FADEOUT`, `RD-SIZE` | 可   |
| `CRAZY_` 判定・地雷 | `GOOD2BAD`, `GREAT2BAD`, `HELLJUDGE`, `ADDMINE`                                                                                                                                                                                                      | 不可 |
| `GAMELEVEL_`        | `BEGINNER`, `NORMAL`, `HYPER`, `DANGER`                                                                                                                                                                                                              | 不可 |
| `EXTRA_`            | `OFF`, `EASY`, `HARD`, `VERYHARD`                                                                                                                                                                                                                    | 不可 |

一覧には旧形式の `HSP-*`・`HID-*`・`RND-*`・`CRA-*`・`GTP-*`・`GLV-*` もあります。初期指定では旧 ID も使えますが A6 は無視します。旧 `CRA-RHS1/2/3` は再生速度 1.2/1.5/2.0 を指定します。BASE-SPEED が画面に出ることだけでは、その文字列が新形式の有効な譜面 ID だとは言えません。一覧が示すのは旧 ID です。AUTOPLAY の ID は譜面から指定できません。

ネイティブ文書の HI-SPEED は **0.25–100.0** で、音声の tempo ではなく表示間隔を変えます。一覧では **0.01 刻み**で 0.77 の例もあります。既存のユーザー指定は経路で上限が異なります。[engine の操作ヘルパー](../../packages/player-engine/src/core/high-speed-control.ts)は 0.5–10 の 0.5 刻み、[browser のオプション検証](../../packages/player-scene-model/src/play-options/hi-speed.ts)は 0.1–6.0 です。どちらもそのままでは譜面指定の全範囲を保持できません。HIDDEN の位置、透明度、点滅周期、加速曲線、振動周期、乱数分布の数式は両資料とも示しません。名前だけから式を確定できません。

## charatbeatHDX の一次資料で確定した規則

同梱の書式説明で `#OPTION charatbeatHDX:BGAMODE n` の 0 は BGA 領域への拡大縮小、1 は上中央を原点とした原寸、2 は同じ原点で 80% です。`#OPTION charatbeatHDX:LONGMODE n` は 0=CN、1=HCN を強制します。設定画面の説明では、ユーザーの LONG MODE の既定値は譜面指定がない場合だけ適用されます。対応表で `#CHANGEOPTION` は非対応です。prefix の大文字小文字の扱いや重複ヘッダの順序は説明しません。

## 実装への示唆と未確定事項

以下は現在のコードに基づく接続案であり、ネイティブ互換の宣言ではありません。

- HI-SPEED は engine の表示状態へ接続できますが、browser・terminal・replay・seek の全経路で譜面の範囲を保持し、tempo と分ける必要があります。
- LONGMODE はノート抽出前に既存の CN/HCN 判定へ解決できます。bmson のノート別種別や `LNMODE` と併用した場合の優先順位、有効な fingerprint・replay の識別を定義します。
- MIRROR・RANDOM には既存の前処理がありますが、両サイドをまたぐ ALL とスクラッチ・ペダルを含める動作は個別に確認が必要です。NOTES の倍増を既存の battle 名と同一視できません。
- HIDDEN・CHANGE-HS・CRAZY の表示系列は、決定的な式と全ホストの表示経路を作って初めて実装済みと言えます。近い名前の lane cover に置き換えるだけではネイティブとの一致を証明しません。
- ネイティブ文書にはオプションのスコア加点がありますが、利用できる計算式は示しません。AUTOPLAY の記録除外は譜面から指定できないユーザーモードの説明です。コース制約・記録可否・有効オプションの保存・サーバーでの再計算には Be-Music の明示的な規則が必要で、replay に設定値を保存するだけでは判定再現を証明しません。

ローカルの閲覧資料: `/tmp/chart-option-archive-0`、`/tmp/chart-option-archive-1`、`/tmp/chart-options-nanasi-manual/`、`/tmp/nanasi-primary-11_1_bms.txt`、`/tmp/nanasi-primary-05_8_3_playoption.txt`、`/tmp/chart-option-native-1-05.html`、`/tmp/chart-option-native-1-06.html`、`/tmp/hdx-primary-05.txt`、`/tmp/hdx-primary-06.txt`。第三者の配布書庫は一時資料であり、リポジトリへ追加しません。
