import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicSkin } from './types.ts';
import {
  BE_MUSIC_SKIN_API_VERSION,
  defineBeMusicSkin,
  isSupportedBeMusicSkinAPIVersion,
  validateBeMusicSkin,
} from './define.ts';

function skin(overrides: Partial<BeMusicSkin> = {}): BeMusicSkin {
  return {
    apiVersion: BE_MUSIC_SKIN_API_VERSION,
    id: 'neon',
    label: 'Neon',
    version: '1.2.0',
    author: { name: 'Jane Doe', url: 'https://example.com/jane' },
    fontLoads: [],
    context: '2d',
    gameplay: { draw: () => {} },
    select: { layout: { listX: 0, listTop: 0, listBottomInset: 0, rowHeight: 20 }, draw: () => {} },
    result: { draw: () => {} },
    ...overrides,
  };
}

describe('isSupportedBeMusicSkinAPIVersion', () => {
  it('accepts the current revision, the unstable 0', () => {
    expect(BE_MUSIC_SKIN_API_VERSION).toBe(0);
    expect(isSupportedBeMusicSkinAPIVersion(BE_MUSIC_SKIN_API_VERSION)).toBe(true);
  });

  it('still accepts 1, which skins declared before the API was marked unstable', () => {
    expect(isSupportedBeMusicSkinAPIVersion(1)).toBe(true);
  });

  it('refuses future and unknown revisions', () => {
    expect(isSupportedBeMusicSkinAPIVersion(2)).toBe(false);
    expect(isSupportedBeMusicSkinAPIVersion(-1)).toBe(false);
    expect(isSupportedBeMusicSkinAPIVersion(1.5)).toBe(false);
  });
});

describe('validateBeMusicSkin', () => {
  it('passes a well-formed declaration', () => {
    expect(validateBeMusicSkin(skin())).toEqual([]);
    expect(validateBeMusicSkin(skin({ version: '2.0.0-beta.1+build.5', homepage: 'https://example.com' }))).toEqual([]);
  });

  it('reports an unknown canvas context', () => {
    expect(validateBeMusicSkin(skin({ context: 'canvas' as BeMusicSkin['context'] }))).toEqual([
      'context "canvas" must be one of 2d, webgl, webgl2, webgpu',
    ]);
  });

  it('requires a DOM gameplay screen for a playfield drawn on DOM', () => {
    expect(validateBeMusicSkin(skin({ gameplay: { draw: () => {}, drawsOnDOM: true } }))).toEqual([
      'gameplay.drawsOnDOM requires a dom.gameplay screen',
    ]);
    expect(
      validateBeMusicSkin(
        skin({
          gameplay: { draw: () => {}, drawsOnDOM: true },
          dom: { gameplay: () => ({ update: () => {}, dispose: () => {} }) },
        }),
      ),
    ).toEqual([]);
  });

  it('reports a screen without a draw function', () => {
    expect(validateBeMusicSkin(skin({ result: {} as BeMusicSkin['result'] }))).toEqual([
      'result.draw must be a function',
    ]);
  });

  it('reports an unsupported API revision', () => {
    expect(validateBeMusicSkin(skin({ apiVersion: 99 }))[0]).toMatch(/apiVersion 99/u);
  });

  it('checks an optional decide screen', () => {
    expect(validateBeMusicSkin(skin({ decide: { durationMs: 1500, draw: () => {} } }))).toEqual([]);
    expect(validateBeMusicSkin(skin({ decide: {} as BeMusicSkin['decide'] }))).toEqual([
      'decide.draw must be a function',
    ]);
    expect(validateBeMusicSkin(skin({ decide: { durationMs: -1, draw: () => {} } }))).toEqual([
      'decide.durationMs -1 must be a non-negative number',
    ]);
  });

  it('includes problems with the settings schema', () => {
    expect(
      validateBeMusicSkin(skin({ settings: [{ kind: 'toggle', id: 'glow', label: 'Glow', default: true }] })),
    ).toEqual([]);
    expect(
      validateBeMusicSkin(
        skin({
          settings: [
            { kind: 'toggle', id: 'glow', label: 'Glow', default: true },
            { kind: 'toggle', id: 'glow', label: 'Glow again', default: false },
          ],
        }),
      ),
    ).toEqual(['setting "glow": id is used more than once']);
  });

  it('reports malformed ids, versions, and metadata', () => {
    const problems = validateBeMusicSkin(
      skin({
        id: 'Neon Skin',
        label: ' ',
        version: '1.0',
        author: { name: '', url: 'javascript:alert(1)' },
        homepage: 'ftp://example.com',
      }),
    );
    expect(problems).toHaveLength(6);
    expect(problems.join('\n')).toMatch(/id "Neon Skin"/u);
    expect(problems.join('\n')).toMatch(/version "1\.0"/u);
    expect(problems.join('\n')).toMatch(/author\.url/u);
    expect(problems.join('\n')).toMatch(/homepage/u);
  });

  it('reports a missing or malformed fontLoads', () => {
    const { fontLoads: _, ...withoutFontLoads } = skin();
    const message = 'fontLoads must be an array of CSS font shorthands (empty when the skin loads no web fonts)';
    expect(validateBeMusicSkin(withoutFontLoads as BeMusicSkin)).toEqual([message]);
    expect(validateBeMusicSkin(skin({ fontLoads: '400 24px "Anton"' as unknown as string[] }))).toEqual([message]);
    expect(validateBeMusicSkin(skin({ fontLoads: ['400 24px "Anton"', 400 as unknown as string] }))).toEqual([message]);
    expect(validateBeMusicSkin(skin({ fontLoads: ['400 24px "Anton"'] }))).toEqual([]);
  });

  it('reports the fields a plain JavaScript skin left out instead of throwing', () => {
    const bare = { apiVersion: BE_MUSIC_SKIN_API_VERSION, context: '2d' } as unknown as BeMusicSkin;
    const problems = validateBeMusicSkin(bare);
    expect(problems).toEqual(
      expect.arrayContaining([
        'id "undefined" must be lowercase letters, digits, and hyphens',
        'label must not be empty',
        'version "undefined" is not a semantic version (e.g. 1.0.0)',
        'author.name must not be empty',
        'fontLoads must be an array of CSS font shorthands (empty when the skin loads no web fonts)',
        'gameplay.draw must be a function',
      ]),
    );
  });
});

describe('defineBeMusicSkin', () => {
  it('returns a valid skin unchanged', () => {
    const value = skin();
    expect(defineBeMusicSkin(value)).toBe(value);
  });

  it('throws with every problem listed', () => {
    expect(() => defineBeMusicSkin(skin({ version: 'latest', apiVersion: 7 }))).toThrow(
      /apiVersion 7.*version "latest"/u,
    );
  });
});

describe('native DOM skin declarations', () => {
  it('accepts native screens alongside the Canvas playfield', () => {
    expect(validateBeMusicSkin(skin({ dom: { select: () => ({ update() {}, dispose() {} }) } }))).toEqual([]);
  });
  it('rejects malformed DOM factories without throwing', () => {
    expect(validateBeMusicSkin(skin({ dom: null as unknown as BeMusicSkin['dom'] }))).toContain(
      'dom must be an object of screen factories',
    );
    expect(validateBeMusicSkin(skin({ dom: { select: 1 } as unknown as BeMusicSkin['dom'] }))).toContain(
      'dom.select must be a function',
    );
  });
});
