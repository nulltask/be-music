---
'@be-music/player-ui': minor
---

Draw the judge detail and the moved judgment on the Native skin, and honor charatbeatHDX BGA placement.

- Draw the judge detail above the judgment word on the Native skin, and leave the judgment counts, FAST / SLOW counts and timing meter out when the runtime's `hidesJudgeCounts` is set.
- Honor charatbeatHDX BGA placement in the Canvas playfield.
- Move the Native skin's judgment word, combo and play label by the layout's `judgeOffsetY`.
- The judgment display repaints its canvas only when its words change, and measures the combo's digits once per font instead of every frame.
