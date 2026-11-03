---
'@be-music/player-browser': patch
---

The stage no longer stays blank for good after the browser loses its WebGPU device (Safari logging `RangeError: Length out of range of buffer` and then `GPUDevice.createCommandEncoder: Unable to make command encoder.`): the player stopped handing Pixi a device it created itself, which turned off Pixi's device-loss recovery, and now raises the texture dimensions on the devices Pixi creates (no longer the adapter's maximum buffer size, which nothing needs), so a lost device is replaced with the same limits and the stage draws again.
