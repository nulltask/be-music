[日本語版](./0004-domain-rules-in-player.ja.md)

# Course, record and lamp rules live in @be-music/player-engine

Course runs (the stage plan, carry-in, giving up, the result), the NONSTOP pipeline (prepare, stitch, build the course replay), the course stage rules, clear lamps and BP, and best-record merging per judge ruleset are runtime-neutral rules in `@be-music/player-engine`, used by every host and by the Leaderboard. They had spread into the web layer, the demo and the Leaderboard: two NONSTOP pipelines that must agree for a run to verify, two clear-lamp rules, and course runs that only the web demo could play, so the terminal player could not run courses and every rule change had to be made in several places.
