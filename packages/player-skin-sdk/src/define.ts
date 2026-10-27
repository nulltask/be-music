import { validateBeMusicSkinSettings } from './settings.ts';
import type { BeMusicSkin, BeMusicSurfaceContextKind } from './types.ts';

/**
 * The skin API revision this build of the player implements. Skins record the revision they were written against in
 * `apiVersion`; a host refuses skins from a revision it doesn't support.
 */
export const BE_MUSIC_SKIN_API_VERSION = 0;

/**
 * Skin API revisions this host can run. `0` while the skin API is still being defined: it may change incompatibly
 * without the number moving, and the first stable revision will be `1`. Skins built before the API was marked unstable
 * declare `1` for the same API, so they still run.
 */
const SUPPORTED_API_VERSIONS: ReadonlySet<number> = new Set([BE_MUSIC_SKIN_API_VERSION, 1]);

/** Whether this host can run a skin written against `apiVersion`. */
export function isSupportedBeMusicSkinAPIVersion(apiVersion: number): boolean {
  return SUPPORTED_API_VERSIONS.has(apiVersion);
}

const CONTEXT_KINDS: ReadonlySet<string> = new Set<BeMusicSurfaceContextKind>(['2d', 'webgl', 'webgl2', 'webgpu']);

const SKIN_ID = /^[a-z0-9][a-z0-9-]*$/u;
// Semantic Versioning 2.0.0: MAJOR.MINOR.PATCH with optional pre-release and build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function isHttpURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Problems with a skin's declaration — an unsupported API revision, a malformed id or version, missing author or
 * `fontLoads`, bad URLs, an invalid `settings` schema — as human-readable messages. Empty when the skin is fine. A skin
 * written in plain JavaScript can leave out what the type requires, so a missing field is reported, never thrown on.
 */
export function validateBeMusicSkin(skin: BeMusicSkin): string[] {
  const problems: string[] = [];
  if (!isSupportedBeMusicSkinAPIVersion(skin.apiVersion)) {
    problems.push(
      `apiVersion ${String(skin.apiVersion)} is not supported (this player runs ${[...SUPPORTED_API_VERSIONS].join(', ')})`,
    );
  }
  if (typeof skin.id !== 'string' || !SKIN_ID.test(skin.id)) {
    problems.push(`id "${String(skin.id)}" must be lowercase letters, digits, and hyphens`);
  }
  if (!isNonEmptyString(skin.label)) problems.push('label must not be empty');
  if (typeof skin.version !== 'string' || !SEMVER.test(skin.version)) {
    problems.push(`version "${String(skin.version)}" is not a semantic version (e.g. 1.0.0)`);
  }
  if (!isNonEmptyString(skin.author?.name)) problems.push('author.name must not be empty');
  if (skin.author?.url !== undefined && !isHttpURL(skin.author.url)) {
    problems.push(`author.url "${skin.author.url}" must be an http(s) URL`);
  }
  if (skin.homepage !== undefined && !isHttpURL(skin.homepage)) {
    problems.push(`homepage "${skin.homepage}" must be an http(s) URL`);
  }
  if (!Array.isArray(skin.fontLoads) || skin.fontLoads.some((font) => typeof font !== 'string')) {
    problems.push('fontLoads must be an array of CSS font shorthands (empty when the skin loads no web fonts)');
  }
  if (!CONTEXT_KINDS.has(skin.context)) {
    problems.push(`context "${String(skin.context)}" must be one of ${[...CONTEXT_KINDS].join(', ')}`);
  }
  if (skin.dom !== undefined) {
    if (typeof skin.dom !== 'object' || skin.dom === null || Array.isArray(skin.dom)) {
      problems.push('dom must be an object of screen factories');
    } else {
      for (const screen of ['select', 'decide', 'result', 'gameplay'] as const) {
        if (skin.dom[screen] !== undefined && typeof skin.dom[screen] !== 'function') {
          problems.push(`dom.${screen} must be a function`);
        }
      }
    }
  }
  if (skin.gameplay?.drawsOnDOM === true && typeof skin.dom?.gameplay !== 'function') {
    problems.push('gameplay.drawsOnDOM requires a dom.gameplay screen');
  }
  for (const screen of ['gameplay', 'select', 'result'] as const) {
    if (typeof skin[screen]?.draw !== 'function') problems.push(`${screen}.draw must be a function`);
  }
  if (skin.decide !== undefined) {
    if (typeof skin.decide.draw !== 'function') problems.push('decide.draw must be a function');
    const { durationMs } = skin.decide;
    if (durationMs !== undefined && !(Number.isFinite(durationMs) && durationMs >= 0)) {
      problems.push(`decide.durationMs ${String(durationMs)} must be a non-negative number`);
    }
  }
  problems.push(...validateBeMusicSkinSettings(skin.settings));
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
