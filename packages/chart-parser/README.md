[Japanese version](./README.ja.md)

# @be-music/chart-parser

Parsers for `.bms` / `.bme` / `.bml` / `.pms` / `.bmson` and Be-Music JSON charts, producing the intermediate representation of [`@be-music/chart-source`](../chart-source/README.md). The package also ships the `bms-parse` CLI.

## Usage

Convert BMS/bmson to JSON from the repository root:

```bash
pnpm run parse chart.bms chart.json
```

## Compatibility

- Preserves BMS header/object lines/control syntax
- Interpret `#WAVxx` / `#BMPxx` / `#BPMxx` / `#STOPxx` / `#TEXTxx`
- Contains BMS extension headers (`#PREVIEW`, `#LNTYPE`, `#LNMODE`, `#LNOBJ`, `#VOLWAV`, `#SCROLLxx`, `#VIDEOFILE`, etc.)
- Interpret bmson's `info` / `lines` / `sound_channels` / `bpm_events` / `stop_events` / `bga`, and beatoraja's `scroll_events` / `key_channels` / `mine_channels` extensions
- BMS text character code guessing (`Shift_JIS`, `UTF-8`, `EUC-JP`, `latin1`, etc.)
- bmson `info.init_bpm` is required by the parser; missing or invalid values fail early instead of falling back to `130`
- The beatoraja bmson extensions are mapped through the `mode_hint` lane resolver as beatoraja reads them: `mine_channels` become mines that preserve per-mine `damage`, and `key_channels` become hidden (invisible) notes

See the [BMS implementation specification](../../docs/bms-spec.md), the [bmson implementation specification](../../docs/bmson-spec.md) and the [Bemuse implementation specification](../../docs/bemuse-spec.md).
