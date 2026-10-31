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

test('preserves associated RGB and coverage through real worker conversion or its fallback', () => {
  const moduleURL = new URL('./bga-frame.ts', import.meta.url).href;
  const program = `
    import(${JSON.stringify(moduleURL)}).then(async ({ convertImageToSpecFrameOffThread }) => {
      const data = new Uint8Array(1024 * 4);
      for (let x = 0; x < 1024; x++) data.set(x < 512 ? [255,0,0,128] : [0,0,255,0], x * 4);
      const frame = await convertImageToSpecFrameOffThread({ width: 1024, height: 1, data, format: 'png' }, 'layer', 'lanczos');
      const covered = [...frame.opaqueMask.keys()].filter(i => frame.opaqueMask[i]);
      console.log(JSON.stringify({ source: [...data.slice(0,4)], alpha: [...frame.alpha.slice(0,256)],
        noBlue: covered.every(i => frame.rgb[i*3+2] === 0 && frame.rgb[i*3] === 255) }));
      process.exit(0);
    });
  `;
  const output = JSON.parse(
    execFileSync(process.execPath, ['--conditions=source', '--eval', program], { encoding: 'utf8', timeout: 15_000 }),
  );
  expect(output.source).toEqual([255, 0, 0, 128]);
  expect(output.noBlue).toBe(true);
  expect(output.alpha.slice(0, 100)).toEqual(Array.from({ length: 100 }, () => 128));
  expect(output.alpha.some((alpha: number) => alpha > 0 && alpha < 128)).toBe(true);
});
