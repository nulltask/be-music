import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(scriptDir, '..', '..');
const packagesDir = resolve(repositoryDir, 'packages');

const SEA_RELEASES = new Map([
  ['player', { archiveBaseName: 'be-music-player' }],
  ['audio-renderer', { archiveBaseName: 'be-music-audio-render' }],
]);

interface ResolveReleaseOptions {
  base: string;
  head: string;
  githubOutput: string;
  jsonOutput: string;
}

interface PackageJsonLike {
  name: string;
  version: string;
}

interface PackageRelease {
  packageSlug: string;
  packageName: string;
  packageDir: string;
  version: string;
  tagName: string;
  releaseTitle: string;
  notes: string;
  isSeaPackage: boolean;
  archiveBaseName: string;
}

function parseArgs(argv: string[]): ResolveReleaseOptions {
  const options: ResolveReleaseOptions = {
    base: '',
    head: '',
    githubOutput: '',
    jsonOutput: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === '--base') {
      options.base = value;
    } else if (token === '--head') {
      options.head = value;
    } else if (token === '--github-output') {
      options.githubOutput = value;
    } else if (token === '--json-output') {
      options.jsonOutput = value;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
    index += 1;
  }

  if (!options.base) {
    throw new Error('Missing required argument: --base <ref>');
  }
  if (!options.head) {
    throw new Error('Missing required argument: --head <ref>');
  }

  return options;
}

function gitShow(ref: string, filePath: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: repositoryDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';
    if (
      stderr.includes('exists on disk, but not in') ||
      stderr.includes('does not exist in') ||
      stderr.includes('fatal: path')
    ) {
      return null;
    }
    throw error;
  }
}

function listPackageDirs(ref: string): string[] {
  const output = execFileSync('git', ['ls-tree', '--name-only', `${ref}:packages`], {
    cwd: repositoryDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractReleaseNotes(changelogText: string, version: string): string {
  const lines = changelogText.replaceAll('\r\n', '\n').split('\n');
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s|$)`);
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) {
    return `Released ${version}.`;
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      endIndex = index;
      break;
    }
  }

  const sectionLines = lines.slice(startIndex + 1, endIndex);
  while (sectionLines.length > 0 && sectionLines[0].trim() === '') {
    sectionLines.shift();
  }
  while (sectionLines.length > 0 && sectionLines.at(-1)?.trim() === '') {
    sectionLines.pop();
  }

  return sectionLines.join('\n').trim() || `Released ${version}.`;
}

function setGitHubOutput(lines: string[], name: string, value: string): void {
  if (value.includes('\n')) {
    lines.push(`${name}<<EOF`);
    lines.push(value);
    lines.push('EOF');
    return;
  }
  lines.push(`${name}=${value}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const packageDirs = listPackageDirs(options.head);

  const releases: PackageRelease[] = [];

  for (const packageSlug of packageDirs) {
    const packageJsonPath = resolve(packagesDir, packageSlug, 'package.json');
    const relativePackageJsonPath = relative(repositoryDir, packageJsonPath);
    const currentPackageJsonText = gitShow(options.head, relativePackageJsonPath);
    if (!currentPackageJsonText) {
      continue;
    }

    const currentPackage = JSON.parse(currentPackageJsonText) as PackageJsonLike;
    const basePackageJsonText = gitShow(options.base, relativePackageJsonPath);
    const basePackage = basePackageJsonText ? (JSON.parse(basePackageJsonText) as PackageJsonLike) : null;
    if (basePackage?.version === currentPackage.version) {
      continue;
    }

    const changelogPath = resolve(packagesDir, packageSlug, 'CHANGELOG.md');
    let notes = `Released ${currentPackage.version}.`;
    const changelogText = gitShow(options.head, relative(repositoryDir, changelogPath));
    if (changelogText) {
      notes = extractReleaseNotes(changelogText, currentPackage.version);
    }

    const seaConfig = SEA_RELEASES.get(packageSlug);
    releases.push({
      packageSlug,
      packageName: currentPackage.name,
      packageDir: `packages/${packageSlug}`,
      version: currentPackage.version,
      tagName: `${currentPackage.name}@${currentPackage.version}`,
      releaseTitle: `${currentPackage.name}@${currentPackage.version}`,
      notes,
      isSeaPackage: Boolean(seaConfig),
      archiveBaseName: seaConfig?.archiveBaseName ?? '',
    });
  }

  const seaReleases = releases.filter((release) => release.isSeaPackage);
  const playerRelease = seaReleases.find((release) => release.packageSlug === 'player');
  const audioRendererRelease = seaReleases.find((release) => release.packageSlug === 'audio-renderer');

  if (options.jsonOutput) {
    await writeFile(
      options.jsonOutput,
      `${JSON.stringify({ releases, seaReleases }, null, 2)}\n`,
      'utf8',
    );
  }

  if (options.githubOutput) {
    const outputLines = [];
    setGitHubOutput(outputLines, 'has_releases', releases.length > 0 ? 'true' : 'false');
    setGitHubOutput(outputLines, 'has_sea_releases', seaReleases.length > 0 ? 'true' : 'false');
    setGitHubOutput(outputLines, 'release_player', playerRelease ? 'true' : 'false');
    setGitHubOutput(outputLines, 'release_audio_renderer', audioRendererRelease ? 'true' : 'false');
    setGitHubOutput(outputLines, 'player_version', playerRelease?.version ?? '');
    setGitHubOutput(outputLines, 'audio_renderer_version', audioRendererRelease?.version ?? '');
    setGitHubOutput(outputLines, 'releases_json', JSON.stringify(releases));
    setGitHubOutput(outputLines, 'sea_releases_json', JSON.stringify(seaReleases));
    await writeFile(options.githubOutput, `${outputLines.join('\n')}\n`, { encoding: 'utf8', flag: 'a' });
  }

  process.stdout.write(`${JSON.stringify(releases, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
