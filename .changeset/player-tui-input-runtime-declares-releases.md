---
'@be-music/player-tui': patch
---

Once the terminal has answered the kitty keyboard protocol (or Windows' win32-input-mode) opt-in with a key event, every later play of the process declares that its input reports key releases, so the engine judges it as key-state input from its first key. The first play of a process still lets the engine detect it from the first `kitty-state` command.
