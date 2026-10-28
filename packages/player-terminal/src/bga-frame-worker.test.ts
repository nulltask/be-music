import { execFileSync } from 'node:child_process';
import { expect, test } from 'vite-plus/test';

test('keeps source image pixels available when worker startup fails and conversion falls back', () => {
  const moduleURL = new URL('./bga-frame.ts', import.meta.url).href;
  const program = `
    import { convertImageToSpecFrameOffThread } from ${JSON.stringify(moduleURL)};
    const data = new Uint8Array([20, 40, 200, 255]);
    const frame = await convertImageToSpecFrameOffThread({ width: 1, height: 1, data, format: 'png' }, 'base', 'nearest');
    console.log(JSON.stringify({ source: [...data], pixel: [...frame.rgb.slice(127 * 3, 127 * 3 + 3)] }));
    process.exit(0);
  `;
  // The inherited module-input flag makes isoworker's CommonJS worker bootstrap fail. Exercise the real failure
  // path in Node, independently of Vitest's transform/worker environment.
  const result = execFileSync(process.execPath, ['--conditions=source', '--input-type=module', '--eval', program], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(JSON.parse(result)).toEqual({ source: [20, 40, 200, 255], pixel: [20, 40, 200] });
});
