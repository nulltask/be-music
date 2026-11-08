[English version](./README.md)

# @be-music/chart-audio-renderer

BMS、bmson、Be-Music JSON の譜面をレンダリングして `.wav` / `.aiff` を出力します。`bms-audio-render` CLI と単一実行ファイル (SEA) のビルドを含みます。

## 使い方

リポジトリのルートから譜面をレンダリングします。

```bash
pnpm run audio-render chart.bms out.wav
pnpm run audio-render chart.bms out.aiff --sample-rate 48000
```

## 対応状況

- BMS / bmson / JSON 入力に対応
- 出力形式 `.wav` / `.aiff`
- サンプル読込: `WAV` / `MP3` / `OGG` (Vorbis/Opus) / `OPUS`
- 小節長 / BPM / STOP を反映
- LR2 系の 100001 倍 BPM ギミック値を時刻解決で処理
- `#VOLWAV`、`#xxx97` / `#xxx98`、bmson `notes.c`、`#WAVCMD 01 xx vv`、`#EXWAVxx v` の volume scaling を反映

## SEA (Single Executable Applications)

```bash
# chart-audio-renderer の SEA バイナリを生成
pnpm run audio-renderer:sea

# 生成物
./packages/chart-audio-renderer/dist-sea/be-music-audio-render chart.bms output.wav

# Node 実行ファイルを明示する場合
pnpm run audio-renderer:sea --node-binary /path/to/node
```

- Node.js 26+ が必要です。
- SEA 生成は built-in の `--build-sea` を使用します。
- `@be-music/chart-audio-renderer` の release に SEA zip を添付します。
