# Changesets

Since `be-music` is released individually for each package, add `.changeset/*.md` to the PR containing changes.

## Release-note scope

Compare unreleased commits with `git log --oneline origin/main..origin/devel` and check existing entries before adding notes. Keep one changeset per package, describe changes from that package's perspective, and merge related notes into clear paragraphs or list items. Keep each paragraph on one unwrapped line.

Include completed features, bug fixes, performance improvements, and public runtime dependency updates. Exclude development dependency updates, tooling-only changes, and unfinished work. Use `minor` for new exports, subpaths, and public APIs; use `patch` for fixes, internal refactors that need a release, and dependency updates. If a package has both kinds of change, use `minor` and describe both in its entry. Packages affected only by bumped workspace dependencies receive the generated dependency note rather than a duplicate feature summary.

`pnpm release:status` previews the version plan without changing package versions. `pnpm release:version` consumes the entries and writes package versions and CHANGELOGs; run it only when preparing a release. The configured changelog formatter writes one commit-prefixed release note per changeset and one consolidated dependency-version line.

## Usual flow

1. Change package in feature branch
2. Run `pnpm changeset` and record the changed package and bump type.
3. Merge feature PR into `devel`

## Release flow

1. Run `pnpm release:version` in `devel`
2. Commit each generated `packages/*/package.json` and `packages/*/CHANGELOG.md`
3. Create release PR for `devel -> main`
4. When merging PRs, GitHub Releases are created individually for packages whose versions have increased.

`@be-music/player-terminal` and `@be-music/chart-audio-renderer` have SEA archives attached to their individual releases. Other public packages receive changelog-based GitHub Releases. Private packages are versioned and receive CHANGELOG entries, but no GitHub Release or npm publication.

The private repository root `package.json` remains at `0.0.0`; releasable versions are tracked in `packages/*/package.json`.
