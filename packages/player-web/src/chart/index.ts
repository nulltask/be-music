/**
 * Barrel for the `@be-music/player-web/chart` subpath. Re-exports the chart-side preprocessing surface — the preview
 * engine and the beatoraja gameplay-chart preparation helpers / marker types. The deeper beatoraja chart analytics
 * (`bpm-curve`, `density`, `dp-flip`, `note-counts`, etc.) stay internal — they back `prep.ts` but aren't part of the
 * public contract.
 */
export * from './preview.ts';
export * from './beatoraja/markers.ts';
export * from './beatoraja/prep.ts';
