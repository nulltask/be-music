[日本語版](./0002-scene-model-package.ja.md)

# A runtime-neutral scene-model package

The family-neutral models — library entries (charts, folders, courses), the browse state and its snapshot, play options, the **play state** (gauge, score and judge history, judge timing, lane covers, hi-speed), the **play result**, course view models and system sound sets — live in a new package, `@be-music/scene-model`. It sits above `@be-music/player` and below the skin packages: `skin-sdk`, `lr2-skin` and `beatoraja-skin` map these models to their own vocabulary (LR2-compatible op / number / text / timer ids, beatoraja ids), and `@be-music/player-web` renders them.

## Considered options

- **In `@be-music/player`.** Would mix screen concerns into the engine and rules package.
- **In `@be-music/player-web`.** The terminal player and the skin packages could not use them; the beatoraja state adapter ended up there and grew to 3,100 lines next to the renderer.
