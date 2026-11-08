[English version](./README.md)

# @be-music/chart-editor

BMS、bmson、Be-Music JSON の譜面をインポート・編集・エクスポートするライブラリと `bms-editor` CLI です。

## コマンド

`init`, `import`, `export`, `set-meta`, `add-note`, `delete-note`, `list-notes`

## 使い方

リポジトリのルートからエディタを実行します。

```bash
pnpm run editor import chart.bms chart.json
pnpm run editor add-note chart.json 0 11 1 2 01
pnpm run editor export chart.json chart.bms
```
