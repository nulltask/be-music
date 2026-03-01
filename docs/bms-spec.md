# BMS 実装仕様

この文書は、`packages/parser` / `packages/stringifier` / `packages/player` が BMS をどう扱うかを定義します。

## 一次参照

- コマンド仕様 (日本語): https://hitkey.nekokan.dyndns.info/cmdsJP.htm

## 対応状況の要約

- 対応レベル: 部分対応
- 方針: 仕様全域の完全再現ではなく、主要な譜面再生要素を優先して実装

## 対応 (構文受理)

- オブジェクトデータ行: `#mmmcc:data`
- ヘッダ行: `#COMMAND value`
- `#` で始まらない行は無視
- 未知ヘッダは `metadata.extras` に保持
- 既知/未知を問わず `#mmmcc` はイベントとして保持

## 対応 (意味解釈)

- メタヘッダ: `TITLE`, `SUBTITLE`, `ARTIST`, `GENRE`, `COMMENT`, `STAGEFILE`, `PLAYLEVEL`, `RANK`, `TOTAL`, `DIFFICULTY`, `BPM`
- リソースヘッダ: `WAVxx`, `BMPxx`, `BPMxx`, `STOPxx`, `TEXTxx`
- チャンネル `02`: 小節長 (`#mmm02:length`)
- チャンネル `03`: 16進直値 BPM 変更
- チャンネル `08`: `#BPMxx` 参照 BPM 変更
- チャンネル `09`: `#STOPxx` 参照 STOP
- チャンネル `01`: 背景音チャンネル
- チャンネル `1x` / `2x`: 演奏チャンネル
- チャンネル `D1-D9` / `E1-E9`: 地雷チャンネル
- player の MANUAL モードでは、地雷タイミングで対応キーを押すと `BAD` 判定になる
- 地雷は `TOTAL`/`EX-SCORE` の対象ノート数には含めない
- チャンネル `04` / `07`: player の BGA 表示で使用
- `04` は base、`07` は layer として合成
- layer (`07`) は黒 (`#000000`) を透過色として扱う
- BGA 画像は 256x256 キャンバス前提で扱い、通常は拡大縮小しない
- 256x256 未満の画像は X 軸中央・Y 軸上詰めで配置
- `04` / `07` で未定義 `#BMPxx` を参照した場合は 256x256 黒として扱う
- 制御構文: `#RANDOM`, `#SETRANDOM`, `#ENDRANDOM`, `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`, `#SWITCH`, `#SETSWITCH`, `#CASE`, `#DEF`, `#SKIP`, `#ENDSW`
- 拡張ヘッダ: `#LNTYPE`, `#LNOBJ`, `#DEFEXRANK`, `#EXRANKxx`, `#ARGBxx`, `#PLAYER`, `#PATH_WAV`, `#BASEBPM`, `#STP`, `#OPTION`, `#CHANGEOPTIONxx`, `#WAVCMD`, `#EXWAVxx`, `#EXBMPxx`, `#BGAxx`, `#POORBGA`, `#SWBGAxx`, `#VIDEOFILE`, `#MATERIALS`, `#DIVIDEPROP`, `#CHARSET` を `bms` 拡張領域へ保持

## 未対応 (一次参照に対する差分)

- 拡張チャンネルの専用挙動: `#xxx51-69` (LN) など

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
