[日本語版](./0005-public-entry-points.ja.md)

# Designed public entry points; breaking changes allowed before 1.0

Packages export designed entry points, not their file layout: `@be-music/player` exported 13 `core/*` subpaths that hosts imported directly, and `@be-music/player-web` re-exported scene internals. Until 1.0 we allow breaking changes to reach that shape, released as minor versions with migration notes in the changesets. The play-log format and the fingerprints (`bmfp0`, `bmcourse0`) are at revision 0 and not public yet, so they may change too; each change is deliberate, in its own pull request, with its specification, golden values and changeset updated.
