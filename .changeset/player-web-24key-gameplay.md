---
'@be-music/player-web': minor
---

Mount 24 KEY SP / 48 KEY DP charts in both skin families.

The beatoraja path accepts the `'24'` / `'24d'` play skins the parser already discovers: `pickBeatorajaPlayableVariant` maps the keyboard chart shapes onto them, the runtime adapter lights `KEYSONG_24K` / `KEYSONG_24K_DP` and addresses lanes through the `1000`-block timer bases, and the note layer places the 24 columns on the skin's leading lane slots (the 2P bank starting after the `note-su` / `note-sd` pair) with a piano white/black fallback tint. The new `chartPlayVariantForBeatorajaVariant` helper translates the skin's `'24d'` spelling into the engine's `'48'`.

The song-select scene resolves keymode index 6 / 7 for these charts, so beatoraja's MODE filter and `modeset` badge cover 24K and 24K-DP; the LR2 select / result ops fold them onto the closest same-shape op (SP → 7 keys, DP → 14 keys) since LR2's op space has no keyboard entry. The LR2 gameplay scene renders the lanes through the fallback playfield and no longer stamps out-of-range LR2 lane timers — a lane-24 bomb used to spill from the bomb bank (`50 + 24`) into the LN-hold bank at 70+.
