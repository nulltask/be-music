[English version](./bmson-spec.md)

# BMSON 実装仕様

この文書は、`packages/parser` / `packages/stringifier` が BMSON をどう扱うかを定義します。

## 一次参照

- 公式サイト: https://bmson.nekokan.dyndns.info/
- 公式 documents: https://bmson.nekokan.dyndns.info/documents/
- bmson format and specs v1.0 (Read the Docs): http://bmson-spec.readthedocs.org/en/master/doc/index.html
- Google Docs 仕様: https://docs.google.com/document/d/1ZDjfjWud8UG3RPjyhN-dd1rVjPaactcMT3PIODTap9s/mobilebasic?pli=1

## 対応状況の要約

- 対応レベル: 部分対応
- 方針: bmson 全仕様ではなく、BMS 相互変換と再生に必要な最小集合を優先

## 対応チェックリスト

### parser (bmson -> `@be-music/json`)

- [x] ルート: `version`
- [x] ルート: `info`
- [x] ルート: `lines`
- [x] ルート互換: `resolution` (`info.resolution` 未指定時のフォールバック)
- [x] ルート: `sound_channels`
- [x] ルート: `bpm_events`
- [x] ルート: `stop_events`
- [x] ルート: `bga`
- [x] `info` 拡張項目: `subartists`
- [x] `info` 拡張項目: `chart_name`
- [x] `info` 拡張項目: `mode_hint`
- [x] `info` 拡張項目: `judge_rank`
- [x] `info` 拡張項目: `total`
- [x] beatoraja 拡張 `info.ln_type` と note 単位 `t`（1: LN / 2: CN / 3: HCN）を IR に保持し、player の LN モード解決と stringifier 出力に使用
- [x] `info` 拡張項目: `back_image`
- [x] `info` 拡張項目: `eyecatch_image`
- [x] `info` 拡張項目: `banner_image`
- [x] `info` 拡張項目: `preview_music`
- [x] `sound_channels[].notes[]` の `x`
- [x] `sound_channels[].notes[]` の `y`
- [x] `sound_channels[].notes[]` の `l`
- [x] `sound_channels[].notes[]` の `c`
- [x] `lines` を使った `measure` / `position` 解決
- [x] `x <= 0` または `x` 未指定の note を BGM (`01`) として解釈
- [x] beatoraja `key_channels` extension を landmine channel として読み、note ごとの `damage` を保持
- [x] `info.back_image`, `info.banner_image`, `info.eyecatch_image` を unified `metadata.backBmp`, `metadata.banner`, `metadata.stageFile` へ mirror
- [x] 明示的な `lines: []` を barline suppression として扱い、`bmson.barlinesSuppressed` に保持
- [x] `lines` 欠落時は bmson 既定の 4/4 model として扱う
- [x] `info.total` 欠落・非数は bmson 既定値 `100`、負値は仕様どおり絶対値、`0` は保持（ライフバーが増えない）として扱う
- [x] `info.init_bpm` 欠落、0、負値、非数値は parse error として扱う
- [ ] `version` の妥当性検証（`null` のエラー化、未指定時の legacy 扱い方針）
- [ ] `version` の互換判定を SemVer で行う方針の明文化
- [ ] `info.title` / `artist` / `genre` など必須情報の欠損時エラー方針
- [ ] `sound_channels[].name` の拡張子フォールバック探索（`.wav`/`.ogg`/`.m4a`）
- [ ] `sound_channels[].name` のパス正規化（`\` と `/`）およびディレクトリトラバーサル防止
- [ ] `sound_channels[].notes[]` 同一 pulse で `c=true/false` が混在する場合の優先規則
- [ ] `bpm_events` 同一 `y` 多重定義時の「末尾優先」正規化
- [ ] `stop_events` 同一 `y` 多重定義時の「加算」正規化
- [ ] `bga.bga_header` の同一 `id` 多重定義時に後勝ちで解釈
- [ ] `info.title_image` の受理と IR への保持
- [x] `subartists` の `key:value` 形式（`music:`/`chart:` 等）の保持規則
- [ ] 未知ルートキーの透過保持

### stringifier (`@be-music/json` -> bmson)

- [x] `version` 出力 (`bmson.version`, 未指定時 `1.0.0`)
- [x] `info.resolution` 出力 (未指定時 `240`)
- [x] `info` 拡張項目 `subartists` の出力
- [x] `info` 拡張項目 `chart_name` の出力
- [x] `info` 拡張項目 `mode_hint` の出力
- [x] `info` 拡張項目 `judge_rank` の出力
- [x] `info` 拡張項目 `total` の出力
- [x] `info` 拡張項目 `back_image` の出力
- [x] `info` 拡張項目 `eyecatch_image` の出力
- [x] `info` 拡張項目 `banner_image` の出力
- [x] `info` 拡張項目 `preview_music` の出力
- [x] `lines` 出力 (`preservation.bmson.lines` 優先)
- [x] `lines` 自動生成 (IR 小節長ベース)
- [x] `sound_channels` 出力
- [x] `bpm_events` 出力 (`03` / `08` 由来)
- [x] `stop_events` 出力 (`09` 由来)
- [x] `notes.l` 出力 (未指定時 `l=0`)
- [x] `notes.c` 出力 (未指定時 `c=false`)
- [x] `notes.t` 出力 (beatoraja 拡張、ロングノートのみ)
- [x] `info.ln_type` 出力 (beatoraja 拡張)
- [x] `bga.bga_header` 出力
- [x] `bga.bga_events` 出力
- [x] `bga.layer_events` 出力
- [x] `bga.poor_events` 出力
- [x] `bmson.barlinesSuppressed` により明示的な `lines: []` を保持
- [ ] `bpm_events` 同一 `y` のイベントを「末尾優先」へ正規化して出力
- [ ] `stop_events` 同一 `y` のイベントを加算正規化して出力
- [ ] `info.title_image` の出力
- [ ] `sound_channels[].name` のパス区切り正規化と危険パス除去
- [ ] 未知ルートキーの透過再出力
- [~] `notes.x` の元値を厳密保持 (IR で lanes を再割当するため完全同一は保証しない)

### player / audio-renderer (bmson 再生挙動)

- [x] bmson 入力再生 (`parseChartFile` 経由)
- [x] `info.banner_image` を player の選曲画面 banner に使用
- [x] `info.preview_music` を player の選曲画面 preview に使用
- [x] `lines` を使った時刻解決
- [x] `resolution` を使った時刻解決
- [x] `bpm_events` を使った時刻解決
- [x] `stop_events` を使った時刻解決
- [x] `notes.c` によるサンプル継続オフセット解釈
- [x] `notes.l` を使ったロングノート終端解釈
- [x] `bga.bga_events` の shared BGA timeline 抽出
- [x] `bga.layer_events` の shared BGA timeline 抽出
- [x] `bga.poor_events` の shared BGA timeline 抽出
- [x] Browser player は shared BGA timeline 経由で bmson BGA の still / video asset を描画
- [ ] CLI/TUI の bmson header filename 向け BGA resource loading
- [ ] 同一 pulse の処理順（Note/BGA → BPM → STOP）を仕様通りに固定
- [ ] 同一 `y` の `bpm_events` を末尾優先で適用
- [ ] 同一 `y` の `stop_events` を加算して適用
- [ ] sound channel スライス規則（`c` と restart）に基づく再生
- [x] 同じ sound channel 内で playable ノートと BGM ノートが同じ `y` にある場合の BGM 破棄（parse 時に BGM ノートを捨てる）
- [ ] 異なる sound channel の同一 `(x,y)` ノートを Layered Note として合成再生

## 実装が読み込むフィールド (parser)

- ルート: `version`, `lines`, `resolution`(互換), `info`, `sound_channels`, `key_channels` (beatoraja 拡張), `bpm_events`, `stop_events`, `bga`
- `info`: `title`, `subtitle`, `artist`, `genre`, `subartists`, `chart_name`, `level`, `init_bpm`, `resolution`, `mode_hint`, `judge_rank`, `total`, `back_image`, `eyecatch_image`, `banner_image`, `preview_music`, `ln_type` (beatoraja extension)
- `sound_channels[].notes[]`: `x`, `y`, `l`, `c`, `t` (beatoraja extension)
- `key_channels[].notes[]`: `x`, `y`, `l`, `c`, `damage`
- `bga`: `bga_header`, `bga_events`, `layer_events`, `poor_events`

## bmson -> BMS/BMSON 中間表現 (`@be-music/json`) 変換

- `version` を `bmson.version` に保持
- `lines[].y` を `preservation.bmson.lines` に保持
- `info.resolution` を `bmson.info.resolution` に保持
- 互換としてルート `resolution` も読み取り、`info.resolution` がなければ採用
- `info.init_bpm` が欠落、または正の有限数ではない場合は document を reject
- `info.total` が有限数なら使い（負値は仕様どおり絶対値へ正規化）、それ以外は bmson 既定値 `100` を適用
- `info.back_image`, `info.banner_image`, `info.eyecatch_image` を normalized metadata image field に mirror
- `sound_channels[i].name` を `resources.wav[key]` に登録
- `key = base36(i + 1)` を2桁化
- `notes[].y` を分数位置へ変換してイベント化
- `notes[].l/c` は `events[].bmson.l/c` として保持
- `notes[].t`（1 = LN、2 = CN、3 = HCN）はロングノート（`l > 0`）のとき `events[].bmson.t` として保持し、`info.ln_type` は `bmson.info.lnType` に保持
- `lines` が存在する場合、`lines` 区間を小節として `measure` と `position` を算出
- `notes[].x` は `info.mode_hint` に従って次の順で BMS チャンネルへ写像
  1. `mode_hint` が空または未指定なら `beat-7k`（bmson 1.0.0 の既定値）として扱う
  2. `beat-5k`、`beat-7k`、`beat-10k`、`beat-14k`、`popn-5k`、`popn-9k`、`keyboard-24k`、`keyboard-24k-double` は固定のレーン表を使う（たとえば `beat-7k` は `x` 1〜5 を `11`〜`15`、6〜7 を `18`〜`19`、8 をスクラッチ `16` へ。キーボードの表は後述）
  3. `generic-Nkeys` は `x = 1..N` を左から順に `11` からの連続チャンネルへ写像
  4. それ以外の hint では、正の `x` のユニーク値を昇順に `11` からの連続チャンネルへ採番
- `x` が未指定、または `x <= 0` のノートは BGM (`01`)
- キーボード系 hint（beatoraja が読む Keyboardmania 風の 24 鍵 + ホイール）はすべての `x` に固定のレーンを与えるため、使わない鍵がある譜面でも別の鍵へずれない

  | `mode_hint`           | `x`     | チャンネル            | レーン                     |
  | --------------------- | ------- | --------------------- | -------------------------- |
  | `keyboard-24k`        | 1〜9    | `11`〜`19`            | 鍵 1〜9（C から）          |
  |                       | 10〜24  | `1A`〜`1O`            | 鍵 10〜24（B まで）        |
  |                       | 25 / 26 | `1P` / `1Q`           | ホイール上 / ホイール下    |
  | `keyboard-24k-double` | 1〜26   | `keyboard-24k` と同じ | 1P の鍵とホイール          |
  |                       | 27〜35  | `21`〜`29`            | 2P 鍵 1〜9                 |
  |                       | 36〜50  | `2A`〜`2O`            | 2P 鍵 10〜24               |
  |                       | 51 / 52 | `2P` / `2Q`           | 2P ホイール上 / ホイール下 |

  `keyboard-24k` / `keyboard-24k-double` の譜面は、使うレーンにかかわらず `24 KEY SP` / `48 KEY DP` として遊ぶ（プレイヤー仕様を参照）。BmsONE の `keyboard-48k` は 1 人用の 48 鍵レイアウトで 2 人用の `keyboard-24k-double` とは別物のため別名扱いせず、ほかの未知の hint と同じく手順 4 の位置ベースの採番になる

- レーン表にない正の `x` は `11` にフォールバックするため、レーン 1 に重なる
- `bpm_events` は `resources.bpm` + チャンネル `08` へ変換
- `stop_events` は `resources.stop` + チャンネル `09` へ変換
- `bpm_events` の元配列は `preservation.bmson.bpmEvents` に保持
- `stop_events` の元配列は `preservation.bmson.stopEvents` に保持
- `sound_channels` の元配列は `preservation.bmson.soundChannels` に保持
- `key_channels` entry は `sound_channels` の後に登録し、同じ `mode_hint` lane map で BMS landmine channel へ変換し、`events[].bmson.damage` を保持。event の値は key channel 用に登録した WAV スロットなので player はダメージとして読まず、`damage` のない地雷は既定の `4`（%）を与えます（不正な BMS 地雷値と同じフォールバック）
- `bga` は `bmson.bga` へ保持

## BMS/BMSON 中間表現 -> BMSON 変換 (stringifier)

- `@be-music/chart` の `eventToBeat` 相当の beat 解決から `y = round(beat * resolution)` を生成
- `bmson.version` を `version` に出力 (未指定時は `1.0.0`)
- `bmson.info.resolution` を `info.resolution` に出力 (未指定時は `240`)
- `bmson.info` の拡張項目 (`subartists`, `chart_name`, `judge_rank`, `total`, 画像/プレビュー系など) を出力
- `info.total` は `bmson.info.total`、bmson ソースなら `metadata.total` から出力する。BMS / JSON 譜面の `metadata.total` はゲージの絶対 TOTAL であり、bmson の `total` はプレイヤー既定 TOTAL（ノーツ数とルールセットに依存）に対する百分率なので出力せず、bmson 既定値 `100` に委ねる
- `info.judge_rank` は `bmson.info.judge_rank`、bmson ソースなら `metadata.rank` から出力する。BMS / JSON 譜面では、bmson の `judge_rank` が `#DEFEXRANK` と同じ単位（`100` = NORMAL）なので正の `#DEFEXRANK` をそのまま出力し、なければ整数の `#RANK 0`〜`4`（`metadata.rank`、ランク番号）を `33` / `67` / `100` / `133` / `167`（そのランクと同じ判定幅になる `#DEFEXRANK` 値。VERY EASY は beatoraja の judgerank `125` に合わせる。LR2 は NORMAL 扱い）へ変換する。それ以外の `#RANK`（範囲外や小数）は NORMAL 判定なので出力せず、bmson 既定値 `100` に委ねる。be-music の ruleset では、IIDX の判定幅は一致し、LR2 は NORMAL と `#DEFEXRANK` で一致（`#RANK 0`・`1`・`3` は `0.4ms` 以内、`#RANK 4` は広くなる）、beatoraja は bmson の `judge_rank` を `#DEFEXRANK` のように換算せず judgerank として直接使うため、どのランクも約 4/3 倍広くなる
- `preservation.bmson.lines` があれば `lines[].y` として出力
- `preservation.bmson.lines` がない場合は IR の小節長から `lines` を自動生成
- `bmson.barlinesSuppressed` が `true` の場合は `lines: []` を出力
- `sound_channels` は `wav` キー単位で出力
- `info.mode_hint` は `bmson.info.modeHint` があればそれを、なければ `24 KEY SP` / `48 KEY DP` の譜面は `keyboard-24k` / `keyboard-24k-double`、それ以外は `beat-<レーン数>k` を出力
- キーボード系 hint ではホイールも含め各レーンに上の表の固定 `x` を与えるため、再パースで同じレーンに戻る。ほかの hint では使っているレーンを `x = 1` から採番
- `03` / `08` チャンネルから `bpm_events` を生成
- `09` チャンネルから `stop_events` を生成
- `events[].bmson.l/c` を `sound_channels.notes[].l/c` へ反映 (未指定時は `l=0`, `c=false`)
- ロングノートの `events[].bmson.t` を `notes[].t` へ、`bmson.info.lnType` を `info.ln_type` へ反映
- `preservation.bmson.bpmEvents` / `stopEvents` / `soundChannels` が現在の IR と整合する場合は、それらの配列構造を優先して再出力
- `bmson.bga` が存在すれば `bga` を出力

