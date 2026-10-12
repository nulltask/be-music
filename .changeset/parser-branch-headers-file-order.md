---
'@be-music/parser': patch
---

Fix a header defined inside a taken `#RANDOM` / `#SWITCH` branch overriding a later top-level definition of the same header: branch lines were replayed after the whole file, so they always won. Header lines now apply in file order, as LR2 and beatoraja apply them; the parser marks a branch header that a later top-level line overrides (`overriddenByLaterHeader`) and resolving the control flow skips it. Repeatable headers (`#STP`, `#WAVCMD`, `#LNOBJ`) still add up.
