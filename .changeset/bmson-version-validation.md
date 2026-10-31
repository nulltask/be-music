---
'@be-music/chart-parser': patch
---

Reject null, malformed and unsupported bmson versions before interpreting chart data, and support stable 1.0.0 with optional SemVer build metadata. Read a missing-version legacy v0.21 chart by converting its fields and timing as Bemuse does, instead of treating it as the modern format; a missing version on a chart with only 1.0.0 fields is rejected as ambiguous.
