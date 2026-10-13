---
'@be-music/player': minor
---

Add `PlayerOptions.holdAfterChart` (`{ signal, onSettled? }`): a manual play stays open after its chart is over, so keys keep reaching the lanes (and the chart's trailing background sounds keep playing) while the host shows its outro. `onSettled` runs once when every note is judged and the judge windows have passed; the play then ends normally, with its summary and play log, when `signal` aborts. Without it a play still ends at the chart's end.
