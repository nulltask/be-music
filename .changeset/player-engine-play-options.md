---
'@be-music/player-engine': minor
---

Record source option snapshots and chart-timed option changes independently of scoring policy. Add lossless option-state parsing, reconstruction and diff helpers, and preserve changes made at one chart time.

Preserve independent AUTO SCRATCH sides through live judgment, replay recording and deterministic simulation, including long scratch notes. Expose helpers for resolving the assisted sides and channels.

Apply source-specific LEGACY NOTE and LN REMOVE before judging, retaining head timing and keysounds and recording the modifier and effective notes for replay simulation.

Expose EX-HARD independently of DEATH and HAZARD, with source-specific gauge choices, course conversion and replay parsing; reject EX-HARD as a new LR2 beta3 pick.

Expose source-specific ASSIST EASY and ASSISTED EASY gauge tables independently of input assists and retain their selected and effective names in replay.

Add beatoraja's judgment algorithms (combo, duration, lowest), CUSTOM JUDGE window rates, judge display timing and its automatic calibration, and LR2 CONSTANT scrolling, recorded in replays and applied again by replay simulation.

Add the source lane arrangements R-RANDOM, SPIRAL, H-RANDOM with its BPM threshold, LR2 and PMS CONVERGE, ALL-SCR, RANDOM-EX, S-RANDOM-EX, PMS playable RANDOM and S-RANDOM, LR2 SCATTER in both its distributed and corrected nine-key modes, and BATTLE's SYNCHRONIZE and SYMMETRY RANDOM, with source seeds and fixed lanes.

Add the beatoraja chart modifiers — mine REMOVE, ADD RANDOM, ADD NEAR and ADD BLANK, long-note generation (ADD LN, CN, HCN and ALL with a rate), scroll REMOVE and ADD, EXTRA NOTE, 7 TO 9 and LN MODE for undefined long notes — and LR2 EXTRA MODE, each recording the effective chart so a replay never rolls it again.

Add beatoraja's gauge CONTINUE, SURVIVAL TO GROOVE, BEST CLEAR and SELECT TO UNDER, and LR2's P.ATTACK and G.ATTACK gauges with their course behaviour; a grade course resets EASY and G.ATTACK to GROOVE.

Add LR2 SP TO DP (with DP TO SP and 9 TO 7 on double-play and nine-key charts) and D-BATTLE, beatoraja BATTLE and BATTLE AS, and two-player play (LR2 BATTLE, COUPLE on a double-play chart, and AC two-player play), each player judged on its own side with its own gauge; the replay records the 2P gauge and result (`play.gauge2P`, `results.secondPlayer`).

Add beatoraja PRACTICE: a chart range played from a chosen gauge, TOTAL and judge rank, without a replay.

Keep the last TOTAL declared across a stitched NONSTOP course, as LR2 does (stitching rules version 2; version 1 keeps the last stage's for existing replays).
