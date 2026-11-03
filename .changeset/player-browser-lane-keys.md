---
'@be-music/player-browser': minor
---

A play takes the player's own lane keys from its `laneKeys` setting. The host entry also exports `keyboardEventToTokens` and `PLAY_SCENE_KEY_CODES`, so a key config can read a key press as the token a lane takes and refuse the keys a play keeps for itself.
