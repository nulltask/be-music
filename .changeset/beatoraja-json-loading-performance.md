---
'@be-music/skin-beatoraja': patch
---

Load beatoraja JSON skins faster by deriving the header from the parsed skin.

Index Lua files once during theme discovery and reuse module lookups across skins in the same directory.
