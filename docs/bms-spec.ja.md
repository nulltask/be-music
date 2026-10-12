[English version](./bms-spec.md)

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
- Obj Tech Lovers | Guidance chapter3-2（`#WAV00` / 休符解釈 / 地雷挙動に関する補助一次参照）: https://nekokan.dyndns.info/~otlovers/guidance/guidance_3a_txt.html
- Obj Tech Lovers | Guidance chapter4-7（地雷ダメージ解釈に関する補助一次参照）: https://nekokan.dyndns.info/~otlovers/guidance/guidance_4b.html
- Bemuse BMS Extensions (補助一次参照): https://bemuse.ninja/project/docs/bms-extensions
- beatoraja 楽曲製作者向け資料: https://github.com/exch-bms2/beatoraja/wiki/%E6%A5%BD%E6%9B%B2%E8%A3%BD%E4%BD%9C%E8%80%85%E5%90%91%E3%81%91%E8%B3%87%E6%96%99

## 参考資料

- `bms benchmark` (実装比較): https://hitkey.nekokan.dyndns.info/bmsbench.shtml
- `bmsplayer data` (互換性調査): https://hitkey.nekokan.dyndns.info/bmsplayer_data2010.shtml
- Numuther: BMS Scroll ギミック解説（SCROLL/BPM/STOP 実例）: https://note.com/numuther/n/n57bf895e7969
- LR2・beatoraja など他のプレイヤーが同じコマンドをどう扱うか、be-music がどこで異なるか: [BMS / bmson 互換性ノート](./format-compat.ja.md)

## 対応状況の要約

- 対応レベル: 部分対応
- 方針: 仕様全域の完全再現ではなく、主要な譜面再生要素を優先して実装

## 対応 (構文受理)

- [x] オブジェクトデータ行 `#mmmcc:data` を受理
- [x] ヘッダ行 `#COMMAND value` を受理
- [x] `#` で始まらない行を無視
- [x] 行終端として `LF` を受理
- [x] 行末 `CR` を除去することで `CRLF` を受理
- [x] 末尾改行なしファイルでも EOF を 1 行終端として受理
- [x] `CR` 単独改行を行終端として受理
- [x] 未知ヘッダを `metadata.extras` に保持
- [x] 既知/未知を問わず `#mmmcc` をイベントとして保持
- [x] 各行の前後の空白を除去するので、行頭インデント付きコマンドも受理
- [x] 制御構文の別表記 `#ELSE IF n` / `#END IF` / 値なし `#END` を `#ELSEIF n` / `#ENDIF` として受理（保存・出力時は正規形へ正規化、`#END <他の値>` は未知ヘッダのまま）

### 行終端

現実装の `parser` は、BMS テキストを `LF` / `CRLF` / `CR` のいずれでも区切ります。
`CRLF` は 1 つの行終端として扱い、`CR` 単独改行も `LF` と同様に受理します。

入力末尾に改行がなくても、EOF を最終行の終端として扱います。
ただし `CRLF` と `LF` が混在するファイルに対する制御構文互換の厳密仕様は、後述の未対応項目のままです。

## 対応 (意味解釈)

