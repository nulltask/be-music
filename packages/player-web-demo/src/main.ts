import { BeMusicBrowserLibrary, type BeMusicBrowserLibraryProps } from '@be-music/player-react';
import type { BrowserSongCollection, BrowserSongEntry } from '@be-music/player-web-core';
import { createElement, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  const [collection, setCollection] = useState<BrowserSongCollection | undefined>(undefined);
  const [selectedSong, setSelectedSong] = useState<BrowserSongEntry | undefined>(undefined);
  const [startedSong, setStartedSong] = useState<BrowserSongEntry | undefined>(undefined);

  const props = useMemo(
    () =>
      ({
        className: 'canvas-panel',
        collection,
        enableDrop: true,
        onCollectionChange: (nextCollection: BrowserSongCollection) => {
          setCollection(nextCollection);
          setSelectedSong(nextCollection.songs[0]);
          setStartedSong(undefined);
        },
        onSongSelect: (song: BrowserSongEntry) => {
          setSelectedSong(song);
        },
        onSongActivate: (song: BrowserSongEntry) => {
          setSelectedSong(song);
          setStartedSong(song);
        },
        onSongExit: () => {
          setStartedSong(undefined);
        },
      }) satisfies BeMusicBrowserLibraryProps,
    [collection],
  );

  return createElement(
    'div',
    { className: 'shell' },
    createElement(BeMusicBrowserLibrary, props),
    createElement(
      'aside',
      { className: 'sidebar' },
      createElement(
        'section',
        { className: 'sidebar-card' },
        createElement('h1', null, 'be-music browser player'),
        createElement(
          'p',
          null,
          'Drop a local folder or ZIP archive. The PixiJS surface on the left extracts chart metadata and renders a browser-native song list.',
        ),
      ),
      createElement(
        'section',
        { className: 'sidebar-card' },
        createElement('h2', null, 'Library'),
        createElement(
          'div',
          { className: 'stat-grid' },
          renderStat('Charts', String(collection?.songs.length ?? 0)),
          renderStat('Sources', String(collection?.sources.length ?? 0)),
          renderStat('Errors', String(collection?.errors.length ?? 0)),
          renderStat('Formats', resolveFormats(collection)),
        ),
      ),
      createElement(
        'section',
        { className: 'sidebar-card' },
        createElement('h2', null, startedSong ? 'Now Playing' : 'Selection'),
        (startedSong ?? selectedSong)
          ? createElement(
              'div',
              null,
              createElement('p', null, (startedSong ?? selectedSong)!.title),
              (startedSong ?? selectedSong)!.artist ? createElement('p', null, (startedSong ?? selectedSong)!.artist) : null,
              createElement(
                'p',
                null,
                `${(startedSong ?? selectedSong)!.sourceLabel} / ${(startedSong ?? selectedSong)!.directoryLabel === '.' ? (startedSong ?? selectedSong)!.fileLabel : `${(startedSong ?? selectedSong)!.directoryLabel}/${(startedSong ?? selectedSong)!.fileLabel}`}`,
              ),
              (startedSong ?? selectedSong)!.genre ? createElement('p', null, `Genre: ${(startedSong ?? selectedSong)!.genre}`) : null,
              (startedSong ?? selectedSong)!.playLevel !== undefined ? createElement('p', null, `Level: ${(startedSong ?? selectedSong)!.playLevel}`) : null,
              (startedSong ?? selectedSong)!.bpm !== undefined ? createElement('p', null, `BPM: ${(startedSong ?? selectedSong)!.bpm}`) : null,
            )
          : createElement('p', null, 'Drop a source and select a chart to inspect its metadata.'),
      ),
      createElement(
        'section',
        { className: 'sidebar-card' },
        createElement('h2', null, 'Keyboard'),
        startedSong
          ? createElement('p', null, 'Gameplay supports Space to pause and Escape to return to the browser scene.')
          : createElement('p', null, 'Click the song list once to focus it, then use ↑/↓ to move and Enter to start.'),
        createElement('p', null, startedSong ? 'This scene is autoplay-first for now, and will grow toward full browser play.' : 'PageUp/PageDown, Home, and End are also available.'),
      ),
      createElement(
        'section',
        { className: 'sidebar-card' },
        createElement('h2', null, 'Next Steps'),
        createElement(
          'ul',
          null,
          createElement('li', null, 'Reuse this source model for registry-backed ZIP downloads later.'),
          createElement('li', null, 'Swap the song-list scene with gameplay scenes while keeping the same mount API.'),
          createElement('li', null, 'Use the React and Vue adapters as thin shells around the same PixiJS core.'),
        ),
      ),
    ),
  );
}

function renderStat(label: string, value: string) {
  return createElement(
    'div',
    { className: 'stat', key: label },
    createElement('span', { className: 'stat-label' }, label),
    createElement('span', { className: 'stat-value' }, value),
  );
}

function resolveFormats(collection: BrowserSongCollection | undefined): string {
  if (!collection || collection.songs.length === 0) {
    return '-';
  }
  const formats = new Set(collection.songs.map((song) => song.chart.sourceFormat.toUpperCase()));
  return [...formats].sort().join(', ');
}

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Missing #app root element.');
}

createRoot(rootElement).render(createElement(App));
