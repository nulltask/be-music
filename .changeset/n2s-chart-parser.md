---
'@be-music/chart-parser': minor
---

Read Nanasi Groove 2 `.n2s` charts (Toy Musical 3). `parseN2SBytes` opens the encrypted "ZEXA" container and parses the PMS file inside as `parseBMSBytes` would; `readN2SArchive` lists a container's files and `isN2SArchive` recognizes one. `parseChartFile` dispatches `.n2s` files to it. The package now depends on `fflate` for the container's zlib streams.