- [x] メタヘッダ `#TITLE` を解釈
- [x] メタヘッダ `#SUBTITLE` を解釈
- [x] メタヘッダ `#ARTIST` を解釈
- [x] メタヘッダ `#GENRE` を解釈
- [x] メタヘッダ `#COMMENT` を解釈
- [x] `#SUBARTIST` を `metadata.extras.SUBARTIST` として保持し、player の選曲画面 metadata に使用
- [x] `#BACKBMP` を browser LR2 special graphic 向けに `metadata.backBmp` として保持
- [x] `#BANNER` を `metadata.banner` として保持し、player の選曲画面 banner に使用
- [x] メタヘッダ `#STAGEFILE` を解釈
- [x] `#STAGEFILE` を選曲後の loading screen 専用画像として表示
- [x] メタヘッダ `#PLAYLEVEL` を解釈
- [x] player: BMS で `#PLAYLEVEL` 未指定時は表示用既定値 `3` を選曲画面・TUI・結果表示へ反映
- [x] `#PLAYLEVEL 0` を保持
- [x] 文字列 `#PLAYLEVEL` を保持
- [x] メタヘッダ `#RANK` を解釈
- [x] `#RANK 0-4` を判定難易度指定として保持
- [x] メタヘッダ `#TOTAL` を解釈
- [x] メタヘッダ `#DIFFICULTY` を解釈
- [x] player: `#DIFFICULTY 1-5` を選曲一覧の表示・ソート・フィルタに使用
- [x] メタヘッダ `#BPM` を解釈
- [x] BMS で `#BPM` 未指定時は互換既定値 `130` を適用（IR 既定値も `130` に統一）
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
- [x] チャンネル `17` / `27` を FREE ZONE として解釈 (9KEY / 24KEY 以外)
- [x] 9KEY 判定時はチャンネル `17` を通常レーンノートとして解釈
- [x] `#PLAYER=1` は SINGLE メタ情報として保持し、レーン判定はチャンネル構成を優先
- [x] `#PLAYER=2` (COUPLE) はメタ情報として保持し、現状は専用の 1P/2P 分離プレイを実装しない
- [x] `#PLAYER=3` は `17` チャンネルが存在する場合のみ 9KEY 判定ヒントとして使用
- [x] `#PLAYER=4` (BATTLE) はメタ情報として保持し、現状は専用の 2 人対戦プレイを実装しない
- [x] チャンネル `D1-D9` (地雷) を解釈
- [x] チャンネル `E1-E9` (地雷) を解釈
- [x] MANUAL モードで「押したまま判定線を通過」または「`PGREAT` 窓以内での押下」で地雷を爆発させる（LR2 準拠）
- [x] 地雷ダメージはオブジェクト値（大文字 base36）をそのままパーセントとして適用し、判定・コンボには影響させない（LR2 / beatoraja 準拠）
- [x] 地雷のオブジェクト値が 2 文字の大文字 base36 ID でない場合や `00` の場合は既定ダメージ `4%` にフォールバック（`#BASE 62` の小文字の値もこの既定値になる）
- [x] `#WAV00` が定義されている場合、MANUAL モードの地雷ヒットで爆発音として使用
- [x] 地雷を `TOTAL` / `EX-SCORE` の対象ノート数から除外

#### 地雷ダメージの根拠

地雷ダメージは BM98 時代の基礎 BMS 仕様には含まれていないため、現実装では後年公開された地雷拡張系の資料と LR2 互換実装を根拠にしています。

