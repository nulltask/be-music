---
'@be-music/app-play': minor
---

Choose when plays go to the Leaderboard, and polish Options, Help and guest accounts.

- Options → Leaderboard → Submit when sends a play only when its EX-SCORE improves (a chart's first play is always sent), or every time. A play that is not sent says so on the result screen.
- Call guest accounts guests, and say that a passkey, Google or Discord keeps one.
- The Options dialog is regrouped so each tab holds one area: Play (Judge & gauge, Arrangement, Modifiers, Assist, Practice with the tempo, Replay / ghost), a new View tab (Hi-speed, Cover & LIFT, Effects, with Judged notes and Show invisible notes moved from the skin settings), Keys, Skin, Audio, Library (loading, records, the select screen's Sort and filters, courses, capture), Leaderboard, and Advanced (formerly Developer, now with the BGA video transcode). Every setting keeps its stored value.
- The Options dialog gives every control its own help instead of one entry shared by several (the 1P and 2P options, each compressor setting, each lane key and screen operation), shows a label's source as a badge (`Scroll` with `beatoraja`, `Normal HI-SPEED` with `AC 32 measured`), lays the 5 / 7 / 10 / 14 KEY keys out in 1P and 2P panes, and heads the Screens keys by screen.
- The Options dialog's help: a button's "?" sits inside it, right of its label, instead of wrapping onto a line of its own below the full-width button, and the help opens in the same black tooltip, pointing at the "?", as the header's icon buttons use.
- The Options dialog's tab bars no longer wrap onto a second line: the dialog is wide enough for them in English and Japanese, and on a screen too narrow the tab bar alone scrolls sideways and keeps the selected tab in view.
- Help's Keyboard tab draws a Mac keyboard on macOS (its caps, modifier order and key names such as Option, Command and Return) and a Windows keyboard elsewhere, and switches between a full-size keyboard and a laptop's, which has no navigation cluster or number pad and tucks the arrows into its bottom row. It starts on a laptop on macOS and on a full keyboard elsewhere.
- Help's Keyboard tab keeps the screen and key map pickers and the keyboard at the top of the panel while the lists of operations scroll under them, so the keyboard stays in view when pointing at a line far down the list. On a phone the screen picker scrolls sideways on its own instead of the whole panel.
- On a laptop keyboard, Help's Keyboard tab names a key the laptop lacks by the Fn combination that gives it and lights that combination: Fn+arrows for Home, End, Page Up and Page Down, fn+delete for a Mac's forward delete, and a Windows laptop's built-in number pad in the letter keys (Fn+M for Num 0 and so on). A key no combination gives, such as Pause on a laptop or the number pad on a Mac laptop, is marked "no key".
- The Play header shows the signed-in player's avatar beside their handle, as the other services' headers do; it was missing because the player did not pass the avatar from the Leaderboard account.
- The dev server isolates the page with `Cross-Origin-Embedder-Policy: credentialless` instead of `require-corp`, matching the deployed player, so Google Fonts and provider avatars load in development too.
- The dev server titles the player page and its web app manifest "Be-Music Play (Development)", so an installed development player's window tells itself apart from production and the preview.
