import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicSkin } from './types.ts';
import {
  BE_MUSIC_SKIN_API_VERSION,
  defineBeMusicSkin,
  isSupportedBeMusicSkinApiVersion,
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

describe('isSupportedBeMusicSkinApiVersion', () => {
  it('is at revision 2', () => {
    expect(BE_MUSIC_SKIN_API_VERSION).toBe(2);
  });

  it('accepts the current revision and revision 1, which revision 2 only added to', () => {
    expect(isSupportedBeMusicSkinApiVersion(BE_MUSIC_SKIN_API_VERSION)).toBe(true);
    expect(isSupportedBeMusicSkinApiVersion(1)).toBe(true);
  });

  it('refuses future and unknown revisions', () => {
    expect(isSupportedBeMusicSkinApiVersion(BE_MUSIC_SKIN_API_VERSION + 1)).toBe(false);
    expect(isSupportedBeMusicSkinApiVersion(0)).toBe(false);
    expect(isSupportedBeMusicSkinApiVersion(1.5)).toBe(false);
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

  it('reports a screen without a draw function', () => {
    expect(validateBeMusicSkin(skin({ result: {} as BeMusicSkin['result'] }))).toEqual([
      'result.draw must be a function',
    ]);
  });

  it('reports an unsupported API revision', () => {
    expect(validateBeMusicSkin(skin({ apiVersion: 99 }))[0]).toMatch(/apiVersion 99/u);
  });

  it('passes a revision 1 skin', () => {
    expect(validateBeMusicSkin(skin({ apiVersion: 1 }))).toEqual([]);
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
