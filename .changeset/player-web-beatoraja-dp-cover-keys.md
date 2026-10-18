---
'@be-music/player-web': patch
---

On a beatoraja DP play, H, J and K played a 2P lane and moved HIDDEN+ at the same time, since the cover keys took them on every chart. A cover key that one of the play's lanes takes (its input token, from the key's `code`, in the chart's lane bindings) now plays only the lane: on a 14-key DP chart H / J / K are lanes, and PageUp / PageDown, Home / End, the wheel and the skin's cover buttons still move the covers. `keyboardEventToTokens` (`/runtime`) takes any object with a `code`.
