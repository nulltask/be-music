---
'@be-music/stringifier': minor
---

Preserve chart meaning when writing BMS and bmson.

- Write bmson keyboard-mode and scroll-event extensions.
- Preserve long notes, mines, hidden notes and their lane mappings when converting formats.
- Write BPM/STOP timing, judge rank, TOTAL and resolution-scaled bar lines in the target format's units.
- Omit branch headers overridden by later top-level definitions so regenerated files retain their effective values.

Migration: use `stringifyBMS`, `BMSStringifyOptions` and the canonical Be-Music JSON keys. External BMS directives and bmson keys retain their specified spellings.
