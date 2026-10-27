import { describe, expect, it } from 'vite-plus/test';
import {
  beatorajaReplayButtonSlot,
  resolveBeatorajaResultReplayOps,
  resolveBeatorajaSelectReplayOps,
} from './replay-slots.ts';

describe('replay slot ops', () => {
  it('names the slot of a replay button', () => {
    expect([19, 316, 317, 318, 15].map(beatorajaReplayButtonSlot)).toEqual([0, 1, 2, 3, undefined]);
  });

  it('lights none, exists or saved per slot on a result screen', () => {
    expect(resolveBeatorajaResultReplayOps(['none', 'exists', 'saved', 'none'])).toEqual([196, 1197, 1201, 1202]);
  });

  it('lights none or exists per slot on the select screen, and the slot picked', () => {
    expect(resolveBeatorajaSelectReplayOps([true, false, false, true], 3)).toEqual([197, 1196, 1199, 1203, 1208]);
    expect(resolveBeatorajaSelectReplayOps([false, false, false, false], -1)).toEqual([196, 1196, 1199, 1202]);
  });
});
