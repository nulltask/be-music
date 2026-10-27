import { expect, test, vi } from 'vite-plus/test';
import { BrowserTaskPool, type TaskWorker } from './pool.ts';

class FakeWorker implements TaskWorker {
  onmessage: TaskWorker['onmessage'] = null;
  onerror: TaskWorker['onerror'] = null;
  onmessageerror: TaskWorker['onmessageerror'] = null;
  messages: Array<{ id: number; name: string; input: unknown }> = [];
  terminate = vi.fn();
  postMessage(message: unknown): void {
    this.messages.push(structuredClone(message) as (typeof this.messages)[number]);
  }
  answer(value: unknown): void {
    this.onmessage?.({ data: { id: this.messages.at(-1)!.id, value } } as MessageEvent);
  }
}
function harness(size: number) {
  const workers: FakeWorker[] = [];
  const pool = new BrowserTaskPool(size, () => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { pool, workers };
}
test('bounds concurrency, keeps queued work, and matches out-of-order replies', async () => {
  const { pool, workers } = harness(2);
  const jobs = [0, 1, 2, 3].map((n) => pool.run('task', n, () => -1));
  expect(workers).toHaveLength(2);
  expect(workers.map((w) => w.messages.length)).toEqual([1, 1]);
  workers[1]!.answer(10);
  workers[0]!.answer(0);
  workers[0]!.answer(30);
  workers[1]!.answer(20);
  expect(await Promise.all(jobs)).toEqual([0, 10, 20, 30]);
  pool.dispose();
});
test('shrinking drains running jobs without starting extra work; growing uses queued jobs', async () => {
  const { pool, workers } = harness(2);
  const a = pool.run('a', 0, () => 0);
  const b = pool.run('b', 1, () => 1);
  const c = pool.run('c', 2, () => 2);
  pool.resize(1);
  workers[0]!.answer(0);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  expect(workers[1]!.messages).toHaveLength(1);
  pool.resize(2);
  expect(workers).toHaveLength(3);
  workers[1]!.answer(1);
  workers[2]!.answer(2);
  expect(await Promise.all([a, b, c])).toEqual([0, 1, 2]);
  pool.dispose();
});
test('worker startup and runtime failures fall back with inputs intact', async () => {
  const bad = new BrowserTaskPool(1, () => {
    throw new Error('blocked');
  });
  expect(await bad.run('a', { n: 3 }, () => 3)).toBe(3);
  bad.dispose();
  const { pool, workers } = harness(1);
  const input = new Uint8Array([4]);
  const job = pool.run('a', input, () => input[0]);
  workers[0]!.onerror?.({} as ErrorEvent);
  expect(await job).toBe(4);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  pool.dispose();
});
test('task failures reject without rerunning the computation', async () => {
  const { pool, workers } = harness(1);
  const fallback = vi.fn(() => 1);
  const job = pool.run('bad', 0, fallback);
  workers[0]!.onmessage?.({ data: { id: 1, error: 'invalid chart' } } as MessageEvent);
  await expect(job).rejects.toThrow('invalid chart');
  expect(fallback).not.toHaveBeenCalled();
  pool.dispose();
});
test('dispose rejects pending and running jobs and prevents new jobs', async () => {
  const { pool, workers } = harness(1);
  const a = pool.run('a', 0, () => 0),
    b = pool.run('b', 0, () => 0);
  const checks = [expect(a).rejects.toThrow('closed'), expect(b).rejects.toThrow('closed')];
  pool.dispose();
  await Promise.all(checks);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  await expect(pool.run('c', 0, () => 0)).rejects.toThrow('closed');
});
test('disposing a scheduled local fallback prevents it from running', async () => {
  const pool = new BrowserTaskPool(1);
  const fallback = vi.fn(() => 3);
  const job = pool.run('a', 0, fallback);
  const check = expect(job).rejects.toThrow('closed');
  pool.dispose();
  await check;
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(fallback).not.toHaveBeenCalled();
});
