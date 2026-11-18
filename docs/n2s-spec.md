[日本語版](./n2s-spec.ja.md)

# n2s implementation specification

Toy Musical 3 stores its Nanasi Groove 2 charts in `.n2s` files. Be-Music opens the ZEXA container and parses the inner chart as PMS. [ADR 0042](./adr/0042-nanasi-groove-2-charts.md)

<details>
<summary>Table of contents</summary>

- [Support summary](#support-summary)
- [Container](#container)
- [Chart selection and playback](#chart-selection-and-playback)

</details>

## Support summary

| Operation | Support                                              |
| --------- | ---------------------------------------------------- |
| Import    | Browser library, terminal player and Node parser     |
| Playback  | BMS-family rules on the PMS layout                   |
| Export    | Standard chart formats. ZEXA writing is unsupported. |

## Container

`readN2SArchive` from `@be-music/chart-parser` reads version 1 containers, including encrypted and unencrypted entries.

| Block   | Contents                                        |
| ------- | ----------------------------------------------- |
| `ZEXA`  | Version, flags, archive ID and format string    |
| `DATA`  | One zlib stream per file                        |
| `INDEX` | Entry flags, offsets, sizes and Shift_JIS names |

The reader skips directory entries. When the header’s encryption flag is set, it decrypts names and inflated payloads with AES-128-CBC and trims the payload to its recorded plaintext length. The layout also serves [n2x chart lists](./n2x-spec.md). See the [compatibility evidence](./format-compat-bms.md#220-nanasi-groove-2-n2s-containers) and the [reader implementation](../packages/chart-parser/src/core/n2s.ts).

## Chart selection and playback

`parseN2SBytes` walks file entries in index order and takes the first `.pms`, `.bms`, `.bme` or `.bml` it finds. It descends into nested ZEXA containers as it encounters them, up to four levels below the outer container. A malformed container or a container with no chart raises an error.

The parser passes the extracted bytes to `parseBMSBytes`, which applies the normal BMS text encoding rules and returns the same chart data as the standalone payload. The `.n2s` extension counts as `.pms` for lane detection. The shipped five-button charts use a subset of the nine-button layout. The container and the extracted PMS have the same gameplay fingerprint. [BMS implementation specification](./bms-spec.md)
