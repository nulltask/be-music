---
'@be-music/parser': patch
---

BMS object data lines (`#mmmcc:data`) are now truncated at the first whitespace character. Trailing text no longer fabricates note events (e.g. `junk` becoming `JU`/`NK` objects) or inflates the position denominator of the legitimate tokens before it.
