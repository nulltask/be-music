/**
 * beatoraja's GUIDE SE: one system sound per judgment. `BMSPlayer` registers `guide-pg.wav`, `guide-gr.wav`,
 * `guide-gd.wav`, `guide-bd.wav`, `guide-pr.wav` and `guide-ms.wav` of the sound set as additional key sounds
 * (L398-L410), and `JudgeManager` plays the one for the judgment at every judgment (`keysound.play(judge, …)`, L694):
 * judges 0 to 3 are PGREAT, GREAT, GOOD and BAD, 4 is a missed note (POOR) and 5 an empty POOR (MISS).
 */

/** The six guide sounds, named as beatoraja's sound files are. */
export const GUIDE_SOUNDS = ['PG', 'GR', 'GD', 'BD', 'PR', 'MS'] as const;

export type GuideSound = (typeof GUIDE_SOUNDS)[number];

const GUIDE_SOUND_BY_JUDGE: Readonly<Record<string, GuideSound>> = {
  PERFECT: 'PG',
  GREAT: 'GR',
  GOOD: 'GD',
  BAD: 'BD',
  POOR: 'PR',
};

/**
 * The guide sound of a judgment: its own for PGREAT to BAD, `PR` for a POOR that takes a note (a missed one) and `MS`
 * for an empty POOR. None for anything else (READY), and none for the POOR that only sums up the notes a stopped play
 * left (`poor: 'remaining'`), which judges no note.
 */
export function resolveGuideSound(judge: string, poor?: 'empty' | 'remaining'): GuideSound | undefined {
  if (poor === 'remaining') return undefined;
  if (judge === 'POOR' && poor === 'empty') return 'MS';
  return GUIDE_SOUND_BY_JUDGE[judge];
}
