// The layout of the player's Options dialog (`OptionsDialog`): its tabs and the titles of its folders, in order, so
// the structure reads in one place and stays testable; `index.ts` binds the controllers.

export * from '../../player-storage.ts';

/** An Options dialog folder: a section with its title as the heading. */
export interface OptionFolderSpec {
  readonly title: string;
}

/** Every folder of the Options dialog, top to bottom; a tab holds some of them (`OPTIONS_TABS`), the rest sit inside. */
export const OPTION_FOLDERS = {
  playOptions: { title: 'Play options' },
  replayView: { title: 'Replay / ghost' },
  view: { title: 'View' },
  keys: { title: 'Key config' },
  tempo: { title: 'Tempo' },
  course: { title: 'Course' },
  skin: { title: 'Skin & display' },
  bgaCamera: { title: 'BGA camera' },
  beatorajaSkins: { title: 'Beatoraja skins' },
  skinSettings: { title: 'Skin settings' },
  addSkin: { title: 'Add skin' },
  audio: { title: 'Audio' },
  compressor: { title: 'Compressor' },
  compressorStages: { title: 'Stages' },
  library: { title: 'Library & records' },
  replaySlots: { title: 'Replay slots' },
  select: { title: 'Select' },
  bgaTranscode: { title: 'BGA video transcode' },
  capture: { title: 'Capture' },
  leaderboard: { title: 'Leaderboard' },
  advanced: { title: 'Advanced' },
} as const satisfies Record<string, OptionFolderSpec>;

/**
 * The Options dialog's tabs, left to right: Play (Play options, with Tempo on its Practice page), View (the hi-speed,
 * the covers and LIFT, and the effects), Keys, Skin (Skin & display), Audio, Library (the status, opening files,
 * Library & records, Select, Course and Capture), Leaderboard, and Advanced (diagnostics, the BGA transcode and the
 * reset).
 */
export const OPTIONS_TABS = ['Play', 'View', 'Keys', 'Skin', 'Audio', 'Library', 'Leaderboard', 'Advanced'] as const;

/**
 * The pages the Play options folder splits its many options into: how a play is judged and its gauge, how the lanes
 * are arranged, the chart modifiers, the assists, PRACTICE with the tempo, and Replay / ghost.
 */
export const PLAY_OPTION_PAGES = [
  'Judge & gauge',
  'Arrangement',
  'Modifiers',
  'Assist',
  'Practice',
  'Replay / ghost',
] as const;

/** The pages of the View folder: the hi-speed and its modes, the lane covers and LIFT, and the effects on the lanes. */
export const VIEW_OPTION_PAGES = ['Hi-speed', 'Cover & LIFT', 'Effects'] as const;
