---
'@be-music/player-web-demo': minor
---

Gather the start screen into the drop card, and type the search in place:

- Under "Drop to load" the card offers the Leaderboard (the submit checkbox and the account) and folds the system check into one line that opens to the feature list, opening by itself when a required feature is missing; the separate system check panel is gone. A dropped folder opens in the select screen, or, when the drop added several folders, the folder list opens on the first of them.
- Clicking a skin's search box (or pressing `/`) lays the search field over the box, sized to it, and the skin's own text steps aside until the field is left; IME conversions narrow the list once committed, not while composing. On beatoraja skins, which have no box, the field at the foot of the screen filters the list.
- Only Synesthesia and Plain are offered among the built-in skins while the others are on hold; LR2 themes and beatoraja skins still load from a drop, `?skin=` or the skin ZIP URL.
- In fullscreen on Chrome and Edge, a short Esc press no longer just leaves fullscreen: the demo locks Escape with the Keyboard Lock API, so Esc quits the play as it does windowed and a long press leaves fullscreen. The help lists the hold-Backspace quit, which works in fullscreen on every browser, and the result screen's keys.
- The page UI (Debug Menu, overlays, dialogs, help, Leaderboard panels) uses the system UI font, form controls follow it, and the play canvas and fullscreen shell no longer draw a focus ring around the screen. The Japanese help no longer says scores are not saved.
