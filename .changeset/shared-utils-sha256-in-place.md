---
'@be-music/shared-utils': patch
---

`sha256HexOfBytes` reads whole blocks from its input instead of copying the message into a padded buffer, and pads only the tail, about 6–14% faster on chart-sized inputs. Digests are unchanged.
