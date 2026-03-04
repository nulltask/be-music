# BMS 実装仕様

この文書は、`packages/parser` / `packages/stringifier` / `packages/player` が BMS をどう扱うかを定義します。

## 一次参照

- コマンド仕様 (日本語): https://hitkey.nekokan.dyndns.info/cmdsJP.htm
- コマンド仕様 (英語): https://hitkey.nekokan.dyndns.info/cmds.htm
- BMS Format Specification (1998-11-26): http://bm98.yaneu.com/bm98/bmsformat.html
- Bms:Spec (wiki.bms.ms, Wayback 2009-02-13): https://web.archive.org/web/20090213050609/http://wiki.bms.ms/Bms:Spec
- Basic specification of BML (RDM): https://nvyu.net/rdm/rby_ex.php
- STOP Sequence (`#STOPxx` / `#STP`): https://hitkey.nekokan.dyndns.info/exstop.htm
- Extended BPM (`#BPMxx` / `#EXBPM`): https://hitkey.nekokan.dyndns.info/exbpm-object.htm
- `#OPTION` / `#CHANGEOPTION` 仕様: https://hitkey.nekokan.dyndns.info/option.htm
- Sonorous 提案拡張 (補助一次参照): https://hitkey.nekokan.dyndns.info/bmsexts-ja.htm
- Bemuse BMS Extensions (補助一次参照): https://bemuse.ninja/project/docs/bms-extensions

## 参考資料

- `bms benchmark` (実装比較): https://hitkey.nekokan.dyndns.info/bmsbench.shtml
- `bmsplayer data` (互換性調査): https://hitkey.nekokan.dyndns.info/bmsplayer_data2010.shtml

## 対応状況の要約

- 対応レベル: 部分対応
- 方針: 仕様全域の完全再現ではなく、主要な譜面再生要素を優先して実装

## 対応 (構文受理)

- [x] オブジェクトデータ行 `#mmmcc:data` を受理
- [x] ヘッダ行 `#COMMAND value` を受理
- [x] `#` で始まらない行を無視
- [x] 未知ヘッダを `metadata.extras` に保持
- [x] 既知/未知を問わず `#mmmcc` をイベントとして保持

## 対応 (意味解釈)