- 発動窓は LR2 自身の changelog（`history.txt` 080114 の地雷実装エントリ「キー押したまま地雷通過、もしくはピカグレ範囲内でキーを押すと爆発します」）に従い、**`PGREAT`（ピカグレ）範囲**とします。以降のエントリに変更はありません。losak「地雷オブジェに関するアレコレ (LR2)」は `GOOD` 窓としていますが、一次資料を優先し `GOOD` は採用しません。
- 「ダメージ = 指定値そのまま（10進換算%）」は losak の資料の LR2 実機検証に従います。beatoraja（jbms-parser `Section.java` / `JudgeManager`）も生値をダメージとして直接適用しており一致します。
- Hitkey command memo の `value / 2` は nanasi 系統の仕様であり、LR2 の実挙動とは異なるため採用していません。
- `#WAV00` を地雷リアクション専用とする扱いは Hitkey memo / Obj Tech Lovers chapter3-2 / chapter4-7 で補強しています。
- `ZZ`（= 1295%）は survival 系ゲージ（HARD / DEATH）では即 FAILED、`2-100%` の GROOVE / EASY ではゲージ下限 `2%` への clamp になります（losak の「EASY / GROOVE なら 2% になるだけ」と一致）。
- [x] チャンネル `SC` を `#SCROLLxx` 参照イベントとして保持
- [x] チャンネル `SC` を音声トリガー対象から除外
- [x] チャンネル `SC` のスクロール速度を player 描画へ反映
- [x] チャンネル `SP` を `#SPEEDxx` 参照イベントとして保持
- [x] チャンネル `SP` を音声トリガー対象から除外
- [x] チャンネル `SP` の視覚間隔補間を player 描画へ反映
- [x] チャンネル `04` を BGA base として表示に使用
- [x] チャンネル `07` を BGA layer として表示に使用
- [x] チャンネル `0A` を BGA layer2 として表示に使用
- [x] `04` / `07` / `0A` を合成表示（優先順位: `04` < `07` < `0A`）
- [x] layer (`07`) で黒 (`#000000`) を透過色として扱う
- [x] layer2 (`0A`) でも layer (`07`) と同じ透過ルールを適用
- [x] BGA 画像を 256x256 キャンバス前提で扱う
- [x] BGA 画像を通常は拡大縮小しない
- [x] 256x256 未満の画像を X 軸中央 / Y 軸上詰めで配置
- [x] `04` / `07` / `0A` で未定義 `#BMPxx` 参照時は 256x256 黒として扱う
- [x] BGA 動画を描画で再生 (`mpeg1video` / `h264` / `mjpeg`, 音声は無視)
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
- [x] 拡張ヘッダ `#LNMODE` を `bms` 拡張領域へ保持（`1` = LN、`2` = CN、`3` = HCN）
- [x] player は `beatoraja` ルールセットで `#LNMODE 2` / `3` のロングノートを CN / HCN として処理する。`iidx` はすべてのロングノートを CN（`#LNMODE 3` なら HCN）、`lr2` はすべて LN として処理する
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
- [x] 拡張ヘッダ `#SPEEDxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#POORBGA` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#SWBGAxx` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#VIDEOFILE` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#MIDIFILE` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#MATERIALS` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#DIVIDEPROP` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#CHARSET` を `bms` 拡張領域へ保持
- [x] 拡張ヘッダ `#BASE 62` (beatoraja 互換 base-62 拡張) を `bms.base` に保持し、 `#WAVxx` などの索引付きヘッダおよびチャンネルストリームトークンの大文字小文字を区別する
- [x] 単一値ヘッダ・索引付きヘッダ・`#mmm02` の重複定義は EOF 側を採用
- [x] `#STP` / `#LNOBJ` / 制御構文は重複行を宣言順で保持
- [x] `#PREVIEW` を選曲画面プレビュー再生で優先的に使用
- [x] `#VOLWAV` を player / audio-renderer の再生ゲインに反映
- [x] `#xxx97` を BGM 側の動的音量変更として解釈
- [x] `#xxx98` を playable/key 側の動的音量変更として解釈
- [x] `#EXRANKxx` と `#xxxA0` を player の動的判定幅変更として解釈
- [x] `#BPMxx` による LR2 100001倍 BPM 系ギミックを時刻解決でサポート
- [x] すべての `#WAVCMD` 行を `bms.wavCmds` に保持し、audio-renderer と browser WebAudio では `01` volume parameter を反映
- [x] `#EXWAVxx` を parse し、`v` volume parameter を audio-renderer と browser WebAudio で反映
- [x] `#BASEBPM` を `@be-music/chart` 経由で browser HS-FIX calibration の reference BPM として使用
- [x] Browser player で `#BGAxx` sub-region BGA、`#SWBGAxx` switching BGA、`#ARGBxx` / `#EXBMPxx` tint/alpha を反映
- [x] チャンネル `51-59` / `61-69`（拡張の `5A-5O` / `6A-6O` を含む）をロングノートとして解釈。`#LNTYPE` 省略時の既定である `#LNTYPE 1` はオブジェクトを始点 / 終点の組にし、`#LNTYPE 2`（MGQ）は `00` 以外が連続するセルの並びを 1 本のロングノートにする
- [x] `#LNOBJ`: すべての宣言が有効で、宣言順に `bms.lnObjs` へ保持する。このオブジェクトは同じレーンの直前のノートから始まるロングノートを終わらせ、発音しない（HDX の Keyup 発音は採用しない）。直前にノートのない `#LNOBJ` オブジェクトは通常ノートになる
- [x] `51-69` と `#LNOBJ` のロングノートが同じレーン・同じ位置から始まる場合は `51-69` を優先
- [x] player はレーン・位置ごとに 1 ノートだけを残す。ロングノートがタップより優先し、それ以外は最小のオブジェクト ID を採用する。残りのノートのキー音は BGM として鳴らす（[player 仕様 — 重複ノート](./player-spec.ja.md#重複ノート)）
- [x] チャンネル `06` を POOR BGA として再生する。ミス時に表示し、表示中は `04` / `07` / `0A` より優先する
- [x] `#POORBGA` 未指定時は、最初の `06` オブジェクトまで `#BMP00` を POOR 画像として使う
- [x] `#STP xxx[.yyy] zzzz`（`.000` として読む省略形 `xxx zzzz` を含む）を時刻解決で `zzzz` ms の停止として反映し、同じ位置の停止は加算する

### `#BASE`

`#BASE` は、BMS object ID の基数を選ぶ beatoraja 互換拡張です。
既定値は `36` で、`0-9A-Z` を使い、ASCII 小文字は大文字へ畳み込みます。
`#BASE 62` は indexed header と object stream token を case-sensitive な `0-9A-Za-z` として扱い、`0a` と `0A` を別 ID にします。

parser は通常 parse の前に BMS source を pre-scan し、`#BASE 36` / `#BASE 62` を探します。
scan は beatoraja と同じくファイル全体を対象にするため、`#BASE` は object data の後ろを含めてどこに書いてもよく、制御構文のブロックもこの scan では評価しません。
`#BASE 36` / `#BASE 62` の行が複数ある場合は最後の行を採用します。
未対応値は無視します。

runtime と round-trip の扱い:

- `parser` は有効な base を `bms.base` に保持します。`#BASE 36` は既定値と同じなので、出力時に明示する必要はありません。
- `stringifier` は `bms.base` が `62` の場合に `#BASE 62` を出力します。
- `#WAVxx`, `#BMPxx`, `#BPMxx`, `#STOPxx`, `#TEXTxx`, `#LNOBJ`, BGA 系 indexed map、object stream value は有効な base で正規化します。
- 制御構文 (`#RANDOM` / `#IF` / `#SWITCH` block) の内側も通常行と同じ base を使うため、branch 内の小文字 ID も parse と branch resolution を通して保持します。
- `player`, `audio-renderer`, `chart`, `player-web` は sample、BGA、BPM/STOP、LN、地雷、timing 参照を `resolveBmsBase()` 経由で解決し、base-62 の小文字 ID を runtime でも区別します。

例:

```bms
#BASE 62
#WAV0a lower.wav
#WAV0A upper.wav
#00111:0a0A
```

この場合、`lower.wav` と `upper.wav` は別々の sample reference として鳴ります。
`#BASE 62` が無い場合、両方の key は同じ base-36 ID に畳み込まれ、後勝ちの定義になります。

### `#VOLWAV`

`parser` は `#VOLWAV` を非負の数値として `bms.volWav` に保持します。
`stringifier` は `bms.volWav` が存在する場合、その値を `#VOLWAV n` としてそのまま出力します。

再生時とレンダリング時は、`#VOLWAV` を譜面全体へ掛かる線形 gain として扱います。
省略時は `100` を既定値とします。`0 < n < 200` の値では実効倍率が `n / 100` になり、それ以外の値では原音量で鳴らします。

- `#VOLWAV 100`: 原音量
- `#VOLWAV 50`: 原音量の半分
- `#VOLWAV 150`: 原音量の `1.5` 倍
- `#VOLWAV 0`、`#VOLWAV 200` 以上: 原音量

この範囲は beatoraja に合わせたものです（beatoraja は `0 < n < 200` のときだけ `#VOLWAV` を適用します）。LR2 は `#VOLWAV` を無視します。beatoraja に合わせることで、`#VOLWAV 0` で譜面が無音になったり、大きな値で増幅されて音割れしたりすることを防ぎます。この規則は `@be-music/chart` の `volWavToLinearGain` が実装しています。

この倍率は `player` のリアルタイム再生、選曲画面プレビュー、`audio-renderer` の `renderJson()` / `renderChartFile()` に適用します。
各 player やハードウェア固有の音量差は再現せず、現実装では単純な gain 倍率としてのみ扱います。

### `#xxx97` / `#xxx98`

`parser` / `stringifier` は `97` / `98` を通常の object channel として保持します。
`00` は通常どおり空トークンとして扱い、`01-FF` の非ゼロ値だけがイベントになります。

再生時とレンダリング時は、`97` を BGM 側、`98` を playable/key 側の動的 bus volume として扱います。
値は 16 進整数 `1-255` を `value / 255` の gain へ変換し、その時点以降に適用します。

- `#xxx97`: `01` / BGM の最小音量から `FF` / 原音量までを切り替える
- `#xxx98`: `01` / KEY SOUND の最小音量から `FF` / 原音量までを切り替える
- `00`: 休符なのでイベント化されず、音量変更も発生しない

現実装では、これらの channel 自体は sample trigger としては扱いません。
また、音量変更はその時点以後に新しく鳴る音の初期 gain にだけ反映し、すでに再生中の同系統 voice には反映しません。

## 未対応 (一次参照に対する差分)

- [ ] `#MIDIFILE` の再生（`bms.midiFile` に保持。再生はしない）
- [ ] ヘッダ `#MAKER` の専用解釈
- [ ] `#SUBTITLE` / `#SUBARTIST` / `#COMMENT` の複数行定義（Multiplex）の解釈
- [ ] 旧式互換ヘッダ `#SONGxx` を `#TEXTxx` 相当として扱う規則
- [ ] 互換ヘッダ `#EXBPMxx` の読み取り方針（`#BPMxx` との差分）
- [ ] BM98 拡張 `#CHARFILE` / `#ExtChr` の扱い（無視・保持・再生反映の方針）
- [ ] ヘッダ `#CDDA` の扱い（無視・保持・再生反映の方針）
- [ ] 旧動画系ヘッダ `#VIDEOFPS` / `#VIDEODLY` / `#VIDEOCOLORS` / `#SEEK` 系の扱い
- [ ] 素材分離ヘッダ `#MATERIALSBMP` / `#MATERIALSWAV` の扱い
- [ ] `#WAVCMD` の pitch / loop 実行。現状の runtime support は audio-renderer と browser WebAudio の `01` volume parameter のみです。
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
- [ ] `#@BGAxx` の実行時反映（分岐/条件付き BGA 定義）
- [ ] CLI/TUI での `#BGAxx`、`#SWBGAxx`、`#ARGBxx`、`#EXBMPxx` 反映
- [ ] `#DEFEXRANK 0` を含む境界値の判定幅解釈
- [ ] ターミナル版 player がプレイ用にサンプルを読み込むときの `#PATH_WAV` 適用（browser gameplay、オフラインレンダラー、選曲画面プレビューはすでにディレクトリ接頭辞として試す）
- [ ] 互換ディレクティブ `#RONDAM` / `#SETRONDAM` / `#IFEND` の受理方針
- [ ] 全角コマンド・全角スペース混在入力の受理方針
- [ ] CRLF+LF 混在ファイルの制御構文評価互換（行終端揺れ）
- [ ] 末尾改行なしファイルの厳密互換（パーサ/制御構文）
- [ ] 大量/入れ子 `#RANDOM`・`#SWITCH` を含む譜面の評価安定性
- [ ] `#RANDOM` の大きな上限値を使う譜面での乱数生成仕様固定
- [ ] `#000` 小節の演奏オブジェクトを含む譜面の時刻/判定互換
- [ ] 高分解能譜面（例: 小節分解能 4032 以上）の精度検証と上限方針
- [ ] 小節番号上限（`#999` 近傍）および `#1000` 以降入力時の取り扱い
- [ ] 音声フォーマット互換（μ-law WAV など）に対する対応方針
- [ ] 地雷再生以外で `00` オブジェクトを通常の `#WAV00` 参照として扱う互換方針
- [ ] `#WAVxx` の拡張子省略/不一致時における代替ファイル探索（拡張子フォールバック）
- [ ] `#BMPxx` の拡張子省略/不一致時における代替ファイル探索（拡張子フォールバック）
- [ ] 未定義 `#BPMxx` / `#STOPxx` 参照時の互換挙動（無視・既定値・エラー）
- [ ] `#STOPxx` 空定義参照（例: `#05209:` の未定義トークン）時の互換挙動
- [ ] `#IF` / `#SWITCH` ブロック未終端（`#ENDIF` / `#ENDSW` 欠落）時の EOF 補完規則
- [ ] Bemuse 拡張行 `#EXT #xxxyy:...` の受理規則（通常オブジェクトとの差分）
- [ ] 256x256 超過 BGA（oversize BGA）の描画方針（切り抜き・縮小・配置）
- [ ] 動画 BGA に対する `#ARGBxx` / `#BGAxx` パラメータ適用の有無
- [ ] `#BASEBPM` の core time-resolution 反映方針。browser HS-FIX は視覚上の reference BPM として使いますが、内部 chart timing は BPM event に従います。
- [ ] player: `#PLAYER` 未指定時の既定値 `1` を選曲画面・TUI・結果表示へ反映
- [ ] player: `#PLAYER=2` / `#PLAYER=4` の表示と実装実態を一致させる（meta only 明示 or 専用モード実装）
- [ ] editor: `setMetadata` / `set-meta` で `#PLAYER` を `metadata.extras` ではなく `bms.player` へ書き込む
- [ ] editor: dedicated BMS 拡張ヘッダを API/CLI 編集後に save/load ラウンドトリップなしで export できるようにする
- [ ] 超長行（例: 100KB 級）入力時の受理上限とエラーハンドリング
- [ ] 演奏/内部オブジェクトが数十万規模の譜面に対する上限と性能保証方針

### 参考資料由来 TODO（SCROLL/BPM/STOP）

| TODO                                                                              | 現状 | 備考                                                                                                     |
| --------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| [x] `#SCROLL 0` 区間で同一レーンに重なったノートの前後表示優先順位を仕様化        | 対応 | 同一セルに重なった場合は先に来るノートを基準行に置き、後続ノートは判定ラインから遠ざかる方向へ積み上げる |
| [x] `#SCROLL < 0` の逆走表示（方向・判定ライン付近・画面外）を互換仕様として固定  | 対応 | 現行実装方針として「接近表示優先」を採用し、描画距離は絶対値で扱う（逆方向スクロール再現は行わない）     |
| [x] `#SCROLL 0` 長区間での先読み上限と可視範囲を仕様化                            | 対応 | 先読みは `MAX_SCROLL_LOOKAHEAD_BEATS` (= 64 小節) で打ち切り、可視範囲外ノートは描画対象外とする         |
| [x] BPM×`100001` + `#STOPxx` 補正時の「表示 BPM」互換方針を明文化                 | 対応 | 時刻解決と同じ BPM 値をそのまま表示し、LR2 互換の表示置換・丸めは実施しない                              |
| [x] SCROLL/BPM/STOP 複合ギミック（部分ワープ・空打鍵・逆走）の回帰テストを追加    | 対応 | `timeline` に複合ケースを追加し、POOR 系は既存 `bga` テスト群で継続検証する                              |
| [x] beatoraja 固有の出現/消失バグ依存譜面の扱い（非対応明記 or 再現モード）を決定 | 対応 | 互換対象外として明記し、将来必要なら別オプションで再現モードを検討する                                   |

## player 固有挙動

- 使用チャンネルからレーンモードを自動判定 (`5 KEY SP`, `5 KEY DP`, `7 KEY SP`, `14 KEY DP`, `9 KEY`, `24 KEY SP`, `48 KEY DP`)
- すべての host（engine、CLI、Web player）は、host が variant を明示しない限り、共通ルール `@be-music/chart` の `resolveChartPlayVariant` ひとつでレーンモードを決めます。演奏時は `#RANDOM` / `#SWITCH` 解決後の譜面に対して判定するため、選ばれた分岐が追加するレーンも数えます
- レーン使用は `1x` / `2x` のレーンチャンネルと、対応レーンに写した `5x` / `6x` の `#LNTYPE` ロングノートチャンネルで数えます（同じ譜面の `#LNOBJ` 表記と `#LNTYPE` 表記で結果が一致します）。地雷 (`Dx` / `Ex`) と不可視オブジェ (`3x` / `4x`) はレーンモードの判定に使いません
- 拡張レーンチャンネル (`1A..1O` / `2A..2O`) は他のどのルールよりも優先して `24 KEY SP` / `48 KEY DP` を選びます
- be-music 独自: チャンネル `1P` / `1Q`（2P 側は `2P` / `2Q`）は 24 / 48 KEY のホイールの上 / 下で、bmson `keyboard-24k` のホイールレーン（`x` = 25 / 26）の BMS 表記です。ほかの BMS プレイヤーはこれらのチャンネルを定義していません。拡張レーンとして数えるため、これらもキーボードモードを選びます
- `.pms` 譜面はチャンネルにかかわらず `9 KEY` です。この判定は拡張レーンの次、内容による判定より前に行います
- `9 KEY` は内容からも判定します: `#PLAYER 3` でチャンネル `17` を使う譜面（IIDX の 2P 側 `21` / `26..29` がない場合。ある場合は FREE ZONE 付きの IIDX DP 譜面）、`11..19` をすべて使う 1P 譜面、`21` / `26..29` を使わずに `22..25` を使う譜面（`.bms` / `.bme` で書かれた PMS-STD）
- それ以外は IIDX 系として判定します: 6 / 7 鍵の列 (`18` / `19` / `28` / `29`) があれば `7 KEY SP` / `14 KEY DP`、なければ `5 KEY SP` / `5 KEY DP` です。拡張子にかかわらず使われているレーンで決め、6 / 7 鍵の列がない `.bme` 譜面も beatoraja と同じく `5 KEY SP` / `5 KEY DP` です（be-music の判断。[format-compat §5](./format-compat.ja.md#5-be-music-の判断のまとめ) を参照）
- `.pms` 譜面の 9KEY は標準配列 (`PMS-STD`) / 互換配列 (`PMS-COMPAT`) をチャンネル分布から推定し、`LANE` 表示に反映
- FREE ZONE (`17` / `27`) は独立レーンを作らずスクラッチレーン (`16` / `26`) 上に描画。`9 KEY` と `24 KEY` / `48 KEY` の keyboard mode では通常レーンとして扱う
- FREE ZONE ノート長は 4 分音符固定
- FREE ZONE は判定対象外 (`TOTAL` / `EX-SCORE` / `SCORE` に含めない)
- BGA ビューポート背景は黒を使用（透明領域・BGA 未表示中も黒）
- 制御構文を含む譜面では、選択された `#RANDOM` パターンを `RANDOM 現在/総数` 形式で表示
- プレイ中に `Shift+R` で演奏を最初から再開し、`#RANDOM` は再抽選する
- IIDX 系の既定キーボード配置は、1P を `Z S X D C F V`、2P を `B H N J M K ,` とする
- キー入力は kitty keyboard protocol を自動オプトインし、1P/2P スクラッチに左/右 `Shift`、reverse scratch に左/右 `Ctrl` を利用する
- macOS では reverse scratch に左/右 `Ctrl` の代わりに左/右 `Option` を利用する
- kitty 非対応端末では既存入力へフォールバックし、reverse scratch の side-specific 入力は保証しない
- HIGH-SPEED 操作は `Alt/Option` + レーン入力（奇数レーンで減速、偶数レーンで加速）で行う
- 選曲画面プレビューは `#PREVIEW` を優先し、未指定時は譜面先頭発音からフォールバック生成する
- 選曲画面プレビューのレンダリングはフォーカス移動時に中断するが、同一 `#PREVIEW`（同一実ファイル）または同一フォールバックシグネチャの場合は継続再生する（フォールバックは演奏チャンネル配置差分を無視）
- 単曲モード（および譜面1件ディレクトリ）では、リザルトを `Enter` / `Esc` 待ちにし、`r` でリプレイできる
- リザルト遷移は固定待機時間ではなく、再生中音声のドレイン完了を待って実行する

### player 判定/音声ルール

- FAST/SLOW は `GREAT` / `GOOD` のみで加算し、`PERFECT` では加算しない
- ロングノートは終端時刻で判定し、終端オブジェクトの発音は行わない
- `AUTO` / `AUTO SCRATCH` / `MANUAL` のいずれでも、再生音声はリアルタイムトリガ方式を使用する
- `--play-volume` は演奏レーン系、`--bgm-volume` は非演奏レーン系へ適用する
- `SC` / 地雷 / `LNOBJ` 終端抑止対象イベントは音声トリガ対象から除外する
- 未定義・ファイル欠落・デコード失敗の `#WAVxx` 参照は無音として扱う（デバッグ用に `missingSampleToneSeconds` オプションで代替トーンを有効化できる）

### SCROLL/BPM/STOP 互換ポリシー

- `SCROLL 0` で同一レーン・同一描画セルに複数ノートが重なる場合、先行ノートを基準位置に置き、後続ノートは判定ラインから遠ざかる側（上方向）へ順に積み上げる
- `SCROLL < 0` は「逆走表示の忠実再現」ではなく「ノート接近表示の維持」を優先し、描画距離は `abs(distance)` で扱う
- `SCROLL` の可視探索は `MAX_SCROLL_LOOKAHEAD_BEATS`（`4 * 64` beat、`packages/player-tui/src/tui/tui.ts`）で上限を設ける
- BPM×`100001` + `STOP` 補正を含むギミックでも、BPM 表示は内部時刻計算で使用する値をそのまま採用する
- beatoraja 固有の描画バグ依存譜面は互換対象外とし、現時点では再現モードを実装しない
- 上記ポリシーの回帰は `packages/player-tui/src/tui/lane-stacking.test.ts`・`packages/chart/src/timelines.test.ts`・`packages/player-tui/src/bga.test.ts` で検証する

## イベント位置の扱い

- `data` は 2文字単位で分割し、`00` は空イベント
- `data` は最初の空白文字で打ち切り、それ以降の文字列は無視する
- ID の文字種に含まれない文字は枠を消費せずに読み飛ばし、奇数個目の末尾の 1 文字は捨てる
- 位置は `position: [numerator, denominator]` として保持
- `denominator = トークン数`
- `numerator = トークンの0始まりインデックス`

## 文字コード

- BOM 付き UTF-8 / UTF-16LE / UTF-16BE を最優先で採用
- BOM がない場合は `#CHARSET` 宣言を解決（対応エンコーディングに正規化できた場合のみ）
- ASCII のみのファイルは UTF-8 として扱う
- 厳密 UTF-8 検証（マルチバイト列を含み fatal デコードに成功）を通れば UTF-8 とみなす
- 上記以外は `shift_jis`, `utf8`, `euc-jp`, `latin1` をスコアリングして推測
- この判定は `@be-music/parser` の `decodeBmsText` に一本化されており、CLI / TUI / Web のすべてが同じ結果になる

## stringifier ルール

- `position` の分母情報から小節内解像度を決定
- 同一小節・同一チャンネルでは分母の最小公倍数を採用
- `--maxResolution` 指定時は上限で打ち切り
- bmson から読んだ譜面は、BMS で書き方が異なる部分を変換する: ロングノートは `5x` / `6x` 上の `#LNTYPE 1` のペアにして `ln_type` / `t` から `#LNMODE` を出力し、地雷の値は base36 のダメージに（サンプルは `#WAV00` に）、`judge_rank` は `#DEFEXRANK` にし、百分率の `total` は `#TOTAL` として出力しない。詳細は [BMSON 仕様 — BMS と bmson の相互変換](./bmson-spec.ja.md#bms-と-bmson-の相互変換)

## 制御構文の評価ルール

- `parser` は制御構文を `bms.controlFlow` として保持し、パース時には分岐を確定しない
- 分岐はプレイごとに 1 回、明示的な draws（`drawRandomOutcomes` で引いた `RandomDraws`）で決める。評価器は `@be-music/chart` の `evaluateControlFlow` だけで、parser の `resolveBmsControlFlowWithDraws` が有効ブロックを展開し、`bms.controlFlow` を持たない解決済みの譜面を作る。ホストは再生や描画の前に解決し、解決済みの譜面と draws をエンジンに渡す（[プレイヤー仕様 — 制御構文の扱い](./player-spec.ja.md#制御構文の扱い)）
- `#RANDOM n` / `#SWITCH n` は `1..n` の整数を生成して選択値にする
- `#SETRANDOM n` / `#SETSWITCH n` は選択値を固定する
- `#IF` チェーンは現在の RANDOM 選択値で分岐し、`#ELSEIF` / `#ELSE` は先に成立した枝がある場合は無効
- `#SWITCH` チェーンは `#CASE` / `#DEF` を評価し、`#SKIP` で `#ENDSW` まで打ち切る
- `#SWITCH` では `#SKIP` がない場合、後続 `#CASE` / `#DEF` にフォールスルーする
- ヘッダ行は LR2 や beatoraja と同じくファイル順に適用する。選ばれた分岐内の定義は、前にある同じヘッダのトップレベル行に勝ち、後にあるものに負ける。パーサは後のトップレベル行に上書きされる分岐内のヘッダに印（`overriddenByLaterHeader`）を付け、解決時にはそれを適用しない。繰り返せるヘッダ（`#STP`、`#WAVCMD`、`#LNOBJ`）は加算する
