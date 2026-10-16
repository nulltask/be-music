---
'@be-music/player': patch
---

A manual play's last UI frame was its last tick, published before its end-of-play rules ran, so it could miss what they changed: every play that is not interrupted now publishes a closing frame after them, at the time of its last frame (past the chart's end, or where a play that ended on failure stopped), so the time a host is shown never steps back.
