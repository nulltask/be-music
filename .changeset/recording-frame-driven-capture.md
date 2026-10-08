---
'@be-music/player-web': patch
---

Fix gameplay recordings dropping below 60 fps.

`captureStream(fps)` samples the canvas on its own timer, which drifts against the render loop: a 60 fps capture of a 60 fps scene measured about 54 fps, with regular one-frame gaps. The recorder now captures with frame rate 0 and requests a frame on every animation frame (thinned to the `fps` option), so it takes exactly the frames the scene painted — measured at 60.0 fps with no gaps. Browsers without `requestFrame` keep the timer-driven capture.
