---
'@be-music/player-web': patch
---

End a beatoraja play the way the LR2 and default gameplay scenes end theirs. A play cut short by its gauge emptying now fades its sound and picture out (for at least 1.5 s, or the skin's longer fade-out) before the result, where it used to jump to the result at once; a play that reaches its end holds for the same lead-out after the last note before the skin's fade-out; and an auto play that ends on its own runs the lead-out and fade-out too, instead of showing the result at once. Both families now take this timing from one shared policy.
