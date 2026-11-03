---
'@be-music/player-browser': minor
---

Screens now read the player's keys as control buttons: each side's seven keys and two turntable keys (from the lane keys), and new START / SELECT buttons (Q / W and O / P by default, as LR2's default key config). Scenes take them as `controls` (`ControlSettings`), and each key event a session gets names its buttons (`SessionKeyEvent.buttons`). The LR2 select screen's PLAY OPTION panel now opens with START as well as Space and steps its options on the player's 1P keys, which before stayed on Z … V whatever the key config said; beatoraja's NEXT_REPLAY and REPLAY follow the 1P keys 6 and 7 the same way. The built-in skins read LR2's keys, or beatoraja's when `controls.builtInScheme` says so.

In a play, Space is no longer the pause key: it is the 1P turntable's second key, as in LR2, and Pause and Tab (when no lane takes it) pause instead. START and SELECT are recorded in the replay with their physical keys.

New exports: `CONTROL_KEY_CONFIG`, `effectiveControlKey`, `resolveControlButtons` and the control types.
