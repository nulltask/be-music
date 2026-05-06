---
'@be-music/beatoraja-skin': patch
---

Two skin-side improvements that make the bundled `skin/default/` theme load correctly on the first try:

- **`buildDefaultSkinConfigOptions(header)`** materializes a default `option` map from the skin header's
  `property[]` schema by picking the first item of each property. Lua skins whose `main()` branches on
  `skin_config.option["Play Side"]` (and friends) now hit a populated branch instead of falling through to an
  empty `source[]` when the host hasn't yet collected user picks.
- **Discovery prefers `skin/default/`-rooted entries** when more than one theme inside the dropped folder
  defines the same `play[1-9]+` variant. Without this, a community theme bundled alongside `default/` could
  shadow it and pull in dependencies (`require("main_state")` etc.) that our sandbox doesn't satisfy.
  Tiebreakers: JSON over Lua → `skin/default/` over other themes → lexicographically earlier path.
