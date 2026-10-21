import { expect, test } from 'vite-plus/test';
import { collectWorkerTransferables } from './worker-transferables.ts';

test('deduplicates buffers shared by views and containers and handles cycles', () => {
  const first = new ArrayBuffer(16),
    second = new ArrayBuffer(4);
  const cyclic: unknown[] = [new Uint8Array(first), new DataView(first), new Map([[second, new Set([first])]])];
  cyclic.push(cyclic);
  expect(collectWorkerTransferables({ cyclic, second, empty: null })).toEqual([first, second]);
});
test('does not transfer shared buffers and preserves output ownership until postMessage', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const value = { bytes, shared: new Uint8Array(new SharedArrayBuffer(8)) };
  expect(collectWorkerTransferables(value)).toEqual([bytes.buffer]);
  expect([...bytes]).toEqual([1, 2, 3]);
  const copy = structuredClone(value, { transfer: collectWorkerTransferables(value) });
  expect(bytes.byteLength).toBe(0);
  expect([...copy.bytes]).toEqual([1, 2, 3]);
});
