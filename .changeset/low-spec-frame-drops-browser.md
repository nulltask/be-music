---
'@be-music/player-browser': patch
---

Fix frame drops on slower machines by cutting the play screen's per-frame work. With the CPU throttled to a sixth of its speed, the built-in Synesthesia skin used to fall to about 40 fps and now holds 60 fps; at a quarter of its speed it went from 88 % to 53 % of the main thread and from 186 MB to 97 MB of garbage a second.

- Skin points (Synesthesia's floor, dust and powder, some 16,000 a frame) draw as instanced quads from one typed array per layer, 16 bytes a point, instead of Pixi particles rebuilt by a generated upload loop that also boxed doubles onto the global object.
- The floor lattice works out its projection inline, the bomb mask is redrawn only when the lanes move, and labels, styles and gauge beads are reused instead of rebuilt.
- The chrome, overlay and bomb layers are their own Pixi render groups, so a change in one no longer re-collects the whole screen's instructions.
- Reticle arms use square caps instead of round ones, which Pixi rebuilt as fans of segments every frame.
- The display-area readout, chart text and BPM-change warning no longer force a layout every frame on DOM skins.
- The built-in chrome's per-frame runtime keeps one shape, so skins reading it stay monomorphic.
