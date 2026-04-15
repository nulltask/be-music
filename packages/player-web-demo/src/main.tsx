import { BeMusicBrowserLibrary, type BeMusicBrowserLibraryProps } from '@be-music/player-react';
import type { BrowserSongCollection, BrowserSongEntry } from '@be-music/player-web-core';
import { useMemo, useState } from 'react';
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

  const visibleSong = startedSong ?? selectedSong;

  return (
    <div className="shell">
      <BeMusicBrowserLibrary {...props} />
      <aside className="sidebar">
        <section className="sidebar-card">
          <h1>be-music browser player</h1>
          <p>
            Drop a local folder or ZIP archive. The PixiJS surface on the left extracts chart metadata and renders a
            browser-native song list.
          </p>
        </section>
        <section className="sidebar-card">
          <h2>Library</h2>
          <div className="stat-grid">
            {renderStat('Charts', String(collection?.songs.length ?? 0))}
            {renderStat('Sources', String(collection?.sources.length ?? 0))}
            {renderStat('Errors', String(collection?.errors.length ?? 0))}
            {renderStat('Formats', resolveFormats(collection))}
          </div>
        </section>
        <section className="sidebar-card">
          <h2>{startedSong ? 'Now Playing' : 'Selection'}</h2>
          {visibleSong ? (
            <div>
              <p>{visibleSong.title}</p>
              {visibleSong.artist ? <p>{visibleSong.artist}</p> : null}
              <p>
                {visibleSong.sourceLabel} /{' '}
                {visibleSong.directoryLabel === '.'
                  ? visibleSong.fileLabel
                  : `${visibleSong.directoryLabel}/${visibleSong.fileLabel}`}
              </p>
              {visibleSong.genre ? <p>{`Genre: ${visibleSong.genre}`}</p> : null}
              {visibleSong.playLevel !== undefined ? <p>{`Level: ${visibleSong.playLevel}`}</p> : null}
              {visibleSong.bpm !== undefined ? <p>{`BPM: ${visibleSong.bpm}`}</p> : null}
            </div>
          ) : (
            <p>Drop a source and select a chart to inspect its metadata.</p>
          )}
        </section>
        <section className="sidebar-card">
          <h2>Keyboard</h2>
          <p>
            {startedSong
              ? 'Gameplay supports Space to pause and Escape to return to the browser scene.'
              : 'Click the song list once to focus it, then use ↑/↓ to move and Enter to start.'}
          </p>
          <p>
            {startedSong
              ? 'This scene is autoplay-first for now, and will grow toward full browser play.'
              : 'PageUp/PageDown, Home, and End are also available.'}
          </p>
        </section>
        <section className="sidebar-card">
          <h2>Next Steps</h2>
          <ul>
            <li>Reuse this source model for registry-backed ZIP downloads later.</li>
            <li>Swap the song-list scene with gameplay scenes while keeping the same mount API.</li>
            <li>Use the React and Vue adapters as thin shells around the same PixiJS core.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

function renderStat(label: string, value: string) {
  return (
    <div className="stat" key={label}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
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

createRoot(rootElement).render(<App />);
