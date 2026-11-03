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
  tempo: { title: 'Tempo' },
  course: { title: 'Course' },
  skin: { title: 'Skin & display' },
  beatorajaSkins: { title: 'Beatoraja skins' },
  skinSettings: { title: 'Skin settings' },
  addSkin: { title: 'Add skin' },
  audio: { title: 'Audio' },
  compressor: { title: 'Compressor' },
  compressorStages: { title: 'Stages' },
  library: { title: 'Library & records' },
  replaySlots: { title: 'Replay slots' },
  bgaTranscode: { title: 'BGA video transcode' },
  capture: { title: 'Capture' },
  leaderboard: { title: 'Leaderboard' },
  developer: { title: 'Developer' },
} as const satisfies Record<string, OptionFolderSpec>;

/**
 * The Options dialog's tabs, left to right: Play (Play options), Tempo & course, Skin & display, Audio, Library (the
 * status, opening files, Library & records and Capture), Leaderboard and Developer.
 */
export const OPTIONS_TABS = [
  'Play',
  'Tempo & course',
  'Skin & display',
  'Audio',
  'Library',
  'Leaderboard',
  'Developer',
] as const;

/**
 * The pages the Play options folder splits its many options into: how a play is judged and its gauge, the lane options,
 * the note modifiers, hi-speed and the view, PRACTICE, the select screen's list, and Replay / ghost.
 */
export const PLAY_OPTION_PAGES = [
  'Judge & gauge',
  'Lanes',
  'Notes',
  'Hi-speed & view',
  'Practice',
  'Select',
  'Replay / ghost',
] as const;
