---
'@be-music/player-web': patch
---

Result screen fixes:

- The clear lamp keeps to the judge ruleset's own lamps: under LR2 and IIDX a full combo is the top lamp (no PERFECT or MAX), and under LR2 a DEATH clear is NORMAL, as LR2 awards HARD only for its HARD-family gauges. A beatoraja result takes its lamp by the same rule as the other families, so a clear with every note a PERFECT lights MAX instead of PERFECT.
- An LR2 result skin lit the NORMAL lamp (op 103) for every clear with a BAD or POOR, whatever gauge it was cleared on, and FULL COMBO from the BAD / POOR count alone. It now lights the play's own lamp on LR2's lamps: EASY (102) for an EASY or ASSIST EASY clear, HARD (104) for a HARD or EX HARD clear, FULL COMBO (105) for a full combo.
- A full combo counts every note as its max combo for any play, as it already did in AUTO, even when the combo the engine published reached fewer notes.
- Under the LR2 judge ruleset the POOR count folds the empty POORs in, as LR2's readout does, so a BP recorded from the result counted them twice. The result now also carries the POOR judgments alone (`judgedPoor`) for the record to read; the POOR the screen shows is unchanged.
- The built-in and LR2 result screens played the fail jingle on a clear, or the clear jingle on a failure, when the theme had neither the verdict's jingle nor a generic one. They now play the verdict's jingle, else the generic one, and nothing otherwise, as LR2 and beatoraja do.
