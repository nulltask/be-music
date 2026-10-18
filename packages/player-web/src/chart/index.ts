/**
 * Barrel for the `@be-music/player-web/chart` subpath. Re-exports the chart-side preprocessing surface — the preview
 * engine and the beatoraja chart marker helpers. The deeper beatoraja chart analytics (`bpm-curve`, `density`,
 * `dp-flip`, `note-counts`, etc.) stay internal — the beatoraja views read them — and aren't part of the public
 * contract.
 */
export * from './preview.ts';
export { computeBeatorajaChartMarkers } from './beatoraja/markers.ts';
