---
'@be-music/player-web': patch
---

Long song titles, artists, genres, and stat values in the built-in skins no longer get squeezed until they are unreadable: text is narrowed to at most 85% width, and anything still too long is clipped to its box and scrolls through it like a marquee (rests at the start, scrolls, rests at the end, then returns), including on screens that are not redrawn every frame. Synesthesia, Lattice, and Phantom share this through their Pixi helpers, with unfocused list rows clipped at the start instead of scrolling; Plain does the same with its own Canvas 2D code.

Also fixes text that ran outside its panel: the genre line on Synesthesia's result screen, and the BPM, gimmick, and other stat values (plus the list row facts and folder label) on Plain's screens.
