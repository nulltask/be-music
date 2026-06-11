---
'@be-music/parser': patch
---

Accept the real-world control-flow spelling variants `#END IF`, bare `#END`, and `#ELSE IF n` as `#ENDIF` / `#ELSEIF n`. Previously such charts left the `#IF` block unterminated, so a non-matching `#RANDOM` roll silently dropped every line after the misspelled directive.
