import type { BeMusicSkin, BeMusicSurfaceContextKind } from '../skin/be-music/types.ts';

/**
 * The skin API revision this build of the player implements. Skins record the revision they were written against in
 * `apiVersion`; a host refuses skins from a revision it doesn't support.
 */
export const BE_MUSIC_SKIN_API_VERSION = 1;

/** Skin API revisions this host can run. */
const SUPPORTED_API_VERSIONS: ReadonlySet<number> = new Set([BE_MUSIC_SKIN_API_VERSION]);

/** Whether this host can run a skin written against `apiVersion`. */
export function isSupportedBeMusicSkinApiVersion(apiVersion: number): boolean {
  return SUPPORTED_API_VERSIONS.has(apiVersion);
}

const CONTEXT_KINDS: ReadonlySet<string> = new Set<BeMusicSurfaceContextKind>(['2d', 'webgl', 'webgl2', 'webgpu']);

const SKIN_ID = /^[a-z0-9][a-z0-9-]*$/u;
// Semantic Versioning 2.0.0: MAJOR.MINOR.PATCH with optional pre-release and build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Problems with a skin's declaration — an unsupported API revision, a malformed id or version, missing author, bad
 * URLs — as human-readable messages. Empty when the skin is fine.
 */
export function validateBeMusicSkin(skin: BeMusicSkin): string[] {
  const problems: string[] = [];
  if (!isSupportedBeMusicSkinApiVersion(skin.apiVersion)) {
    problems.push(
      `apiVersion ${String(skin.apiVersion)} is not supported (this player runs ${[...SUPPORTED_API_VERSIONS].join(', ')})`,
    );
  }
  if (!SKIN_ID.test(skin.id)) problems.push(`id "${skin.id}" must be lowercase letters, digits, and hyphens`);
  if (skin.label.trim() === '') problems.push('label must not be empty');
  if (!SEMVER.test(skin.version)) problems.push(`version "${skin.version}" is not a semantic version (e.g. 1.0.0)`);
  if (skin.author.name.trim() === '') problems.push('author.name must not be empty');
  if (skin.author.url !== undefined && !isHttpUrl(skin.author.url)) {
    problems.push(`author.url "${skin.author.url}" must be an http(s) URL`);
  }
  if (skin.homepage !== undefined && !isHttpUrl(skin.homepage)) {
    problems.push(`homepage "${skin.homepage}" must be an http(s) URL`);
  }
  if (!CONTEXT_KINDS.has(skin.context)) {
    problems.push(`context "${String(skin.context)}" must be one of ${[...CONTEXT_KINDS].join(', ')}`);
  }
  for (const screen of ['gameplay', 'select', 'result'] as const) {
    if (typeof skin[screen]?.draw !== 'function') problems.push(`${screen}.draw must be a function`);
  }
  return problems;
}

/**
 * Declares a be-music skin. Returns the skin unchanged after checking its declaration (see {@link validateBeMusicSkin}),
 * so a malformed skin fails where it is defined rather than when a host first mounts it.
 *
 * ```ts
 * export default defineBeMusicSkin({
 *   apiVersion: BE_MUSIC_SKIN_API_VERSION,
 *   id: 'neon',
 *   label: 'Neon',
 *   version: '1.0.0',
 *   author: { name: 'Jane Doe', url: 'https://example.com' },
 *   fontLoads: [],
 *   context: '2d',
 *   gameplay: { draw: ({ context: ctx }, frame) => { … } },
 *   select: { layout, draw: ({ context: ctx }, frame) => { … } },
 *   result: { draw: ({ context: ctx }, frame) => { … } },
 * });
 * ```
 */
export function defineBeMusicSkin<TSkin extends BeMusicSkin>(skin: TSkin): TSkin {
  const problems = validateBeMusicSkin(skin);
  if (problems.length > 0) {
    throw new Error(`defineBeMusicSkin("${skin.id}"): ${problems.join('; ')}`);
  }
  return skin;
}
