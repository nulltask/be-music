[English version](./README.md)

# @be-music/chart-writer

Be-Music の JSON 中間表現（[`@be-music/chart-source`](../chart-source/README.ja.md)）を `.bms` / `.bmson` へ文字列化します。`bms-stringify` CLI も含みます。

## 使い方

リポジトリのルートから JSON を BMS/bmson に変換します。

```bash
pnpm run stringify chart.json chart.bms --format bms
pnpm run stringify chart.json chart.bmson --format bmson
```

## 対応状況

- 中間表現(JSON) から BMS/bmson を出力
- `position: [numerator, denominator]` を使って小節解像度を安定再現
- bmson 拡張情報 (`info` 拡張, `bga`, `notes.l/c`) を出力
- `preservation` layer が normalized event と一致している場合、BMS source 構造を優先して再出力
