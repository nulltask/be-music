[Japanese version](./README.ja.md)

# @be-music/chart-audio-renderer

Offline audio rendering of BMS, bmson and Be-Music JSON charts to `.wav` / `.aiff`. The package ships the `bms-audio-render` CLI and a single executable (SEA) build.

## Usage

Render a chart from the repository root:

```bash
pnpm run audio-render chart.bms out.wav
pnpm run audio-render chart.bms out.aiff --sample-rate 48000
```

## Compatibility

- Supports BMS / bmson / JSON input
- Output format `.wav` / `.aiff`
- Sample loading: `WAV` / `MP3` / `OGG` (Vorbis/Opus) / `OPUS`
- Reflects bar length / BPM / STOP
- 100001 times the BPM gimmick value of LR2 series is processed by time resolution
- Applies `#VOLWAV`, `#xxx97` / `#xxx98`, bmson `notes.c`, `#WAVCMD 01 xx vv`, and `#EXWAVxx v` volume scaling

## SEA (Single Executable Applications)

```bash
# Build the chart-audio-renderer SEA binary
pnpm run audio-renderer:sea

# Build output
./packages/chart-audio-renderer/dist-sea/be-music-audio-render chart.bms output.wav

# When specifying the Node executable explicitly
pnpm run audio-renderer:sea --node-binary /path/to/node
```

- Requires Node.js 26+.
- SEA generation uses built-in `--build-sea`.
- The release of `@be-music/chart-audio-renderer` attaches the SEA zip.
