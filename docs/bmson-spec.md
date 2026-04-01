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
- [x] `info` 拡張項目: `back_image`
- [x] `info` 拡張項目: `eyecatch_image`
- [x] `info` 拡張項目: `banner_image`
- [x] `info` 拡張項目: `preview_music`
- [x] `sound_channels[].notes[]` の `x`
- [x] `sound_channels[].notes[]` の `y`
- [x] `sound_channels[].notes[]` の `l`
- [x] `sound_channels[].notes[]` の `c`
- [x] `lines` を使った `measure` / `position` 解決
- [x] `x <= 0` (または未指定) ノートを BGM (`01`) として解釈
- [ ] `version` の妥当性検証（`null` のエラー化、未指定時の legacy 扱い方針）
- [ ] `version` の互換判定を SemVer で行う方針の明文化
- [ ] `info.init_bpm` 未指定を fatal error として扱う
- [ ] `info.title` / `artist` / `genre` など必須情報の欠損時エラー方針
- [ ] `lines` 未指定時に 4/4（`resolution * 4` 間隔）を前提とした補完規則の固定
- [ ] `sound_channels[].name` の拡張子フォールバック探索（`.wav`/`.ogg`/`.m4a`）
- [ ] `sound_channels[].name` のパス正規化（`\` と `/`）およびディレクトリトラバーサル防止
- [ ] `sound_channels[].notes[]` 同一 pulse で `c=true/false` が混在する場合の優先規則
- [ ] `bpm_events` 同一 `y` 多重定義時の「末尾優先」正規化
- [ ] `stop_events` 同一 `y` 多重定義時の「加算」正規化
- [ ] `bga.bga_header` の同一 `id` 多重定義時に後勝ちで解釈
- [ ] `info.title_image` の受理と IR への保持
- [ ] `subartists` の `key:value` 形式（`music:`/`chart:` 等）の保持規則
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
- [x] `bga.bga_header` 出力
- [x] `bga.bga_events` 出力
- [x] `bga.layer_events` 出力
- [x] `bga.poor_events` 出力
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
- [ ] `bga.bga_events` の再生反映
- [ ] `bga.layer_events` の再生反映
- [ ] `bga.poor_events` の再生反映
- [ ] 動画 BGA 再生
- [ ] 同一 pulse の処理順（Note/BGA → BPM → STOP）を仕様通りに固定
- [ ] 同一 `y` の `bpm_events` を末尾優先で適用
- [ ] 同一 `y` の `stop_events` を加算して適用
- [ ] sound channel スライス規則（`c` と restart）に基づく再生
- [ ] 同一 slice に playable/BGM が混在する場合の BGM 破棄規則
- [ ] 異なる sound channel の同一 `(x,y)` ノートを Layered Note として合成再生

## 実装が読み込むフィールド (parser)

- ルート: `version`, `lines`, `resolution`(互換), `info`, `sound_channels`, `bpm_events`, `stop_events`, `bga`
- `info`: `title`, `subtitle`, `artist`, `genre`, `subartists`, `chart_name`, `level`, `init_bpm`, `resolution`, `mode_hint`, `judge_rank`, `total`, `back_image`, `eyecatch_image`, `banner_image`, `preview_music`
- `sound_channels[].notes[]`: `x`, `y`, `l`, `c`
- `bga`: `bga_header`, `bga_events`, `layer_events`, `poor_events`

## bmson -> BMS/BMSON 中間表現 (`@be-music/json`) 変換

- `version` を `bmson.version` に保持
- `lines[].y` を `preservation.bmson.lines` に保持
- `info.resolution` を `bmson.info.resolution` に保持
- 互換としてルート `resolution` も読み取り、`info.resolution` がなければ採用
- `sound_channels[i].name` を `resources.wav[key]` に登録
- `key = base36(i + 1)` を2桁化
- `notes[].y` を分数位置へ変換してイベント化
- `notes[].l/c` は `events[].bmson.l/c` として保持
- `lines` が存在する場合、`lines` 区間を小節として `measure` と `position` を算出
- `notes[].x` のユニーク値を昇順採番し、BMS互換チャンネルへ写像
- `x` 未指定時は `11`
- `bpm_events` は `resources.bpm` + チャンネル `08` へ変換
- `stop_events` は `resources.stop` + チャンネル `09` へ変換
- `bpm_events` の元配列は `preservation.bmson.bpmEvents` に保持
- `stop_events` の元配列は `preservation.bmson.stopEvents` に保持
- `sound_channels` の元配列は `preservation.bmson.soundChannels` に保持
- `bga` は `bmson.bga` へ保持

## BMS/BMSON 中間表現 -> BMSON 変換 (stringifier)

- `@be-music/chart` の `eventToBeat` 相当の beat 解決から `y = round(beat * resolution)` を生成
- `bmson.version` を `version` に出力 (未指定時は `1.0.0`)
- `bmson.info.resolution` を `info.resolution` に出力 (未指定時は `240`)
- `bmson.info` の拡張項目 (`subartists`, `chart_name`, `judge_rank`, `total`, 画像/プレビュー系など) を出力
- `preservation.bmson.lines` があれば `lines[].y` として出力
- `preservation.bmson.lines` がない場合は IR の小節長から `lines` を自動生成
- `sound_channels` は `wav` キー単位で出力
- `03` / `08` チャンネルから `bpm_events` を生成
- `09` チャンネルから `stop_events` を生成
- `events[].bmson.l/c` を `sound_channels.notes[].l/c` へ反映 (未指定時は `l=0`, `c=false`)
- `preservation.bmson.bpmEvents` / `stopEvents` / `soundChannels` が現在の IR と整合する場合は、それらの配列構造を優先して再出力
- `bmson.bga` が存在すれば `bga` を出力

## 一次参照に対する未対応/非互換

- 未対応: bmson で未使用の未知ルートキーの透過保持

## y -> position 変換規則

- `lines` がある場合:
  - `measure = y` が属する `lines` 区間のインデックス
  - `position = [y - lineStart, lineEnd - lineStart]`
- `lines` がない場合:
  - `beat = y / resolution`
  - `measure = floor(beat / 4)`
  - `position = [round(y) % (resolution * 4), resolution * 4]`
