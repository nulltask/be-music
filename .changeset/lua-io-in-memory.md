---
'@be-music/skin-beatoraja': patch
---

A beatoraja Lua skin's `io.open` no longer returns a handle that accepts every write and reads back nothing. Files now live in memory for one skin evaluation: a file exists once the skin has written it and reads back what was written, and opening one it never wrote for reading fails as Lua specifies, so a skin's existence checks see the truth. Nothing is persisted.
