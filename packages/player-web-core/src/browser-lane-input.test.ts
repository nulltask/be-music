import { describe, expect, test } from 'vitest';
import { createBrowserInputChannelMap, createBrowserLaneBindings } from './browser-lane-input.ts';

describe('player-web-core browser lane input', () => {
  test('creates scratch-left-first bindings for SP layouts', () => {
    const bindings = createBrowserLaneBindings(['16', '11', '12', '13', '14', '15', '18', '19'], ['16', '11', '12', '13', '14', '15', '18', '19']);
    expect(bindings.map((binding) => binding.displayChannel)).toEqual(['16', '11', '12', '13', '14', '15', '18', '19']);
    expect(bindings[0]?.keyCodes).toEqual(['ShiftLeft']);
    expect(bindings[1]?.keyCodes).toEqual(['KeyZ']);
  });

  test('maps FREE ZONE input through the scratch binding', () => {
    const bindings = createBrowserLaneBindings(['16', '11'], ['17', '11']);
    const inputMap = createBrowserInputChannelMap(bindings);
    expect(inputMap.get('ShiftLeft')).toEqual(['16', '17']);
  });
});