- [x] メタヘッダ `#TITLE` を解釈
- [x] メタヘッダ `#SUBTITLE` を解釈
- [x] メタヘッダ `#ARTIST` を解釈
- [x] メタヘッダ `#GENRE` を解釈
- [x] メタヘッダ `#COMMENT` を解釈
- [x] メタヘッダ `#STAGEFILE` を解釈
- [x] メタヘッダ `#PLAYLEVEL` を解釈
- [x] メタヘッダ `#RANK` を解釈
- [x] メタヘッダ `#TOTAL` を解釈
- [x] メタヘッダ `#DIFFICULTY` を解釈
- [x] メタヘッダ `#BPM` を解釈
- [x] リソースヘッダ `#WAVxx` を解釈
- [x] リソースヘッダ `#BMPxx` を解釈
- [x] リソースヘッダ `#BPMxx` を解釈
- [x] リソースヘッダ `#STOPxx` を解釈
- [x] リソースヘッダ `#TEXTxx` を解釈
- [x] チャンネル `02` (小節長: `#mmm02:length`) を解釈
- [x] チャンネル `03` (16進直値 BPM) を解釈
- [x] チャンネル `08` (`#BPMxx` 参照 BPM) を解釈
- [x] チャンネル `09` (`#STOPxx` 参照 STOP) を解釈
- [x] チャンネル `01` (背景音) を解釈
- [x] チャンネル `1x` (演奏) を解釈
- [x] チャンネル `2x` (演奏) を解釈
- [x] チャンネル `17` / `27` を FREE ZONE として解釈 (9KEY 以外)
- [x] 9KEY 判定時はチャンネル `17` を通常レーンノートとして解釈
- [x] チャンネル `D1-D9` (地雷) を解釈
- [x] チャンネル `E1-E9` (地雷) を解釈
- [x] MANUAL モードで地雷タイミング入力を `BAD` 判定に反映
- [x] 地雷を `TOTAL` / `EX-SCORE` の対象ノート数から除外
- [x] チャンネル `SC` を `#SCROLLxx` 参照イベントとして保持
- [x] チャンネル `SC` を音声トリガー対象から除外
- [x] チャンネル `SC` のスクロール速度を player 描画へ反映
- [x] チャンネル `04` を BGA base として表示に使用
- [x] チャンネル `07` を BGA layer として表示に使用
- [x] `04` と `07` を合成表示
- [x] layer (`07`) で黒 (`#000000`) を透過色として扱う
- [x] BGA 画像を 256x256 キャンバス前提で扱う
- [x] BGA 画像を通常は拡大縮小しない
- [x] 256x256 未満の画像を X 軸中央 / Y 軸上詰めで配置
- [x] `04` / `07` で未定義 `#BMPxx` 参照時は 256x256 黒として扱う
- [x] BGA 動画を ANSI 描画で再生 (`mpeg1video` / `h264`, 音声は無視)
- [x] 制御構文 `#RANDOM` を保持して実行時評価
- [x] 制御構文 `#SETRANDOM` を保持して実行時評価
- [x] 制御構文 `#ENDRANDOM` を保持して実行時評価
- [x] 制御構文 `#IF` を保持して実行時評価
- [x] 制御構文 `#ELSEIF` を保持して実行時評価
- [x] 制御構文 `#ELSE` を保持して実行時評価
- [x] 制御構文 `#ENDIF` を保持して実行時評価
- [x] 制御構文 `#SWITCH` を保持して実行時評価
- [x] 制御構文 `#SETSWITCH` を保持して実行時評価
- [x] 制御構文 `#CASE` を保持して実行時評価
- [x] 制御構文 `#DEF` を保持して実行時評価
- [x] 制御構文 `#SKIP` を保持して実行時評価
- [x] 制御構文 `#ENDSW` を保持して実行時評価
- [x] 拡張ヘッダ `#PREVIEW` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#LNTYPE` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#LNMODE` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#LNOBJ` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#VOLWAV` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#DEFEXRANK` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#EXRANKxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#ARGBxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#PLAYER` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#PATH_WAV` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#BASEBPM` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#STP` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#OPTION` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#CHANGEOPTIONxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#WAVCMD` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#EXWAVxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#EXBMPxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#BGAxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#SCROLLxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#POORBGA` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#SWBGAxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#VIDEOFILE` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#MIDIFILE` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#MATERIALS` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#DIVIDEPROP` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#CHARSET` を `bms` 拡張領域へ保持
- [x] `#PREVIEW` を曲選択プレビュー再生で優先的に使用
- [x] `#VOLWAV` を player / audio-renderer の再生ゲインに反映
- [x] `#BPMxx` による LR2 100001倍 BPM 系ギミックを時刻解決でサポート

## 未対応 (一次参照に対する差分)

