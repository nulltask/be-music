[日本語](./bmson-unknown-fields.ja.md)

# Unknown bmson fields: evidence and preservation boundaries

Investigated 2026-10-31 for #837. This research changes no runtime code or preexisting audit manifests.

## Official specification

The [official specification at 668c4338](https://github.com/bemusic/bmson-spec/blob/668c4338cd7c64da2d2ec0f848c4ad58a3a881d9/doc/index.rst) describes JSON objects using Web IDL dictionaries. Its extension advice concerns new game modes (`mode_hint` changes without changing the underlying `version`) and new timing classes (follow BPM/STOP shapes and appropriate units). It does **not** explicitly require unknown-key round trips, define an arbitrary-field vendor prefix, or prescribe a serialization conflict policy. Keeping unrecognized JSON is consequently a Be-Music editing/interchange policy, not proof of a bmson playback obligation. `info.title_image` is explicitly defined in the prose despite being absent from the overview dictionary; it is a recognized official field.

The specification distinguishes invalid recognized values from absent ones, for example a missing `info.init_bpm` is fatal and a null `version` requires an error. Opaque preservation must not bypass those rules or execute an unrecognized timing class. A namespaced annotation object is a reasonable collision-avoidance recommendation, but no particular prefix should be presented as an official bmson requirement.

## beatoraja parser: unknown handling varies by scope

Inspected [jbms-parser at 8108cd54](https://github.com/exch-bms2/jbms-parser/tree/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/bmson), the source revision used by this repository's compatibility references. This is source-derived behavior, not an executable compatibility test.

| JSON scope                          | Java class                  | Unknown member handling evidenced by source           |
| ----------------------------------- | --------------------------- | ----------------------------------------------------- |
| Root                                | `Bmson`                     | `@JsonIgnoreProperties(ignoreUnknown=true)`           |
| `info`                              | `BMSInfo`                   | Same annotation                                       |
| `lines[]`                           | `BarLine`                   | Same annotation; legacy `k` is also a declared member |
| `bpm_events[]`, `stop_events[]`     | `BpmEvent`, `StopEvent`     | Same annotation                                       |
| `sound_channels[]`, its `notes[]`   | `SoundChannel`, `Note`      | Same annotation                                       |
| `bga`, its header and event objects | `BGA`, `BGAHeader`, `BNote` | Same annotation                                       |
| `scroll_events[]`                   | `ScrollEvent`               | No ignore-unknown annotation                          |
| `key_channels[]`, `mine_channels[]` | `MineChannel`               | No ignore-unknown annotation                          |
| Their `notes[]`                     | `MineNote`                  | No ignore-unknown annotation                          |
| `bga_sequence[]`, its `sequence[]`  | `BGASequence`, `Sequence`   | No ignore-unknown annotation                          |

[BMSONDecoder](https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java) creates an ordinary `ObjectMapper`, reads typed DTOs and returns no chart on an `IOException`. No global ignore-unknown setting or arbitrary-property storage was found. [Jackson 2.22.1](https://github.com/FasterXML/jackson-databind/blob/jackson-databind-2.22.1/src/main/java/com/fasterxml/jackson/databind/DeserializationFeature.java) enables `FAIL_ON_UNKNOWN_PROPERTIES` by default; [jbms-parser's build](https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/build.gradle) selects that dependency line. Thus the unannotated extension scopes can reject unknown members. A claim that beatoraja uniformly accepts, preserves, or executes unknown nested fields would be incorrect.

The decoder reads recognized members into gameplay structures. It provides no round-trip editor contract. `Note.t`, `Note.up`, `BMSInfo.ln_type`, scroll events and BGA sequences/conditions are recognized extensions, not arbitrary annotations. Shared `MineNote.damage` is accepted on hidden notes, but the hidden-note decoder reads only lane and pulse; it does not use damage as a mine effect.

## Complete census of the original 28 bmson files

All 28 files from `format-feature-usage.json` were reread directly from their recorded source paths. Every SHA-256 matched. All populated object scopes were inspected, including nested notes and BGA events. **No arbitrary unknown member was found: 0/28 bmson files (0.00%), 0/2,748 overall (0.00%).** This is a corpus result, not evidence that positive preservation fixtures are unnecessary.

| Scope              | Object nodes inspected | Keys actually present                                                                                                                                                                                                                |
| ------------------ | ---------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root               |                     28 | `bga`, `bpm_events`, `info`, `lines`, `sound_channels`, `version`; `key_channels` in 4 files                                                                                                                                         |
| `info`             |                     28 | `artist`, `back_image`, `banner_image`, `chart_name`, `eyecatch_image`, `genre`, `init_bpm`, `judge_rank`, `level`, `ln_type`, `mode_hint`, `preview_music`, `resolution`, `subartists`, `subtitle`, `title`, `title_image`, `total` |
| `lines[]`          |                 35,778 | `y`                                                                                                                                                                                                                                  |
| `bpm_events[]`     |                     29 | `bpm`, `y`                                                                                                                                                                                                                           |
| `sound_channels[]` |                 30,488 | `name`, `notes`                                                                                                                                                                                                                      |
| Sound notes        |                160,245 | `c`, `l`, `x`, `y`; `t`, `up` on 91,509 nodes                                                                                                                                                                                        |
| `bga`              |                     28 | `bga_events`, `bga_header`, `layer_events`, `poor_events`                                                                                                                                                                            |
| `bga_header[]`     |                     32 | `id`, `name`                                                                                                                                                                                                                         |
| `bga_events[]`     |                     28 | `id`, `y`                                                                                                                                                                                                                            |
| `poor_events[]`    |                      4 | `id`, `y`                                                                                                                                                                                                                            |
| `key_channels[]`   |                      4 | `name`, `notes`                                                                                                                                                                                                                      |
| Hidden notes       |                      4 | `damage`, `x`, `y`                                                                                                                                                                                                                   |

There are no STOP, scroll, mine, layer-event, BGA-sequence or sequence-frame nodes in these files. Their unknown-field behavior must be tested with authored fixtures. Recognized extension presence must not be counted as arbitrary unknown usage: `info.ln_type` appears in 20 files (18 values of 2, two values of 1); `t`/`up` appear in 13 files, all values being 0/false. `title_image` is present in all 28 info objects, with 14 nonempty values.

### Recognized but nonexecuted hidden-note damage

Each file below has one hidden note `{damage:0,x:8,y:85200}` in a channel named `thankyouforplaying.wav`. These four nodes are a preservation signal, **not four unknown vendor annotations**. The shared upstream DTO recognizes `damage`, while hidden-note execution ignores it. At investigation time Be-Music's hidden-note normalization explicitly omitted damage (`keepDamage=false`); retaining it opaquely must not create mine behavior.

- `gdbg_bms_package_2025/GdbG BMS Package 2025/えびです_GRAYSCALE_ogg_bmson/GRAYSCALE_7Key_A.bmson`
- `gdbg_bms_package_2025/GdbG BMS Package 2025/えびです_GRAYSCALE_ogg_bmson/GRAYSCALE_7Key_H.bmson`
- `gdbg_bms_package_2025/GdbG BMS Package 2025/えびです_GRAYSCALE_ogg_bmson/GRAYSCALE_7Key_LN.bmson`
- `gdbg_bms_package_2025/GdbG BMS Package 2025/えびです_GRAYSCALE_ogg_bmson/GRAYSCALE_7Key_N.bmson`

## Proposed Be-Music retention contract

These are implementation requirements derived from the requested editing behavior, not native requirements:

1. Attach a deep JSON-value map to each retained semantic node: root, info, channel, note, barline, timing event, BGA container/header/event/sequence/frame. Keep annotations with their node through sorting and mutation, rather than assigning them by a mutable array index.
2. Recognized fields are authoritative. Reserve all supported external keys even when their invalid values are dropped or defaulted. Never let an opaque map restore a malformed known property, defeat validation or overwrite an edited normalized value.
3. Preserve nested JSON data, including null, arrays, objects and scalar values, by value without aliasing source objects. Keep property names as data, including names that coincide with JavaScript prototype members. Do not treat strings as scripts, resource paths, commands, timing changes or judge modifiers.
4. Preserve supported vendor fields through their typed paths. Preserve other data opaquely without claiming that its native extension executes. Exclude arbitrary annotations from playback and semantic chart fingerprints.
5. State the boundary honestly: this covers **valid normalized nodes**. It does not promise restoration of rejected records, comments, duplicate JSON keys, original whitespace, source-text number spelling or precision beyond the parser's numeric representation. Deleting a node deletes its annotations. A normalized writer may reorder or canonicalize known content.

Local evidence is in `/tmp/bmson-unknown-corpus-scope-keys.json` (scope/key counts, types and per-file hash verification), `/tmp/bmson-unknown-primary/bmson-spec.rst` and the pinned parser source under `/tmp/bmson-unknown-primary/jbms-parser-8108cd54a19275810e1f5d2c9586f008eb6db95e/`. Original files and preexisting research data were not changed.
