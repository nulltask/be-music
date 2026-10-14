---
'@be-music/chart': patch
---

Compute chart and play fingerprints about 20-25% faster: the canonical JSON writer now works out each object shape's key order once instead of filtering, sorting and quoting the keys of every note, and the bucket of each event's channel is looked up once per channel instead of once per event. The fingerprints are unchanged (checked on 5,537 real charts).