- [x] 拡張チャンネル `#mmm51-59` (LN: `LNTYPE=1`) の専用挙動
- [x] 拡張チャンネル `#mmm61-69` (LN: `LNTYPE=2`) の専用挙動
- [x] ヘッダ `#MIDIFILE` の専用解釈（現在は未知ヘッダ扱い）
- [ ] チャンネル `06` (POOR-BMP/BGA 切替) の再生時挙動
- [ ] `#POORBGA` 未指定時に `#BMP00` を POOR 画像として扱う既定挙動
- [ ] `#BPM` 未指定時の既定値 `130` を互換動作として扱う方針整理（現状 IR 既定は `120`）
- [ ] `#PLAYER` の仕様値 `1-4`（特に `2` / `4`）に対する互換方針の明文化
- [x] `#LNTYPE` 未指定時の既定値 `1` を前提にした LN 解釈規則の定義（`51-69` 実装時）
- [ ] `#LNOBJ` 複数宣言時の扱い（現状は単一値として保持）
- [ ] `#LNOBJ` 終端での Keyup 発音拡張の互換方針（一次資料の HDX 拡張）
- [ ] `#xxx51-69` と `#LNOBJ` が競合する譜面での優先順位定義
- [ ] ヘッダ `#BACKBMP` / `#BANNER` / `#SUBARTIST` / `#MAKER` の専用解釈
- [ ] `#SUBTITLE` / `#SUBARTIST` / `#COMMENT` の複数行定義（Multiplex）の解釈
- [ ] 旧式互換ヘッダ `#SONGxx` を `#TEXTxx` 相当として扱う規則
- [ ] 互換ヘッダ `#EXBPMxx` の読み取り方針（`#BPMxx` との差分）
- [ ] BM98 拡張 `#CHARFILE` / `#ExtChr` の扱い（無視・保持・再生反映の方針）
- [ ] ヘッダ `#CDDA` の扱い（無視・保持・再生反映の方針）
- [ ] 旧動画系ヘッダ `#VIDEOFPS` / `#VIDEODLY` / `#VIDEOCOLORS` / `#SEEK` 系の扱い
- [ ] 素材分離ヘッダ `#MATERIALSBMP` / `#MATERIALSWAV` の扱い
- [ ] `#STP` の実時間反映（現状は保持のみ）
- [ ] `#WAVCMD` の実行仕様（現状は保持のみ）
- [ ] `#OPTION` 複数行の同時適用ルール（現状は単一値保持）
- [ ] オブジェクトチャンネル `#xxxA6`（`#CHANGEOPTIONxx`）の実行時反映
- [ ] `#TEXTxx` / `#TEXT00` のプレイ中表示挙動（現状は保持のみ）
- [ ] `#STOPxx` の負数・小数を含む入力に対する互換方針の明文化
- [ ] `#EXBPM` 互換ヘッダの読み取り方針（`#BPMxx` との優先順位含む）
- [ ] `#BPMxx` / `#STOPxx` のインデックス範囲（`01-FF` / `01-ZZ`）と `00` 扱いの明文化
- [ ] `#WAVxx` / `#BMPxx` のインデックス範囲（`01-FF` / `01-ZZ` / `00` を含む運用差）と大文字小文字の扱い
- [ ] 同一タイムラインでの `#xxx03` と `#xxx08` の競合時優先順位
- [ ] 同一タイムラインでの `#xxx08` と `#xxx09` の競合時優先順位
- [ ] `#BPMxx` の不正値（負数/ゼロ/文字列/指数表記など）入力時の互換挙動
- [ ] `#STP` 書式 (`xxx.yyy zzzz`) の厳密解釈と省略形 (`xxx`) の扱い
- [ ] `#BGAxx` 詳細定義（切り出し/配置パラメータ）の解釈と描画反映
- [ ] `#@BGAxx` の実行時反映（分岐/条件付き BGA 定義）
- [ ] `#SWBGAxx` の実行時反映（条件に応じた BGA 切替）
- [ ] `#ARGBxx` の実行時反映（透過・合成パラメータ）
- [ ] `#DEFEXRANK 0` を含む境界値の判定幅解釈
- [ ] `#PATH_WAV` を再生/レンダリング時の実ファイル解決に適用
- [ ] チャンネル `0A` (BGA LAYER2) の描画対応
- [ ] 互換ディレクティブ `#RONDAM` / `#SETRONDAM` / `#IFEND` の受理方針
- [ ] 全角コマンド・全角スペース混在入力の受理方針
- [ ] オブジェクトデータ文字列が奇数長の場合の末尾トークン処理方針
- [ ] CRLF+LF 混在ファイルの制御構文評価互換（行終端揺れ）
- [ ] 末尾改行なしファイルの厳密互換（パーサ/制御構文）
- [ ] 大量/入れ子 `#RANDOM`・`#SWITCH` を含む譜面の評価安定性
- [ ] `#RANDOM` の大きな上限値を使う譜面での乱数生成仕様固定
- [ ] `#000` 小節の演奏オブジェクトを含む譜面の時刻/判定互換
- [ ] 高分解能譜面（例: 小節分解能 4032 以上）の精度検証と上限方針
- [ ] 小節番号上限（`#999` 近傍）および `#1000` 以降入力時の取り扱い
- [ ] `#STOPxx` / `#BPMxx` のマルチ定義時に採用する行の優先順位
- [ ] `#WAVxx` / `#BMPxx` のマルチ定義時に採用する行の優先順位
- [ ] 一般ヘッダの重複定義時に採用する行の優先順位（原則 EOF 側優先と例外コマンドの整理）
- [ ] 音声フォーマット互換（μ-law WAV など）に対する対応方針
- [ ] `#WAV00` 定義時の扱い（`00` を空イベントとみなす規則との整合）
- [ ] `#WAVxx` の拡張子省略/不一致時における代替ファイル探索（拡張子フォールバック）
- [ ] `#BMPxx` の拡張子省略/不一致時における代替ファイル探索（拡張子フォールバック）
- [ ] 未定義 `#BPMxx` / `#STOPxx` 参照時の互換挙動（無視・既定値・エラー）
- [ ] `#STOPxx` 空定義参照（例: `#05209:` の未定義トークン）時の互換挙動
- [ ] 行頭インデント付きコマンド（先頭空白 + `#COMMAND`）の受理方針
- [ ] 制御構文の別表記 `#ELSE IF` / `#END IF` / `#END` の受理方針
- [ ] `#IF` / `#SWITCH` ブロック未終端（`#ENDIF` / `#ENDSW` 欠落）時の EOF 補完規則
- [ ] Bemuse 拡張ヘッダ `#SPEEDxx` の受理と実行時反映
- [ ] Bemuse 拡張チャンネル `#xxxSP`（spacing factor）の受理と描画反映
- [ ] Bemuse 拡張行 `#EXT #xxxyy:...` の受理規則（通常オブジェクトとの差分）
- [ ] 256x256 超過 BGA（oversize BGA）の描画方針（切り抜き・縮小・配置）
- [ ] BGA 合成の最大レイヤ数と優先順位（`04` / `07` / `0A` / POOR を含む）
- [ ] 動画 BGA に対する `#ARGBxx` / `#BGAxx` パラメータ適用の有無
- [ ] `#BASEBPM` の実時間反映（速度表示・HI-SPEED 計算・内部時刻計算）方針
- [ ] 超長行（例: 100KB 級）入力時の受理上限とエラーハンドリング
- [ ] 演奏/内部オブジェクトが数十万規模の譜面に対する上限と性能保証方針

