---
'@be-music/player-browser': patch
---

Fall back to still images for missing video BGA, and blend beatoraja skin codes 4 and 9 with beatoraja's factors: an opaque texel now matches beatoraja exactly on WebGL and WebGPU (code 9 was an absolute difference and code 4 a premultiplied multiply). Transparent texels leave the canvas as it was and both codes keep the canvas opaque, so they no longer punch holes through it. On WebGPU the two codes now draw at all; they had fallen back to the normal blend.
