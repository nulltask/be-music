---
'@be-music/player-web': patch
---

Synesthesia's audio orb is now a charge cloud: five small dark orbs, each lit by how far its own slice of the spectrum jumps above its recent level (a one-frame flash with light shafts, then a glow that fades over about a second), so loud passages keep their peaks instead of washing out, hang in a GPU-simulated fluid of up to ~150,000 particles, drawn as the same square dots as the skin's other point clouds. The particles are drawn to or driven off the orbs by charge, with each particle tuned to one spectrum band, and flock through a coarse velocity/density grid so the cloud folds into smoky sheets lit pink to white near a flaring orb and deep indigo elsewhere. The select screen's foreground orb and the gameplay idle monitor use it; the old particle shell, its fibres, the smaller background orb and the black moon are gone.

Every other Synesthesia particle (floor, pyramids, rivers, dust, schools, star trails, hit sparks) now shares the cloud's finer texture: square points break into clusters of grains about a pixel across, and segments into trails of such grains, giving off about the same light as before.

Synesthesia's fish now carry a soft glow around their heads that brightens and spreads with the music (the ember school with the bass, the blue with the mids, the magenta with the highs), and flick up and flash white on every kick drum (an envelope that fires only on the attack of the lowest bands, gone within about 0.15 s), their glow blooming with them. The gameplay dust no longer flickers and teleports when the music's level changes its speed, and the gameplay floor and rivers no longer jump on entering a zone: they now move by accumulated travel, as the select screen already did.

Synesthesia's judgement line loses the bloom around it and stays a crisp filament; the beat now rises above it as an ember gradient that leaps up the lanes on each beat.

Synesthesia's 100-combo milestones now play in the middle of the BGA monitor even while a BGA is showing, instead of shrinking onto its top edge.

Synesthesia's floor now rolls into Perlin-noise hills that scroll with it and heave with the music's level, low rolling ground when quiet and tall ridges when loud, with the crests catching more light.