## player 固有挙動

- 使用チャンネルからレーンモードを自動判定 (`5 KEY SP`, `5 KEY DP`, `7 KEY SP`, `14 KEY DP`, `9 KEY`, `24 KEY SP`, `48 KEY DP`)
- レーンモードを自動判定できない場合は拡張子で補完 (`.bms -> 5 KEY`, `.bme -> 7 KEY`, `.pms -> 9 KEY`)
- FREE ZONE (`17` / `27`) は独立レーンを作らずスクラッチレーン (`16` / `26`) 上に描画
- FREE ZONE ノート長は 4 分音符固定
- FREE ZONE は判定対象外 (`TOTAL` / `EX-SCORE` / `SCORE` に含めない)
- キー入力は kitty keyboard protocol を自動オプトインし、1P/2P スクラッチに左/右 Shift を利用
- kitty 非対応端末では既存入力へフォールバック (`a` / `]` でもスクラッチ入力可能)

## イベント位置の扱い

- `data` は 2文字単位で分割し、`00` は空イベント
- 位置は `position: [numerator, denominator]` として保持
- `denominator = トークン数`
- `numerator = トークンの0始まりインデックス`

## 文字コード

- BOM 付き UTF-8 / UTF-16LE / UTF-16BE を優先
- BOM がない場合は `shift_jis`, `utf8`, `euc-jp`, `latin1` をスコアリングして推測

## stringifier ルール

- `position` の分母情報から小節内解像度を決定
- 同一小節・同一チャンネルでは分母の最小公倍数を採用
- `--maxResolution` 指定時は上限で打ち切り

## 制御構文の評価ルール

- `parser` は制御構文を `bms.controlFlow` として保持し、パース時には分岐を確定しない
- `player` / `audio-renderer` は実行時に `bms.controlFlow` を評価して有効ブロックを展開する
- `#RANDOM n` / `#SWITCH n` は `1..n` の整数を生成して選択値にする
- `#SETRANDOM n` / `#SETSWITCH n` は選択値を固定する
- `#IF` チェーンは現在の RANDOM 選択値で分岐し、`#ELSEIF` / `#ELSE` は先に成立した枝がある場合は無効
- `#SWITCH` チェーンは `#CASE` / `#DEF` を評価し、`#SKIP` で `#ENDSW` まで打ち切る
- `#SWITCH` では `#SKIP` がない場合、後続 `#CASE` / `#DEF` にフォールスルーする
