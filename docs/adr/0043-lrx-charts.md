[日本語版](./0043-lrx-charts.ja.md)

# Read LRX charts as their own source format

plugout4 -ARCADE EDITION- ships its charts in LRX, the format of its player: per chart an `.lrs` sequence, an `.lrh` header beside it and a `.lrm` BGA file, all XML. Its rules differ from both BMS and bmson. Timing is in ticks, 480 to a beat, and bar lines are only drawn. A sample plays on to its end rather than until the next note of its channel, so it is neither BMS's monophonic slot nor bmson's slicing. Every note carries its own volume, pan, rate, envelope and slice. A long note's end is judged. The style comes from the `.lrh` `lanetype`, not from the lanes in use. See [format-compat §7](../format-compat.md#7-lrx).

Be-Music reads LRX as a third source format, `sourceFormat: 'lrx'`. It does not disguise LRX as BMS or bmson, which would bring in rules LRX does not have. The parser converts LRX onto BMS channels and Be-Music positions, so the timing, BGA and judging code keeps one event model. What LRX adds stays beside it: `BeMusicEvent.lrx` holds the per-note values and `BeMusicJSON.lrx` the header values. Code that branches on BMS or bmson treats LRX as neither.

The `lanetype` is a lane-mode input, like `.pms` and the bmson keyboard hints. `resolveChartPlayVariant` reads it before the lane rules, and the fingerprint carries it among its lane-mode inputs. Otherwise a 10-key chart that leaves the 2P scratch and first key empty would read as PMS. A long note is a CN, because plugout counts and judges its end.

This change reads the format. Per-note sound parameters reach every player as `TimedSampleTrigger` values: gain, balance, rate, window and ramps. Chain notes follow the press that sounds the note before them, as plugout plays them. Rank and TOTAL go through the existing rulesets as LR2 `#RANK` and an absolute TOTAL, and through the `plugout` ruleset as plugout reads them ([ADR 0044](./0044-plugout-ruleset.md)). Replays and the Leaderboard record an LRX chart's format as `lrx`. A BGA that the BMS channels cannot carry keeps its cues in `lrx.bga`. Each of these came in its own change.
