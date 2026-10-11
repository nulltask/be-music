---
'@be-music/player-web': minor
---

The play screen can use the skin SDK's touch layout: pass `layoutMode: 'touch'` in the gameplay view options and the be-music skins get wide, equal-width lanes across most of the stage, a slightly lower judgement line, and no BGA. Notes, lane beams, touch zones, and the skin's `frame.layout` all follow the touch lanes. The 24 / 48 KEY modes, themes, and a host `skinlessChromeRenderer` keep the standard layout. Default `'standard'` leaves play unchanged.

- Synesthesia's judgement tally no longer slides up under the header when there is no BGA monitor (touch layout, 48 KEY).
- Lattice's onset ripples no longer start from the stage's top-left corner when there is no BGA monitor.
