[日本語版](./n2x-spec.ja.md)

# n2x implementation specification

Nanasi Groove 2 uses `.n2x` files for chart lists and other data. Be-Music imports a chart list as one EXPERT course. The charts play in list order, while Toy Musical 3 offers the entries as choices for one stage. [Course specification](./course.md)

<details>
<summary>Table of contents</summary>

- [Support summary](#support-summary)
- [XML input and mapping](#xml-input-and-mapping)
- [Resolving stages](#resolving-stages)

</details>

## Support summary

| Operation        | Support                                        |
| ---------------- | ---------------------------------------------- |
| Read chart lists | Browser folder and archive import              |
| Play             | EXPERT course once all stages resolve          |
| Other n2x data   | Skin, mode and settings files yield no course. |
| Write n2x        | Unsupported                                    |

## XML input and mapping

`parseN2XCourseFile` from `@be-music/player-engine/course` accepts XML text, XML bytes, or a [ZEXA container](./n2s-spec.md#container). It reads the first file of a container. A list has a `bmslist` root with `bms` entries.

```xml
<bmslist>
  <bms><file>charts\first.n2s</file></bms>
  <bms><file>charts\second.n2s</file></bms>
</bmslist>
```

Each nonempty `file` creates a stage, including repeated entries. The parser ignores unlock conditions. It trims the path, replaces backslashes with slashes, and removes leading slashes. Until the browser finds a matching chart, the stage title is the chart file name without its extension.

The list file name without its extension names both the course and its group. For example, `amanas.n2x` becomes `amanas`. A list with no usable entries yields no course. [Parser implementation](../packages/player-engine/src/course/n2x.ts)

## Resolving stages

The browser resolves stage paths relative to the list’s folder. It first tries an exact, case-insensitive match, then takes the first library entry with a matching suffix at a folder boundary in either direction. A match with a file hash supplies the chart’s hashes, title and artist. These hashes let records and replays use the same chart identity as other course stages.

If any stage stays missing, the course remains visible but cannot start. There is no stage count limit. Toy Musical 3’s `free` list has more than 1,200 entries. Its `extra1`–`extra3` and `stagelist` lists reference developer charts absent from the shipped files, so those courses can appear without being playable. Import the list and its charts together, with the folder paths intact. [Path binding implementation](../packages/player-browser/src/collection/course.ts)
