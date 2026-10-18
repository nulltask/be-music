---
'@be-music/player': patch
---

Fix manual and AUTO play behaving differently around the chart:

- AUTO play sent every note's keysound twice, once as background audio and once as the note's own keysound, so each note played doubled. Background audio is now the same in both modes: every sound that is not a play lane's, plus the keysounds of duplicate notes that lost their lane to another note.
- With an audio session, a manual play ran on past its chart by the lead-in, the widest BAD window and a second (the lead-in counted twice), while an AUTO play stopped at the chart's end: both now run on to the chart's end plus the widest BAD window and a second, on the play clock after the lead-in. Without an audio session or a hold, both still end as soon as the chart is over and judged.
- A manual play started its input runtime only once the lead-in was over, so keys pressed during it (ESC included) never reached the engine, and an ESC during the lead-in started the chart's audio before stopping it, while an AUTO play waited the whole lead-in out. Both now start their input before the lead-in and stop at the ESC, before the chart starts, recording the abort at the chart's start. Commands sent during the lead-in are taken as they arrive: a tempo or HIGH-SPEED change sets what the chart starts with, a view change is recorded at the chart's start, a pause holds the chart at its start, and lane input is dropped.
- A manual play's last UI frame was its last tick, published before its end-of-play rules ran: every play that is not interrupted now publishes a closing frame after them, at the time of its last frame, so the time a host is shown never steps back.
- AUTO play resolved its ruleset as if the chart had no `#EXRANKxx` changes, and its no-TUI trace reported windows without the `judgeWindowMs` override: it now resolves the same ruleset as manual play. The trace of an ESC-aborted AUTO play reports `reason:escape` instead of `reason:complete`.
