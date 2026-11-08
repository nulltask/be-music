[Japanese version](./README.ja.md)

# @be-music/player-engine

The shared rules and playback engine of Be-Music: one play loop (manual, auto, replay), judgment, scoring, gauges and clear lamps, best records, course runs and NONSTOP, the replay format, and the runtime contracts hosts plug into. The terminal player, the browser player and the Leaderboard all use it.

See the [Player implementation specification](../../docs/player-spec.md), the [Architecture](../../docs/architecture.md#the-engine-judge-core-and-one-play-loop), the [Replay specification](../../docs/replay.md) and [Courses and dan certification](../../docs/course.md).

## What it provides

- Shared `autoPlay()` / `manualPlay()` engine for terminal and browser runtimes: one play loop with manual, auto and replay judge strategies over a deterministic judge core (see [Architecture](../../docs/architecture.md#the-engine-judge-core-and-one-play-loop))
- UI and input signal buses for lane flashes, POOR BGA commands, frame snapshots, pause, restart, and high-speed changes
- Shared note extraction for playable notes, legacy long notes, `#LNOBJ`, FREE ZONE, mines, and invisible notes
- Shared judgment windows, dynamic `#EXRANKxx` changes, score, groove gauge, scroll-distance, BGA timelines, and result summaries
- Browser-safe entries next to the engine root: `signals`, `lanes`, `display`, `ruleset`, `replay`, `records` and `course` (see [Player spec — Entry points](../../docs/player-spec.md#entry-points))
- `ruleset`: the vocabulary hosts, skins and the Leaderboard share: gauges, clear lamps, BP and the score (`ScoreSummary`, `computeScoreRate`, the DJ Ranks, LR2's money score)
- `course`, `records` and `replay`: course runs, the NONSTOP pipeline and the course stage rules; best records per judge ruleset; the replay format, its recorder and its simulator

The engine imports neither audio rendering nor Node output. A Node host sets `createAudioSession` from [`@be-music/player-node-audio`](../player-node-audio/README.md).

## FREE ZONE (`17` / `27`)

- Other than 9KEY and the 24KEY / 48KEY keyboard modes, it is treated as FREE ZONE.
- Do not create an independent lane, but draw on top of the scratch lane (`16` / `26`).
- The note length is fixed at a quarter note.
- Since it is not subject to judgment, it is not included in `TOTAL` / `EX-SCORE` / `SCORE`.
- When determining 9KEY or 24KEY / 48KEY, `17` / `27` is treated as the normal lane note.

## Score and judgment

- Judgment type: `PERFECT`, `GREAT`, `GOOD`, `BAD`, `POOR`
- `FAST` / `SLOW` is added only when pressing `GREAT` / `GOOD` quickly or slowly.
- A blank keystroke without a corresponding unjudged note fires LR2-style empty POOR: it does not change judgment counters, score, EX-SCORE, or combo, but it applies the empty-POOR gauge delta and triggers POOR BGA.
- EX-SCORE:
  - `PERFECT = +2`
  - `GREAT = +1`
- SCORE (200000 points):
  - Judgment base points 150000 + Combo additional points 50000
  - `BAD` / `POOR` does not add points, disconnects the combo
