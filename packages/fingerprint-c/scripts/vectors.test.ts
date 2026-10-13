import { describe, expect, test } from 'vite-plus/test';
import { generateBinary64Vectors, generateRationalVectors } from './vectors.ts';

// The C port's test vectors must stay what the TypeScript implementation computes. After a deliberate change to
// fingerprint-rational.ts, refresh them with `vp test run -u packages/fingerprint-c` and rerun the C tests
// (`pnpm --filter @be-music/fingerprint-c run test:c`).
describe('C port test vectors', () => {
  test('rational.txt matches the TypeScript rational arithmetic and snapping', async () => {
    await expect(generateRationalVectors()).toMatchFileSnapshot('../tests/vectors/rational.txt');
  });

  test('binary64.txt matches JavaScript Number() and String()', async () => {
    await expect(generateBinary64Vectors()).toMatchFileSnapshot('../tests/vectors/binary64.txt');
  });
});
