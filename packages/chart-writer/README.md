[Japanese version](./README.ja.md)

# @be-music/chart-writer

Writers that stringify the Be-Music JSON intermediate representation ([`@be-music/chart-source`](../chart-source/README.md)) to `.bms` / `.bmson`. The package also ships the `bms-stringify` CLI.

## Usage

Convert JSON to BMS/bmson from the repository root:

```bash
pnpm run stringify chart.json chart.bms --format bms
pnpm run stringify chart.json chart.bmson --format bmson
```

## Compatibility

- Output BMS/bmson from intermediate representation (JSON)
- Stable reproduction of bar resolution using `position: [numerator, denominator]`
- Output bmson extension information (`info` extension, `bga`, `notes.l/c`)
- Preserve BMS source structure when the stored `preservation` layer still matches the normalized events
