// The changelog lines `changeset version` writes (`.changeset/config.json` → `changelog`).
//
// A release line is the default one (`@changesets/changelog-git`): the changeset's commit and its summary. The dependency
// line differs: the default writes "Updated dependencies [commit]" once per changeset of every bumped dependency, which
// buries a package that depends on several busy workspace packages under dozens of hash-only lines. Here it is one line
// naming the new versions.

/** The parts of a changeset a changelog line reads. */
export interface ChangelogChangeset {
  summary: string;
  commit?: string;
}

/** The parts of a bumped dependency a changelog line reads. */
export interface ChangelogDependency {
  name: string;
  newVersion: string;
}

/** `- <commit>: <first line>`, with the summary's further lines indented under it (as `@changesets/changelog-git`). */
export function getReleaseLine(changeset: ChangelogChangeset): Promise<string> {
  const [firstLine, ...futureLines] = changeset.summary.split('\n').map((line) => line.trimEnd());
  let line = `- ${changeset.commit ? `${changeset.commit.slice(0, 7)}: ` : ''}${firstLine}`;
  if (futureLines.length > 0) line += `\n${futureLines.map((futureLine) => `  ${futureLine}`).join('\n')}`;
  return Promise.resolve(line);
}

/** One `- Updated dependencies: ...` line listing each bumped dependency at its new version, or nothing. */
export function getDependencyReleaseLine(
  _changesets: readonly ChangelogChangeset[],
  dependenciesUpdated: readonly ChangelogDependency[],
): Promise<string> {
  if (dependenciesUpdated.length === 0) return Promise.resolve('');
  const versions = dependenciesUpdated.map((dependency) => `\`${dependency.name}@${dependency.newVersion}\``);
  return Promise.resolve(`- Updated dependencies: ${versions.join(', ')}`);
}

export default { getReleaseLine, getDependencyReleaseLine };
