import { describe, expect, test } from 'vite-plus/test';
import { resolveAutoScratchChannels, resolveAutoScratchSides } from './auto-scratch.ts';

describe('per-side AUTO SCRATCH', () => {
  test('keeps independent switches and falls back to the older combined setting', () => {
    expect(resolveAutoScratchSides({})).toEqual({ autoScratch1P: false, autoScratch2P: false });
    expect(resolveAutoScratchSides({ autoScratch: true })).toEqual({ autoScratch1P: true, autoScratch2P: true });
    expect(resolveAutoScratchSides({ autoScratch: true, autoScratch1P: false })).toEqual({
      autoScratch1P: false,
      autoScratch2P: true,
    });
    expect(resolveAutoScratchSides({ autoScratch1P: true, autoScratch2P: false })).toEqual({
      autoScratch1P: true,
      autoScratch2P: false,
    });
  });
  test('selects only the enabled side among the chart’s actual scratch channels', () => {
    expect([...resolveAutoScratchChannels({ autoScratch1P: true }, ['16', '26'])]).toEqual(['16']);
    expect([...resolveAutoScratchChannels({ autoScratch2P: true }, ['16', '26'])]).toEqual(['26']);
    expect([...resolveAutoScratchChannels({ autoScratch: true }, [])]).toEqual([]);
    expect([...resolveAutoScratchChannels({ autoScratch1P: true }, ['1P', '1Q', '2P', '2Q'])]).toEqual(['1P', '1Q']);
  });
});
