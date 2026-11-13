[Japanese version](./README.ja.md)

# @be-music/chart-editor

A chart editing library and the `bms-editor` CLI for importing, modifying and exporting BMS, bmson and Be-Music JSON charts.

## Commands

`init`, `import`, `export`, `set-meta`, `add-note`, `delete-note`, `list-notes`

## Usage

Run the editor from the repository root:

```bash
pnpm run editor import chart.bms chart.json
pnpm run editor add-note chart.json 0 11 1 2 01
pnpm run editor export chart.json chart.bms
```
