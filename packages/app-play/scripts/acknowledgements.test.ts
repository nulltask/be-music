import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vite-plus/test';
import {
  bundledPackageRoots,
  clampLicenseText,
  isTypesOnlyPackage,
  licenseOverrideFileName,
  packageRootOfModule,
  readAcknowledgement,
  sortAcknowledgements,
} from './acknowledgements.ts';

const STORE = '/repo/node_modules/.pnpm';

describe('Open source list', () => {
  test('finds the npm package a module belongs to', () => {
    expect(packageRootOfModule(`${STORE}/pixi.js@8.22.0/node_modules/pixi.js/lib/index.mjs`)).toBe(
      `${STORE}/pixi.js@8.22.0/node_modules/pixi.js`,
    );
    expect(packageRootOfModule(`${STORE}/lit-html@3.3.1/node_modules/lit-html/lit-html.js?v=1`)).toBe(
      `${STORE}/lit-html@3.3.1/node_modules/lit-html`,
    );
    expect(packageRootOfModule(`${STORE}/@pixi+colord@2.9.6/node_modules/@pixi/colord/index.mjs`)).toBe(
      `${STORE}/@pixi+colord@2.9.6/node_modules/@pixi/colord`,
    );
    // A package nested in another's node_modules belongs to the inner one.
    expect(packageRootOfModule('/repo/node_modules/a/node_modules/b/index.js')).toBe(
      '/repo/node_modules/a/node_modules/b',
    );
    expect(packageRootOfModule('C:\\repo\\node_modules\\fflate\\esm\\browser.js')).toBe('C:/repo/node_modules/fflate');
    // The player's own code, the workspace packages and virtual modules are not npm packages.
    expect(packageRootOfModule('/repo/packages/app-play/src/main.ts')).toBeUndefined();
    expect(packageRootOfModule('\0virtual:acknowledgements')).toBeUndefined();
  });

  test('counts only modules a chunk rendered', () => {
    const roots = bundledPackageRoots({
      'main.js': {
        type: 'chunk',
        modules: {
          [`${STORE}/fflate@0.8.3/node_modules/fflate/esm/browser.js`]: { renderedLength: 1200 },
          [`${STORE}/@xmldom+xmldom@0.8.15/node_modules/@xmldom/xmldom/lib/dom.js`]: { renderedLength: 0 },
          '/repo/packages/app-play/src/main.ts': { renderedLength: 500 },
        },
      },
      'worker.js': {
        type: 'chunk',
        modules: { [`${STORE}/tiny-lru@11.4.7/node_modules/tiny-lru/dist/tiny-lru.js`]: { renderedLength: 10 } },
      },
      'main.css': { type: 'asset' },
    });
    expect([...roots].sort()).toEqual([
      `${STORE}/fflate@0.8.3/node_modules/fflate`,
      `${STORE}/tiny-lru@11.4.7/node_modules/tiny-lru`,
    ]);
  });

  test('names the stand-in license file after the package', () => {
    expect(licenseOverrideFileName('@ffmpeg/core')).toBe('@ffmpeg__core.txt');
    expect(licenseOverrideFileName('tweakpane')).toBe('tweakpane.txt');
  });

  test('tells type-only packages from ones with code', () => {
    expect(isTypesOnlyPackage({ name: '@types/earcut', types: 'index.d.ts' })).toBe(true);
    expect(isTypesOnlyPackage({ name: '@webgpu/types', types: 'dist/index.d.ts' })).toBe(true);
    expect(isTypesOnlyPackage({ name: 'fflate', main: 'lib/index.cjs', types: 'lib/index.d.ts' })).toBe(false);
    expect(isTypesOnlyPackage({ name: 'lit-html', exports: { '.': './lit-html.js' } })).toBe(false);
  });

  test('orders entries by name, then version, and cuts long license texts', () => {
    expect(
      sortAcknowledgements([
        { name: 'b', version: '1.0.0' },
        { name: 'a', version: '2.0.0' },
        { name: 'a', version: '1.0.0' },
      ]).map((entry) => `${entry.name}@${entry.version}`),
    ).toEqual(['a@1.0.0', 'a@2.0.0', 'b@1.0.0']);
    expect(clampLicenseText('short')).toBe('short');
    const long = clampLicenseText('x'.repeat(40_000));
    expect(long.startsWith('x'.repeat(32_000))).toBe(true);
    expect(long.endsWith('…[truncated]')).toBe(true);
  });

  describe('reading a package', () => {
    let dir: string;
    const setup = async (): Promise<string> => (dir ??= await mkdtemp(join(tmpdir(), 'acknowledgements-')));
    afterAll(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    test('reads its fields and its own LICENSE', async () => {
      const root = await setup();
      const pkg = join(root, 'with-license');
      await mkdir(pkg, { recursive: true });
      await writeFile(
        join(pkg, 'package.json'),
        JSON.stringify({
          name: 'with-license',
          version: '1.2.3',
          license: 'MIT',
          author: { name: 'Someone', url: 'https://example.com' },
          repository: { type: 'git', url: 'git+https://github.com/x/with-license.git' },
        }),
      );
      await writeFile(join(pkg, 'LICENSE.md'), 'MIT License\nCopyright (c) Someone');
      expect(await readAcknowledgement(pkg, join(root, 'licenses'))).toEqual({
        name: 'with-license',
        version: '1.2.3',
        license: 'MIT',
        author: 'Someone (https://example.com)',
        repository: 'git+https://github.com/x/with-license.git',
        licenseText: 'MIT License\nCopyright (c) Someone',
      });
    });

    test('takes the stand-in text for a package that ships no LICENSE', async () => {
      const root = await setup();
      const pkg = join(root, 'node_modules', '@scope', 'bare');
      await mkdir(pkg, { recursive: true });
      await writeFile(
        join(pkg, 'package.json'),
        JSON.stringify({ name: '@scope/bare', version: '0.1.0', license: 'MIT' }),
      );
      await mkdir(join(root, 'licenses'), { recursive: true });
      await writeFile(join(root, 'licenses', '@scope__bare.txt'), 'Upstream text');
      expect((await readAcknowledgement(pkg, join(root, 'licenses')))?.licenseText).toBe('Upstream text');
      // Neither an own LICENSE nor a stand-in: no text.
      expect((await readAcknowledgement(pkg, join(root, 'nowhere')))?.licenseText).toBeUndefined();
    });
  });
});
