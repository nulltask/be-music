---
'@be-music/chart': minor
---

Add `resolveChartMainBpm(chart)`: the BPM the most judged notes sit at (beatoraja's `MAINBPM`), counting a tap and a long-note head once and a CN / HCN tail too, with ties going to the BPM reached first. It is the reference HS-FIX needs for charts whose BPM × N + STOP gimmicks skew any time average.
