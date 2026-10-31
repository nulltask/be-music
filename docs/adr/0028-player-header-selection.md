[日本語](./0028-player-header-selection.ja.md)

# 0028: Make PLAYER header execution an explicit selection

## Context

The official BM98/BM98k manuals define PLAYER 2 as two-player/COUPLE and PLAYER 4 as BATTLE. Modern chart authors also use PLAYER 2 for ordinary SP, DP and PMS charts. In the original 2,748-file corpus, all 20 PLAYER 2/4 matches are PLAYER 2: eight resolve as PMS 9KEY, four as SP 7KEY and eight as beat double-side charts. Author readmes/subtitles explicitly identify 19 as SP, DP or 9KEY. The remaining TP chart has a separate DP sibling and a two-player chart credit. Default literal inference would change author-labeled modes. The [research notes](../research/player-header-modes.md) retain primary sources, all filenames and counts.

Be-Music already supports two independent judges and gauges. Its TWO-PLAYER option copies SP onto both sides but retains both banks of a double-side source. COUPLE must also retain an empty authored side instead of copying SP. Replay and skin selection must use the same decision.

## Decision

Keep OFF as the default and preserve stored choices. Add AUTO, labeled CHART HEADER in browser settings, and an explicit COUPLE option. AUTO interprets BMS PLAYER after branch selection; it does not override another explicit choice. It is inactive for bmson, non-LR2 rulesets, course stages and layouts outside beat 5/7/10/14KEY. This is a compatibility policy based on measured author use, not a claim that PLAYER 2 means single-player in the original format.

| Selection                             | Effective execution                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ |
| OFF                                   | Keep ordinary single-player interpretation                               |
| AUTO + PLAYER 2                       | COUPLE: each player owns its authored bank                               |
| AUTO + PLAYER 4                       | TWO-PLAYER: copy an SP source; retain both banks of a double-side source |
| AUTO + other/absent PLAYER            | OFF                                                                      |
| Explicit COUPLE/TWO-PLAYER/conversion | Existing availability rules, independent of PLAYER                       |

COUPLE supports LR2 beat layouts only. An SP source gets the corresponding 10/14KEY layout with an empty second side; no judged notes, mines, invisible notes or audio triggers are duplicated. Double-side sources retain their content. Each player has its own score, gauge and input. Course restrictions remain unchanged. PLAYER 4 double-side preservation is Be-Music's explicit policy because the primary manuals do not establish a rule for discarding independently authored 2P objects. Exact native bank-overwrite parity is not claimed.

Expose the deterministic `resolveEffectiveBattleMode` through the engine's lanes entry. Preparation and LR2 skin selection use it. AUTO is a request, never a recorded effective arrangement: replays record COUPLE/TWO-PLAYER/OFF. Parsing rejects AUTO in typed `play.battleMode`. Old replays and previous arrangements with absent mode retain OFF, regardless of the current preference or source header.

Replay simulation defaults to player 1 for COUPLE/TWO-PLAYER and accepts `player: 2` for the second side, applying its gauge and filtering canonical notes/inputs without mutating the replay. This corrects the previous combined-side simulation. Both local results and the shared replay remain available. Existing browser result routes skip single-player best records when a second player exists; online eligibility now rejects two-player plays with `two-player` rather than ranking half of the source chart or merging both players into one score. No new multiplayer leaderboard is introduced.

## Consequences

All 20 measured charts retain their default behavior. Header interpretation requires deliberate opt-in, including the seven charts explicitly labeled DP. The actual TP candidate completes as 240 notes per player, and canonical replay simulation reproduces both sides. PLAYER 2/4 syntax occurs in 20/2,720 BMS files (0.74%; 20/2,748 overall, 0.73%); only one has explicit two-player evidence (0.04% of either denominator). These are file-level signals, not 20 observed broken charts. Other #837 policy items remain open.
