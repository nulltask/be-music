---
'@be-music/json': patch
'@be-music/parser': patch
'@be-music/player': patch
'@be-music/stringifier': patch
---

Support the beatoraja bmson long-note type extensions: `info.ln_type` and per-note `t` (1: LN, 2: CN, 3: HCN) are preserved in the IR, round-trip through JSON and bmson output, and drive the player's long-note mode (per-note `t` wins over `info.ln_type`). Charts that specify neither now default to LN (no tail release judgment, matching the LR2-aligned BMS default) instead of always being treated as CN.
