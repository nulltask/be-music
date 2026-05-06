import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

interface CreateReleaseOptions {
  repo: string;
  releaseTarget: string;
  releasesJsonPath: string;
  assetsDir: string;
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

function parseArgs(argv: string[]): CreateReleaseOptions {
  const options: CreateReleaseOptions = {
    repo: '',
    releaseTarget: '',
    releasesJsonPath: '',
    assetsDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === '--repo') {
      options.repo = value;
    } else if (token === '--release-target') {
      options.releaseTarget = value;
    } else if (token === '--releases-json') {
      options.releasesJsonPath = value;
    } else if (token === '--assets-dir') {
      options.assetsDir = value;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
    index += 1;
  }

  if (!options.repo) {
    throw new Error('Missing required argument: --repo <owner/repo>');
  }
  if (!options.releaseTarget) {
    throw new Error('Missing required argument: --release-target <ref>');
  }
  if (!options.releasesJsonPath) {
    throw new Error('Missing required argument: --releases-json <path>');
  }
  if (!options.assetsDir) {
    throw new Error('Missing required argument: --assets-dir <path>');
  }

  return options;
}

function runGh(args: string[], allowFailure = false): string | null {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) {
      return null;
    }
    throw error;
  }
}

async function resolveAssets(assetsDir: string, release: PackageRelease): Promise<string[]> {
  if (!release.isSeaPackage) {
    return [];
  }

  const assetEntries = await readdir(assetsDir, { withFileTypes: true });
  const zipPrefix = `${release.archiveBaseName}-${release.version}-`;
  const zipAssets = assetEntries
    .filter((entry) => entry.isFile() && entry.name.startsWith(zipPrefix) && entry.name.endsWith('.zip'))
    .map((entry) => resolve(assetsDir, entry.name))
    .sort((left, right) => basename(left).localeCompare(basename(right)));

  if (zipAssets.length === 0) {
    throw new Error(`No SEA archives found for ${release.releaseTitle}`);
  }

  const certificateAssets = [];
  for (const fileName of ['be-music-self-signed-macos.pem', 'be-music-self-signed-windows.cer']) {
    const filePath = resolve(assetsDir, fileName);
    try {
      await access(filePath);
      certificateAssets.push(filePath);
    } catch {
      // Certificates are optional so rebuilds can still proceed if only one platform is available.
    }
  }

  return [...zipAssets, ...certificateAssets];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const releases = JSON.parse(await readFile(options.releasesJsonPath, 'utf8')) as unknown;
  if (!Array.isArray(releases) || releases.length === 0) {
    process.stdout.write('No package releases to publish.\n');
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'be-music-release-notes-'));

  try {
    for (const release of releases as PackageRelease[]) {
      const notesPath = join(tempDir, `${release.packageSlug}-${release.version}.md`);
      await writeFile(notesPath, `${release.notes.trim()}\n`, 'utf8');

      const assets = await resolveAssets(options.assetsDir, release);
      const releaseExists =
        runGh(['release', 'view', release.tagName, '--repo', options.repo], true) !== null;

      if (releaseExists) {
        if (assets.length > 0) {
          execFileSync(
            'gh',
            ['release', 'upload', release.tagName, ...assets, '--clobber', '--repo', options.repo],
            { stdio: 'inherit' },
          );
        }
        execFileSync(
          'gh',
          [
            'release',
            'edit',
            release.tagName,
            '--repo',
            options.repo,
            '--title',
            release.releaseTitle,
            '--notes-file',
            notesPath,
          ],
          { stdio: 'inherit' },
        );
        continue;
      }

      execFileSync(
        'gh',
        [
          'release',
          'create',
          release.tagName,
          ...assets,
          '--repo',
          options.repo,
          '--target',
          options.releaseTarget,
          '--title',
          release.releaseTitle,
          '--notes-file',
          notesPath,
        ],
        { stdio: 'inherit' },
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
