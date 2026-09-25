---
'@be-music/audio-renderer': minor
'@be-music/player': minor
'@be-music/player-tui': patch
'@be-music/player-web': patch
---

Reproduce LR2's negative-BPM reverse-scroll gimmick (#134).

Real LR2 (verified against the OpenLR2 decompilation, hitkey's command memo, and LR2's own
changelog) never runs time backwards: it integrates note times at |BPM| and, from the first
negative `#BPMxx` event on, mirrors the display/judge clocks around that point while its event
pump freezes — the chart visibly scrolls backwards forever, and nothing behind the reversal ever
sounds or gets judged.

- The timing resolver now integrates negative `#BPMxx` slots at `Math.abs(bpm)` (previously
  dropped) and exposes the first negative event as `TimingResolver.reversal`.
- The player engine freezes judging (presses, empty POORs, miss sweeps, mines, holds) and
  realtime audio at the reversal; post-reversal notes end the run unjudged instead of being
  swept into POORs. UI frames carry a mirrored `displayBeat` / `displaySeconds` clock.
- The TUI grid and the web scenes scroll from the mirrored clock; BGA freezes at the reversal.
- Playlogs record `chart.reversalTimeUs` so re-simulations apply the same cutoff; the offline
  audio renderer and the web chart preview drop triggers behind the reversal.
- Documented deviations from LR2 (see docs/bms-spec.md): the run ends at the chart's end instead
  of soft-locking until ESC; `#BPMxx 0`, undefined slot references, and a negative `#BPM` header
  keep their previous validated handling where real LR2 degenerates.
