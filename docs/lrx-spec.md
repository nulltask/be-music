[日本語版](./lrx-spec.ja.md)

# LRX implementation specification

LRX is the chart format of plugout4 -ARCADE EDITION-. Open the `.lrs` sequence as the chart and keep its companion XML files and media in the same folder tree.

<details>
<summary>Table of contents</summary>

- [References](#references)
- [Support summary](#support-summary)
- [Files and encoding](#files-and-encoding)
- [Header and timing](#header-and-timing)
- [Lanes and sound](#lanes-and-sound)
- [BGA and conversion](#bga-and-conversion)

</details>

## References

- [Observed plugout behavior and Be-Music differences](./format-compat.md#7-lrx)
- [ADR 0043 — LRX as a source format](./adr/0043-lrx-charts.md)
- [ADR 0044 — plugout ruleset](./adr/0044-plugout-ruleset.md)

## Support summary

| Operation | Support                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| Import    | Browser and terminal load `.lrs` and its companions.                                |
| Playback  | Shared timing, note and audio model. The browser also composites extended BGA cues. |
| JSON      | Preserves the `lrx` extensions.                                                     |
| Export    | BMS and bmson writers are available. LRX writing is unsupported.                    |

## Files and encoding

| File   | Contents                                           |
| ------ | -------------------------------------------------- |
| `.lrs` | `information`, `sound` mappings and `n` events     |
| `.lrh` | Optional header with the same stem                 |
| `.lrm` | Optional `image` / `movie` mappings and BGA events |

The loader looks for `moviepath` in the header, then in the sequence, and defaults to `_movie.lrm`. The byte parser accepts UTF-16LE and UTF-16BE with a BOM, recognizes BOM-less UTF-16 starting with `<`, and otherwise decodes UTF-8. The LRX reader uses element names and attributes in document order.

Use `parseLRXBytes` or `parseLRX` from `@be-music/chart-parser` when the caller already has the companion files. The Node `parseChartFile` adapter reads them from disk. [Parser implementation](../packages/chart-parser/src/core/lrx.ts)

## Header and timing

The `.lrh` supplies title, subtitle, genre, artists, images, `lrslevel` and difficulty (`category` 0–4 maps to 1–5). It also supplies `lanetype` and display BPMs. The `.lrs` supplies rank (default 2) and positive TOTAL. Other header fields stay in `BeMusicJSON.lrx`.

An `n` element uses `c` for channel, `s` for start tick, `e` for end tick and `p` for the value. There are 480 ticks per beat.

| Channel | Use                  |
| ------- | -------------------- |
| 300     | Bar line             |
| 301     | BPM                  |
| 302     | STOP in milliseconds |
| 309     | End of play          |

The first BPM event sets the starting tempo. Without one, the parser tries `startbpm`, then `basebpm` and the shared default if the selected header value is absent or nonpositive. A STOP uses the BPM in effect on its tick, including BPM changes on that tick. Bar lines define measure positions at their written ticks. They leave the tick duration intact.

Without an end event, playback ends three seconds after the last sound starts. Be-Music waits for any note that still needs judgment. [Play-end implementation](../packages/chart-model/src/lrx-play-end.ts)

## Lanes and sound

| `lanetype` | Be-Music layout            |
| ---------- | -------------------------- |
| 0 / 1      | 7 / 5 KEY                  |
| 2 / 3      | 14 / 10 KEY                |
| 4          | 9 KEY (PMS-STD)            |
| 5 / 6      | 10 / 14 KEY with a warning |

The recognized `lanetype` sets the layout even if some lanes are empty. The parser looks at the channels in use when that header value is missing or unknown.

- Lane events with `e > s` are charge notes. A lane event with `dmg="0"` sounds automatically and can become the lane’s keysound.
- A chain event (`cn="1"`) normally sounds relative to the press that triggers its predecessor. A chain event at the start of a lane is judged. The [compatibility notes](./format-compat.md#7-lrx) describe counting and empty presses.
- Channels 20–199 play background sounds. Among them, only channels 100–199 with nonzero `dmg` use the BGM bus. The keysound bus carries the other sounds, including hidden notes.
- Each event can set gain (`vol`), pan (`pan`), playback rate (`frq`), fades (`atk` / `rls`) and a sample window (`ost` / `len`). Multiple plays of a sample can overlap.

Choose the `plugout` ruleset for plugout judgment and gauge behavior. [Ruleset decision and evidence](./adr/0044-plugout-ruleset.md)

## BGA and conversion

Channels 200, 201, 202 and 299 map to the common base, layer, layer 2 and POOR planes. Extended cues retain layers 203 and 204, crops, transforms and animation keyframes in `lrx.bga`. The browser compositor uses a 1280 × 720 canvas. Other hosts use the common BGA planes. Channels 205–298 are skipped with a warning.

The parser maps LRX onto the shared event model with `sourceFormat: 'lrx'`. Be-Music JSON retains format-specific header values, note properties and extended BGA cues. Exporting to BMS or bmson can lose LRX-only properties such as chain playback and per-note audio. [JSON representation](./json-spec.md)
