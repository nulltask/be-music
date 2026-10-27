---
'@be-music/player-engine': minor
---

Add the play options of LR2, beatoraja and AC. Each is applied in live play, recorded in the replay and applied again by replay simulation:

- Independent AUTO SCRATCH sides, long scratch notes included, with helpers resolving the assisted sides and channels.
- Source-specific LEGACY NOTE and LN REMOVE, applied before judging with head timing and keysounds kept.
- EX-HARD independently of DEATH and HAZARD (not a new pick under LR2 beta3), and source-specific ASSIST EASY and ASSISTED EASY gauge tables, with their selected and effective names in the replay.
- beatoraja's judgment algorithms (combo, duration, lowest), CUSTOM JUDGE window rates and judge display timing, and LR2 CONSTANT scrolling.
- The lane arrangements R-RANDOM, SPIRAL, H-RANDOM with its BPM threshold, LR2 and PMS CONVERGE, ALL-SCR, RANDOM-EX, S-RANDOM-EX, PMS playable RANDOM and S-RANDOM, LR2 SCATTER in both its distributed and corrected nine-key modes, and BATTLE's SYNCHRONIZE and SYMMETRY RANDOM, with source seeds and fixed lanes.
- beatoraja's chart modifiers (mine REMOVE, ADD RANDOM, ADD NEAR and ADD BLANK, long-note generation with ADD LN, CN, HCN and ALL at a rate, scroll REMOVE and ADD, EXTRA NOTE, 7 TO 9 and LN MODE for undefined long notes) and LR2 EXTRA MODE, each recording the effective chart so a replay never rolls it again.
- beatoraja's gauge CONTINUE, SURVIVAL TO GROOVE, BEST CLEAR and SELECT TO UNDER, and LR2's P.ATTACK and G.ATTACK gauges with their course behaviour; a grade course resets EASY and G.ATTACK to GROOVE.
- LR2 SP TO DP (with DP TO SP and 9 TO 7 on double-play and nine-key charts) and D-BATTLE, beatoraja BATTLE and BATTLE AS, and two-player play (LR2 BATTLE, COUPLE on a double-play chart, and AC two-player play), each player judged on its own side with its own gauge; the replay records the 2P gauge and result (`play.gauge2P`, `results.secondPlayer`).
- beatoraja PRACTICE: a chart range played from a chosen gauge, TOTAL and judge rank, without a replay.

Replays record the source option snapshot and the chart-timed option changes (several at one chart time included) apart from the scoring policy, with lossless option-state parsing, reconstruction and diff helpers.
Options that only transform the chart are accepted under every judge ruleset, each with its own source's chart support: scroll REMOVE / ADD, mine REMOVE / ADD, beatoraja EXTRA, LR2 EXTRA MODE, 7 TO 9, automatic display timing, and the SP TO DP, D-BATTLE and BATTLE AS chart constructions. BATTLE keeps its LR2 meaning (two-player play), and the judge rules still come from the ruleset (#774).
A stitched NONSTOP course keeps the last TOTAL declared across it, as LR2 does (stitching rules version 2; version 1 keeps the last stage's for existing replays).
