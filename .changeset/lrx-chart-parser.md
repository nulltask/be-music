---
'@be-music/chart-parser': minor
---

Read LRX charts (plugout4 -ARCADE EDITION-). `parseLRX` / `parseLRXBytes` convert an `.lrs` sequence with its `.lrh` header and `.lrm` BGA file onto BMS channels, keeping the LRX note and header values; `resolveLRXHeaderPath` and `resolveLRXMoviePath` name the files beside the `.lrs`. `parseChartFile` reads `.lrs` files with their siblings, and Be-Music JSON keeps the LRX values on a round trip.
