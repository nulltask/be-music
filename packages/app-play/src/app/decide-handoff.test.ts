import { describe, expect, test } from 'vite-plus/test';
import { settleDecidePreload, type DecidePreload } from './decide-handoff.ts';

interface FakePlay {
  readonly name: string;
}

interface FakeOptions {
  readonly autoPlay?: boolean;
  readonly preResolved?: { readonly draws: readonly number[] };
}

const DRAWN: FakeOptions = { autoPlay: true, preResolved: { draws: [2, 1] } };

function preload(
  play: Promise<FakePlay | undefined>,
  options: FakeOptions = DRAWN,
): DecidePreload<FakePlay, FakeOptions> {
  return { options, play };
}

describe('settleDecidePreload', () => {
  test('hands the stage to the play the preload made', async () => {
    const prepared: FakePlay = { name: 'prepared' };
    const handOff = await settleDecidePreload(preload(Promise.resolve(prepared)), () => true);
    expect(handOff.kind === 'play' && handOff.play).toBe(prepared);
  });

  test('a failed preload makes the play again with the decide screen’s draws', async () => {
    const error = new Error('no samples');
    const handOff = await settleDecidePreload(preload(Promise.reject(error)), () => true);
    expect(handOff).toEqual({ kind: 'reload', options: DRAWN, error });
    expect(handOff.kind === 'reload' && handOff.options.preResolved).toEqual({ draws: [2, 1] });
  });

  test('a failed preload a newer navigation replaced shows nothing', async () => {
    const handOff = await settleDecidePreload(preload(Promise.reject(new Error('gone'))), () => false);
    expect(handOff).toEqual({ kind: 'stale' });
  });

  test('a preload a newer navigation replaced shows nothing', async () => {
    const handOff = await settleDecidePreload(preload(Promise.resolve(undefined)), () => true);
    expect(handOff).toEqual({ kind: 'stale' });
  });
});
