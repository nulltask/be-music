---
'@be-music/app-play': patch
---

Expose HS-FIX including START BPM in Debug Menu, synchronize it with select screens, and persist the selected mode.

Add the four AC 34 display-area information choices and expose the existing per-side cover settings in Debug Menu, with saved preferences.

Restore each recorded AUTO SCRATCH side independently and apply older combined replay switches to both sides.

Expose the source-specific LEGACY NOTE and LN REMOVE choices in Debug Menu and save the selected modifier.

Apply AC 34's A-SCR & LEGACY NOTE preset in a single Debug Menu action while retaining both explicit settings in replay.

Offer EX-HARD for beatoraja and AC rules in Debug Menu, label HAZARD separately and reset unsupported choices when switching rulesets.

Offer ASSIST EASY for beatoraja and ASSISTED EASY for AC rules in Debug Menu.

Expose every new play option in Debug Menu with saved preferences, offering each ruleset only its own choices, and lock the ones a running play cannot change.

Play a battle mode on the converted chart's LR2 play skin, start PRACTICE again after each run, and keep a two-player result out of the records and the Leaderboard while still saving its replay.

Fix the Debug Menu's hi-speed controls overwriting a hi-speed the play changed: the classic speed list reset a 2.1 to 1, and the floating speed slider rounded a cover-coupled 2.2458 back to 2.25; each control now takes only an edit made on it, while its mode is in use.
