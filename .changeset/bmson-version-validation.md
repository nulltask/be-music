---
'@be-music/chart-parser': patch
---

Reject null, malformed, unsupported and missing legacy bmson versions before interpreting chart data. Support stable 1.0.0 with optional SemVer build metadata and provide conversion guidance instead of silently treating v0.21 as the modern format.
