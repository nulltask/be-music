---
'@be-music/app-play': patch
---

beatoraja Lua skins spend less time per frame: the bundled fengari-web is patched to clear Lua stack slots by assignment instead of `delete`, which left the stack array holey on every call and return. Evaluating ModernChic's per-frame Lua functions takes about 2.3x less time on the play skin and 3.2x less on the music select skin.
