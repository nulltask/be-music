// Smoke test of the bare WebAssembly build: it instantiates with no imports, and its exports work through the
// module's own heap.   node tests/wasm_smoke.mjs build/bmfp.wasm
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'build/bmfp.wasm';
const { instance } = await WebAssembly.instantiate(readFileSync(path), {});
const lib = instance.exports;
const memory = () => new Uint8Array(lib.memory.buffer);

function readCString(pointer) {
  const bytes = memory();
  let end = pointer;
  while (bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(pointer, end));
}

function check(label, got, want) {
  if (got !== want) {
    console.error(`${label}: got ${got}, want ${want}`);
    process.exit(1);
  }
}

check('algorithm', readCString(lib.bmfp_algorithm()), 'bmfp0');
check('version', /^\d+\.\d+\.\d+$/.test(readCString(lib.bmfp_version())), true);

const input = new TextEncoder().encode('abc');
const data = lib.bmfp_wasm_alloc(input.length);
const out = lib.bmfp_wasm_alloc(65);
memory().set(input, data);
check('status', lib.bmfp_sha256_hex(data, input.length, out, 65), 0);
check('sha256', readCString(out), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
lib.bmfp_wasm_free(data);
lib.bmfp_wasm_free(out);

// A buffer larger than the initial memory makes the heap grow.
const big = lib.bmfp_wasm_alloc(3 * 65536);
check('grown allocation', big !== 0, true);
lib.bmfp_wasm_free(big);

console.log(`wasm smoke test passed (${readFileSync(path).length} bytes)`);
