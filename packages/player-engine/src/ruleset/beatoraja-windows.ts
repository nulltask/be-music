/** beatoraja's judge windows per lane mode (`JudgeProperty`), and the mode a lane layout plays as. */

export interface BeatorajaModeWindows {
  note: readonly number[];
  scratch?: readonly number[];
  longNoteEnd: readonly number[];
  longScratchEnd?: readonly number[];
  rankTable: readonly number[];
  /** Which judge windows scale with judgerank (`[PG, GR, GD, BD]`; MS is always fixed). */
  scaled: readonly [boolean, boolean, boolean, boolean];
}

// beatoraja JudgeProperty flat tables: {PG late, PG early, GR..., GD..., BD..., MS late, MS early} in µs.
export const BEATORAJA_MODES: Record<'FIVEKEYS' | 'SEVENKEYS' | 'PMS' | 'KEYBOARD', BeatorajaModeWindows> = {
  FIVEKEYS: {
    note: [-20000, 20000, -50000, 50000, -100000, 100000, -150000, 150000, -150000, 500000],
    scratch: [-30000, 30000, -60000, 60000, -110000, 110000, -160000, 160000, -160000, 500000],
    longNoteEnd: [-120000, 120000, -150000, 150000, -200000, 200000, -250000, 250000],
    longScratchEnd: [-130000, 130000, -160000, 160000, -110000, 110000, -260000, 260000],
    rankTable: [25, 50, 75, 100, 125],
    scaled: [true, true, true, true],
  },
  SEVENKEYS: {
    note: [-20000, 20000, -60000, 60000, -150000, 150000, -280000, 220000, -150000, 500000],
    scratch: [-30000, 30000, -70000, 70000, -160000, 160000, -290000, 230000, -160000, 500000],
    longNoteEnd: [-120000, 120000, -160000, 160000, -200000, 200000, -280000, 220000],
    longScratchEnd: [-130000, 130000, -170000, 170000, -210000, 210000, -290000, 230000],
    rankTable: [25, 50, 75, 100, 125],
    scaled: [true, true, true, true],
  },
  PMS: {
    note: [-20000, 20000, -50000, 50000, -117000, 117000, -183000, 183000, -175000, 500000],
    longNoteEnd: [-120000, 120000, -150000, 150000, -217000, 217000, -283000, 283000],
    rankTable: [33, 50, 70, 100, 133],
    scaled: [false, true, true, false],
  },
  KEYBOARD: {
    note: [-30000, 30000, -90000, 90000, -200000, 200000, -320000, 240000, -200000, 650000],
    longNoteEnd: [-160000, 25000, -200000, 75000, -260000, 140000, -320000, 240000],
    rankTable: [25, 50, 75, 100, 125],
    scaled: [true, true, true, true],
  },
};

export function resolveBeatorajaMode(laneMode: string): BeatorajaModeWindows {
  if (laneMode.endsWith(' KEY GENERIC')) return BEATORAJA_MODES.KEYBOARD;
  if (laneMode.startsWith('5') || laneMode.startsWith('10')) return BEATORAJA_MODES.FIVEKEYS;
  if (laneMode.startsWith('9')) return BEATORAJA_MODES.PMS;
  if (laneMode.startsWith('24') || laneMode.startsWith('48')) return BEATORAJA_MODES.KEYBOARD;
  return BEATORAJA_MODES.SEVENKEYS;
}
