import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vite-plus/test';

// `patches/fengari-web@0.1.4.patch` replaces every `delete t.stack[...]` in the bundle with `t.stack[...] = void 0`.
// fengari shrinks the Lua stack that way on every call and return, and `delete` leaves the array holey, which made
// those two internals ~40% of a Lua skin's frame time (#344). Reads see `undefined` either way. A fengari-web upgrade
// drops the patch silently (pnpm keys it by version), so this fails until the patch is regenerated:
//   pnpm patch fengari-web@<version>
//   sed -E -i '' 's/delete (t\.stack\[[^]]*\])/(\1=void 0)/g' <edit dir>/dist/fengari-web.bundle.js
//   pnpm patch-commit <edit dir>
describe('fengari-web stack patch', () => {
  it('leaves no stack slot deleted in the bundle the evaluator loads', () => {
    const bundle = readFileSync(createRequire(import.meta.url).resolve('fengari-web'), 'utf8');
    expect(bundle).not.toMatch(/delete t\.stack\[/);
    expect(bundle.match(/\(t\.stack\[[^\]]*\]=void 0\)/g)).toHaveLength(29);
  });
});
