---
'@be-music/skin-beatoraja': minor
---

Recognize JSON skins when a theme folder is opened directly without a `skin/` ancestor, while ignoring unrelated settings files. Match LuaJ module loading for missing, nil-returning, false-returning, and recursive modules, and execute `dofile` on every call with all of its return values so skin fallback logic and repeated layout scripts behave as authored.

Correct LIFT and HIDDEN+ offsets in skin coordinates and supply the lane-cover offset so decorations and cover readouts move in the direction authored by the skin. Respect the LIFT enable switch when computing those offsets.

Preserve parent positional offset IDs as `BeatorajaDestinationGroup.parentOffsets` when expanding relative judge combo numbers, so they follow the judge word during LIFT and judge-position changes.
