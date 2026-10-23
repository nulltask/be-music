---
'@be-music/player-engine': minor
---

Add a chart-start command gate so hosts can prepare the engine during loading and select a seek position without starting chart time or audio. Avoid notifying chart settlement twice when seeking to the end during an outro.

Keep course stage outcomes independently of replays so seeking turns the entire run into practice while preserving stage progression and gauge and combo carry. Reject replay export for practice courses.
