export interface ReleasablePackageJSON {
  name: string;
  version: string;
  private?: boolean;
}

/**
 * Whether a package gets a GitHub Release: its version moved since the base, and it is not private. Private packages
 * (the player demo, the Leaderboard) are versioned by Changesets but never tagged (`privatePackages.tag: false` in
 * .changeset/config.json), so they get no release either.
 */
export function shouldReleasePackage(current: ReleasablePackageJSON, base: ReleasablePackageJSON | null): boolean {
  if (current.private === true) {
    return false;
  }
  return base?.version !== current.version;
}
