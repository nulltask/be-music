[Japanese version](./playlog.ja.md)

# Play log (play history) specification

This document describes the be-music play log ("playlog") — the play-history file recorded during gameplay — and
the tools that re-derive LR2 / beatoraja / IIDX results from it.

## Design principle: an input replay, not a result log

A playlog is deliberately **not** a list of judgments. Its canonical payload is:

1. **`chart`** — the resolved chart that actually scrolled past the player: post-`#RANDOM` control flow, post
   lane-shuffle (RANDOM / MIRROR / S-RANDOM), post DP-flip. Long notes are stored as single objects with a
   `timeUs` / `endTimeUs` pair, mines carry their resolved gauge damage, and the raw `#TOTAL` / `#RANK` /
   `#DEFEXRANK` metadata is preserved so each ruleset can apply its own defaults.
2. **`inputs`** — every raw key press / release that reached a playable lane, as
   `{ seq, timeUs, action: 'down' | 'up', channels }`. Inputs are never converted into judgments, never assigned
   to a note id, and phantom presses (the ones that fire LR2 empty POORs) are kept. The sort key is always
   `(timeUs, seq)` — `seq` disambiguates same-microsecond events.
3. **`play`** — the settings that affect scoring: mode (manual / auto), auto scratch, the selected gauge, the
   lane-arrangement options that produced the resolved chart, the debug judge-window override, and an ESC flag.

Judgments, EX-SCORE, combo, and gauge values live only in **`results`** — a regenerable cache keyed by ruleset id
(`native` holds the engine's own summary at record time). Because the canonical data is the input stream, a later
fix to any ruleset re-scores every previously recorded play without re-recording anything.

Timestamps are integer microseconds relative to chart zero (the same t = 0 the engine's note timing uses).

The TypeScript types, serializer, and defensive parser live in
[`packages/player/src/playlog/format.ts`](../packages/player/src/playlog/format.ts) (`@be-music/player/playlog`).
The recommended file suffix is `.bmplay.json`.

## Recording

Recording is engine-owned so every host (browser LR2 / beatoraja scenes, and any future TUI adoption) shares one
implementation. `PlayerOptions.onPlaylogRecorded` enables it: the engine snapshots its prepared chart, records
every judged press (`lane-input`) and release (`kitty-state` release) with `pressedAt`-corrected chart-relative
timestamps, counts empty POORs for the native cache, and hands the assembled `BeMusicPlaylog` to the callback right
before `autoPlay` / `manualPlay` resolves — including the ESC (aborted) exit. `PlayerOptions.recordPlaylog` carries
the host-declared settings the engine cannot know (selected gauge, lane-shuffle labels, DP flip, freeform
`native` extras).

In the browser player:

- The LR2 / default gameplay scene exposes the recorded log through `PixiGameplayResultData.playlog`.
- The beatoraja gameplay scene exposes it through `PixiBeatorajaGameplayView.getPlaylog()`.
- The demo auto-downloads the log as `<title>-<timestamp>.bmplay.json` when the result scene mounts, controlled by
  the Debug Menu's **Auto-save play history** checkbox (ON by default).

## Re-deriving LR2 / beatoraja / IIDX results

`simulatePlaylog(playlog, { ruleset })` (from `@be-music/player/playlog`) replays the input stream through one
ruleset; `simulatePlaylogRulesets(playlog)` runs all three. Each ruleset differs in judge windows, note selection,
long-note semantics, empty-POOR behavior, and gauge tables — the constants are documented per source in
[`packages/player/src/playlog/rulesets.ts`](../packages/player/src/playlog/rulesets.ts):

| aspect | LR2 (`lr2/1`) | beatoraja (`beatoraja/1`) | IIDX (`iidx/1`) |
| --- | --- | --- | --- |
| source | lr2oraja / OpenLR2 | beatoraja master | community measurements (iidx.org) |
| windows (NORMAL-rank) | ±18/±40/±100/±200 ms | ±15/±45/±112.5/late 210 · early 165 ms (7K, judgerank 75 %) | ±16.67/±33.33/±116.67/±250 ms |
| rank scaling | LR2 anchor interpolation, BAD fixed | linear × judgerank, MS fixed | none |
| note selection | Lowest + multi-BAD chain | Combo (default; duration / lowest / score selectable) | Lowest |
| long notes | all LN (deferred single judgment) | per-note LN / CN / HCN | all CN (HCN gauge when mode 3) |
| empty POOR window | early-only 1000 ms | late 150 / early 500 ms (7K) | unmeasured — beatoraja window used |
| money score | `(4·PG + 2·GR + GD) × 50000 / notes` | — | — (abolished in BISTROVER) |
| gauges | lr2oraja LR2 tables (death 2 %, guts < 32 % ×0.6) | beatoraja native tables | iidx.org tables (a-value recovery, ≤ 30 % half damage on HARD) |

EX-SCORE is PGREAT × 2 + GREAT × 1 everywhere; DJ LEVEL uses the IIDX ninths table. Charge-note rulesets count a
long note's head and tail as two judgment notes (`result.noteCount` reports each ruleset's denominator).

### Fidelity notes

- The LR2 ruleset follows lr2oraja, cross-checked against the OpenLR2 transcription; where the two disagree
  (missed-POOR threshold for LN heads, HAZARD table) the lr2oraja behavior is used.
- IIDX internals are not public. The judge windows, gauge tables, and DJ LEVEL boundaries are current community
  consensus; the empty-POOR window and CN release windows are unmeasured and use beatoraja's values as stand-ins,
  and the HCN gauge tick uses a fixed 200 ms interval instead of IIDX's measured 16th-note interval. Expect
  close — not bit-exact — reproduction.
- beatoraja niceties not modeled: PMS's one-empty-POOR-per-note rule, the PMS 200 ms charge-release margin, and
  per-mode gauge tables other than SEVENKEYS (the 7K gauge constants are used for every mode).
- Because the playlog stores the resolved chart, `#RANDOM` and lane-shuffle differences between players never
  affect re-simulation.

## CLI

`@be-music/player-tui` ships a second binary, `bms-playlog`:

```bash
pnpm playlog -- results/Song-2026-08-17T10-00-00-000Z.bmplay.json
```

```
RULESET        EX     RATE     DJ   PG     GR     GD    BD    PR    EPR   FAST   SLOW   COMBO  SCORE   GAUGE
be-music/native 1180  83.10%  AA   ...
lr2/1          1180   83.10%   AA   ...                                          ...    140000  96.0% GROOVE CLEAR
beatoraja/1    1174   82.68%   AA   ...
iidx/1         1102   77.61%   AA   ...
```

Options: `--ruleset=lr2,beatoraja,iidx|all`, `--gauge=<id>` (ruleset-scoped gauge override),
`--algorithm=combo|duration|lowest|score` (beatoraja note selection), `--json`.

## Versioning

`format: "be-music-playlog"`, `version: 1`. Unknown extra fields are ignored on parse so minor additions stay
readable; incompatible changes bump `version`. Ruleset result ids carry their own revision (`lr2/1` etc.) — a
corrected ruleset bumps its revision and simply re-simulates existing files.
