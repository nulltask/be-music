/**
 * Playfield rectangle for the no-skin lane geometry. Coordinates come from LR2's default 7K skin so LR2 skins and the
 * built-in default family share the same note-position contract while their chrome stays separate. Kept free of any
 * renderer import so the skin SDK's layout helpers can use it.
 */
export const PLAYFIELD = { x: 33, y: 0, w: 194, judgementY: 321 } as const;
