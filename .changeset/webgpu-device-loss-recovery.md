---
'@be-music/player-browser': patch
---

Safari no longer shows a blank stage under WebGPU (`RangeError: Length out of range of buffer`, then `GPUDevice.createCommandEncoder: Unable to make command encoder.`). On Apple GPUs Pixi made the multisampled render texture the built-in skins draw into a transient (memoryless) attachment, and Safari's WebGPU failed the command buffer rendering into it and restarted its GPU process, losing the device; the player now keeps those textures stored. The player also stopped handing Pixi a device it created itself, which had turned off Pixi's device-loss recovery, and raises the texture dimensions on the devices Pixi creates instead, so the stage comes back after a lost device.
