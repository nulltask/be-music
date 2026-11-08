[English version](./README.md)

# @be-music/chart-parser

`.bms` / `.bme` / `.bml` / `.pms` / `.bmson` / Be-Music JSON の譜面のパーサで、[`@be-music/chart-source`](../chart-source/README.ja.md) の中間表現を出力します。`bms-parse` CLI も含みます。

## 使い方

リポジトリのルートから BMS/bmson を JSON に変換します。

```bash
pnpm run parse chart.bms chart.json
```

## 対応状況

- BMS のヘッダ / オブジェクト行 / 制御構文を保持
- `#WAVxx` / `#BMPxx` / `#BPMxx` / `#STOPxx` / `#TEXTxx` を解釈
- BMS 拡張ヘッダ (`#PREVIEW`, `#LNTYPE`, `#LNMODE`, `#LNOBJ`, `#VOLWAV`, `#SCROLLxx`, `#VIDEOFILE` など) を保持
- bmson の `info` / `lines` / `sound_channels` / `bpm_events` / `stop_events` / `bga` と beatoraja 拡張の `scroll_events` / `key_channels` / `mine_channels` を解釈
- BMS テキストの文字コード推測 (`Shift_JIS`, `UTF-8`, `EUC-JP`, `latin1` など)
- bmson の `info.init_bpm` は parser が必須扱いにし、欠落・不正値は `130` fallback ではなく早期 error にします
- beatoraja の bmson 拡張を beatoraja と同じ意味で `mode_hint` lane resolver 経由で map し、`mine_channels` は mine ごとの `damage` を保持した地雷、`key_channels` は隠し（不可視）ノートにする

[BMS 実装仕様](../../docs/bms-spec.ja.md)、[bmson 実装仕様](../../docs/bmson-spec.ja.md)、[Bemuse 実装仕様](../../docs/bemuse-spec.ja.md) を参照してください。