### プレイヤーと変換ツールでの `judge_rank` の扱い

bmson 仕様は `judge_rank` の判定幅をプレイヤーに委ねています（既定値 `100` = プレイヤー自身の既定の判定幅）。仕様の説明例は LR2 の `#RANK 2`（NORMAL）の判定幅を使っています。プレイヤーと変換ツールの解釈は 2 つに割れており、どのプレイヤーでも同じ判定幅になる値はありません。

| `judge_rank: 100` の解釈          | プレイヤー                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NORMAL（`#RANK 2`）               | [Bemuse](https://github.com/bemusic/bemuse/blob/4bf3e7d98a44841b323741cc403ecb7b41618ade/packages/bemuse-notechart/src/loader/BmsonNotechartLoader.ts#L35-L43)、[Qwilight](https://github.com/thenist/Qwilight/blob/6d3887f6688a1f97c1fbe2bffd28feaedc9920b6/Qwilight/Compiler/BMSONCompiler.cs#L375)、[raindrop](https://github.com/zardoru/raindrop/blob/662dd11f05994f6f36493575b04ecb64b04dcd7b/src/NoteLoaderBMSON.cpp#L200-L215)、be-music の LR2 / IIDX ルールセット |
| EASY（`#RANK 3`。NORMAL は `75`） | [beatoraja](https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/BMSPlayerRule.java#L59-L66)（`judge_rank` を judgerank の割合としてそのまま使う。`#DEFEXRANK` は 0.7.3 から `100` = NORMAL になるよう換算している）、LR2oraja、bmz-player、be-music の beatoraja ルールセット                                                                                                                                |

| 変換ツール（BMS → bmson）                                                                                                                  | `#RANK 0`〜`4` の書き出し                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [BmsONE](https://github.com/excln/BmsONE/blob/bb3406eeb8f45d79350241f09bb897dd229ce3af/src/document/DocumentInfo.cpp#L119-L135)            | `40` / `60` / `80` / `100` / `120`（`#DEFEXRANK` は読まない） |
| [bms2bmson-python](https://github.com/bemusicscript/bms2bmson-python/blob/c83df681b6cd9d28f5dfccc9ee302e389e417b7b/bmx2bmson.py#L108-L122) | 書き出さない（既定値 `100`）                                  |
| be-music（`stringifyBmson`）                                                                                                               | `33` / `67` / `100` / `133` / `167`。`#DEFEXRANK` はそのまま  |

be-music は NORMAL の解釈（`100` = NORMAL）に従います。仕様の説明例と多くのプレイヤーに沿い、be-music で bmson に変換して読み直したときに判定幅が保たれるためです。その代わり、変換した譜面は beatoraja では約 4/3 倍広い判定になります。配布されている bmson 譜面は、ほぼすべて既定値 `100` のままです。

## 一次参照に対する未対応/非互換

- 未対応: bmson で未使用の未知ルートキーの透過保持

## y -> position 変換規則

- `lines` が 2 本以上ある場合:
  - `measure = y` が属する `lines` 区間のインデックス
  - `position = [y - lineStart, lineEnd - lineStart]`
  - 最後の小節線より後は、そこから 4/4 の小節（各 `resolution * 4` tick）として延長
- `lines` がない、または 1 本以下の場合:
  - `beat = y / resolution`
  - `measure = floor(beat / 4)`
  - `position = [round(y) % (resolution * 4), resolution * 4]`
