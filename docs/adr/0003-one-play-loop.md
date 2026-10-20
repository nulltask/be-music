[日本語版](./0003-one-play-loop.ja.md)

# One play loop with judge strategies

`@be-music/player` runs every play through one **play loop**: the clock and tempo, audio scheduling, input commands, the hold after the chart, interrupts, replay recording and the finish. Manual, auto and replay play differ only in the **judge strategy** plugged into it. The two drivers it replaces were about 70 % copies of each other and had drifted: the hold after the chart, `#EXRANK` changes, ESC and replay tempo were each missing or different in one of them, and every engine feature had to be written twice.
