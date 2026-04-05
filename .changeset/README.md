# Changesets

Since `be-music` is released individually for each package, add `.changeset/*.md` to the PR containing changes.

## Usual flow

1. Change package in feature branch
2. Run `pnpm changeset` and record the changed package and bump type.
3. Merge feature PR into `devel`

## Release flow

1. Run `pnpm release:version` in `devel`
2. Commit each generated `package.json` and `CHANGELOG.md`
3. Create release PR for `devel -> main`
4. When merging PRs, GitHub Releases are created individually for packages whose versions have increased.

`@be-music/player` and `@be-music/audio-renderer` have SEA zips attached to individual releases, and only changelog-based GitHub releases are created for other packages.
