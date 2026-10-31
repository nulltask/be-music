import { expect, test } from 'vite-plus/test';
import { cloneJSONFields, collectBmsonExtraFields } from './index.ts';

test('annotation copies preserve nested JSON, independent repeated objects and literal prototype keys', () => {
  const source = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":[null,false,0,"value"],"nested":{"values":[1,2]}}',
  );
  const copy = cloneJSONFields(source)!;
  expect(copy).toEqual(source);
  expect(Object.hasOwn(copy, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  (copy.nested as { values: number[] }).values.push(3);
  expect(source.nested.values).toEqual([1, 2]);
  const shared = { x: [1] };
  const repeated = cloneJSONFields({ a: shared, b: shared })!;
  expect(repeated.a).toEqual(repeated.b);
  expect(repeated.a).not.toBe(repeated.b);
});

test('non-JSON maps and cycles are rejected, while empty maps remain absent', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const input of [
    undefined,
    null,
    [],
    {},
    { invalid: undefined },
    { invalid: Infinity },
    { invalid: () => 1 },
    { invalid: new Date(0) },
    cycle,
  ])
    expect(cloneJSONFields(input)).toBeUndefined();
});

test.each([
  ['root', 'sound_channels'],
  ['info', 'init_bpm'],
  ['channel', 'notes'],
  ['note', 'x'],
  ['keyNote', 'y'],
  ['mineNote', 'damage'],
  ['line', 'y'],
  ['bpm', 'bpm'],
  ['stop', 'duration'],
  ['scroll', 'rate'],
  ['bga', 'bga_events'],
  ['bgaHeader', 'id'],
  ['bgaEvent', 'condition'],
  ['bgaSequence', 'sequence'],
  ['bgaFrame', 'time'],
] as const)('%s annotations never revive a supported %s field, even when its value is malformed', (scope, key) => {
  expect(
    collectBmsonExtraFields({ [key]: { invalid: true }, vendor: [null, 1], extraFields: 'literal-source-key' }, scope),
  ).toEqual({ vendor: [null, 1], extraFields: 'literal-source-key' });
});
