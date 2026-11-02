[日本語](./0032-chart-authored-visual-families.ja.md)

# 0032: Execute chart-authored HIDDEN, CHANGE-HS and CRAZY size / wave with Be-Music formulas

## Context

[ADR 0026](./0026-chart-authored-display-options.md) executes only HI-SPEED from `#OPTION` / `#CHANGEOPTIONxx` / channel `A6`. The nanasigroove manual and [hitkey's catalog](https://hitkey.nekokan.dyndns.info/option.htm) name the HIDDEN, CHANGE-HS and visual CRAZY options and describe them in a sentence each ("a note will appear if the timing approaches", "notes accelerate gradually"), but give no thresholds, curves, periods or random distributions ([research](../research/chart-authored-options.md)). Several catalog entries are themselves marked as guesses (`S-WARP`, `CHAOS`). Issue #843 asks to execute these families anyway, with documented Be-Music formulas and no parity claim, and the owner decided that an option the chart sets wins over the player's own setting for the same item.

Some visual CRAZY options (`STAR`, `SPIN`, `CLONE*`, `LINEMOVE*`, `YWAVE*`, `XYWAVE*`, `3DWAVE*`, `HIDJUDGE`, `DARK*`, `REVERSE`) change skin elements, the judgement line or the whole playfield's orientation. The four browser families and the terminal draw those parts in very different ways (LR2 / beatoraja skins author the judgement line and judge display).

## Decision

**Program profile version 2.** `ChartOptionProgram.version` becomes 2 and its states gain `hidden`, `changeHS`, `crazySize` and `crazyWave` beside `hiSpeed`. The compiler accepts exact-case modern `774:HIDDEN_*`, `774:CHANGE-HS_*` and `774:CRAZY_*` IDs of the families below, initially and on A6, in the existing order (equal-time cues in normalized IR order, later accepted operations winning). `HIDDEN_OFF` / `CHANGE-HS_OFF` clear their family; `CRAZY_OFF` clears both CRAZY subfamilies. A later value of a family replaces an earlier one. Replay parsing accepts version 1 with `hiSpeed` only and version 2 with the new fields, so a version-1 recording can never activate a version-2 family. Legacy `HID-*` / `CRA-*` aliases, `HIDDEN_M-SUDDEN` (a manual lane cover with F3–F5 keys) and the CRAZY options above stay diagnosed as `unsupported-option`.

**Formulas.** All are pure, deterministic functions in `@be-music/chart-model` (`resolveChartNoteVisual`). `p` is the note's approach progress: 0 on the judgement line, 1 at the lane top. `t` is the engine's display chart clock in seconds. "Hash" is a stable 32-bit hash of the lane channel, the note's beat (microbeats) and the stated seeds, mapped to [0, 1): the same note gets the same value on every frame, seek, replay and host.

| Family                             | Formula                                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HIDDEN`, `HIDDEN2`, `HIDDEN3`     | Opacity `clamp((p − f) / 0.05)`, `f` = 0.30, 0.45, 0.60                                                                                                                      |
| `SUDDEN`, `SUDDEN2`, `SUDDEN3`     | Opacity `clamp((c − p) / 0.05)`, `c` = 0.70, 0.55, 0.40                                                                                                                      |
| `HID-SUD`, `HID-SUD2`, `HID-SUD3`  | Visible band around `p` = 0.5: opacity `clamp((h − abs(p − 0.5)) / 0.05)`, `h` = 0.15, 0.10, 0.05                                                                            |
| `MIST`, `DEEPMIST`                 | Opacity 0.35, 0.10                                                                                                                                                           |
| `BLINK`, `BLINK2`                  | Opacity `0.5 + 0.5 cos(2πt / T)`, `T` = 2 s, 4 s                                                                                                                             |
| `STEALTH`                          | Opacity 0                                                                                                                                                                    |
| CHANGE-HS                          | Displayed progress `bend(p · k)` for `p > 0`, with `bend(x) = x + b · x(1 − x)` on (0, 1) and identity elsewhere. `k ≥ 1` always, so a note never appears below the lane top |
| `ACCEL`, `BRAKE`                   | `k` = 1, `b` = +0.5 / −0.5 (speed 1.5× / 0.5× at the line)                                                                                                                   |
| `LINE`, `LINE2`                    | `k = 1 + hash(lane)`; `LINE2` re-rolls every 2 s: `k = 1 + hash(lane, ⌊t/2⌋)`                                                                                                |
| `NAZO`, `NAZO2`, `LINENAZO`        | `k = 1.25 + 0.25 sin(2πt/4)`; `k = 1.5 + 0.5 sin(2πt/3)`; `LINENAZO` adds a per-lane phase `hash(lane)`                                                                      |
| `RANDOM`, `RANDOM2`                | `k = 1 + hash(note)`; `RANDOM2` also picks `b` = ±0.5 per note                                                                                                               |
| `COMBO-UP`, `COMBO-DN`, `COMBO-RD` | `r = min(1, combo / 200)`: `k = 1 + r`; `k = 2 − r`; `k = 1 + r · hash(note)`                                                                                                |
| `WARP`, `S-WARP`                   | `k = 1 + hash(⌊t/2⌋)` (the chart leaps every 2 s); `S-WARP` is the mean of `LINE` and `WARP`                                                                                 |
| `LINEACCEL`, `CHAOS`               | `LINE2` with `b` = +0.5; mean of `LINE2`, `NAZO` and `RANDOM`                                                                                                                |
| CRAZY size                         | `SMALL` 0.6×, `BIG` 1.4×, `FADEIN` `0.4 + 0.6(1 − p)`, `FADEOUT` `1 − 0.6(1 − p)`, `RD-SIZE` `0.5 + hash(note)`, about the lane centre and the note's bottom edge            |
| CRAZY wave                         | Horizontal offset in lane widths: `XWAVE` `0.25 · tri(2p)`, `XWAVE2` `0.5 · tri(3p)`, `tri` a unit-period triangle wave that is 0 at 0, so a note lands centred              |

HIDDEN and CRAZY read the displayed progress after CHANGE-HS, so they act on screen positions. A note that LR2's rules hold below the line reads as `p = 0`. A long note keeps its lane geometry: CHANGE-HS moves its head and tail, its head's HIDDEN opacity applies to the whole note, and CRAZY size / wave apply only to tap notes and mines.

**Precedence.** The chart's state wins over the player's own setting of the same item. These families have no user counterpart in Be-Music except lane covers: a user's SUDDEN+ / HIDDEN+ / LIFT cover stays drawn on top, and the chart's HIDDEN multiplies the user's visual CONSTANT opacity. A course's speed lock does not suppress them, as for HI-SPEED.

**Hosts.** The engine publishes the state in `PlayerUIFramePayload.chartOptions` on its chart clock, so pause holds it, seek looks it up statelessly and an LR2 reversal freezes it. The LR2 / built-in playfield (which also serves the be-music skin binding) and the beatoraja note layer place every note through `placeChartNoteVisual`. The terminal applies CHANGE-HS to grid rows and shows a note while its HIDDEN opacity is at least 0.5; it has no sub-cell size or offset, so CRAZY size and wave are not drawn there. NONSTOP places these states in each stage's exclusive window like HI-SPEED.

**Records.** These are display-only: they change no notes, judgments, gauge, score, fingerprints or replay inputs. Under [ADR 0031](./0031-assist-record-policy.md) they are neither assists nor modifiers of the judge, so they never change record eligibility. The effective program is recorded in `chart.chartOptions`; re-simulation ignores it.

## Consequences

Charts that use these families play with a defined, reproducible picture on every host, and old replays keep their original presentation. The numbers are Be-Music's and may differ from nanasigroove; a later change to a formula would itself need a new profile version, because a recorded program names families, not pictures. The CRAZY options that restyle the judgement line, judge display or playfield orientation remain diagnosed until each family can draw them; they are listed in the [support boundary](../research/chart-authored-options.md#support-boundary-decision). [ADR 0034](./0034-chart-authored-skin-level-options.md) executes them, with M-SUDDEN and the legacy aliases, at profile version 3.
