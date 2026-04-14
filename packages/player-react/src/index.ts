import { createElement, useEffect, useRef, type ReactElement } from 'react';
import { BrowserSongLibrary, type BrowserSongLibraryOptions, type BrowserSongCollection, type BrowserSongEntry } from '@be-music/player-web-core';

export interface BeMusicBrowserLibraryProps {
  className?: string;
  collection?: BrowserSongCollection;
  statusText?: string;
  enableDrop?: boolean;
  onCollectionChange?: (collection: BrowserSongCollection) => void;
  onSongSelect?: (song: BrowserSongEntry) => void;
  onSongActivate?: (song: BrowserSongEntry) => void;
  onSongExit?: (song: BrowserSongEntry) => void;
}

export function BeMusicBrowserLibrary(props: BeMusicBrowserLibraryProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const libraryRef = useRef<BrowserSongLibrary | null>(null);
  const callbackRef = useRef<
    Pick<BeMusicBrowserLibraryProps, 'onCollectionChange' | 'onSongSelect' | 'onSongActivate' | 'onSongExit'>
  >({
    onCollectionChange: props.onCollectionChange,
    onSongSelect: props.onSongSelect,
    onSongActivate: props.onSongActivate,
    onSongExit: props.onSongExit,
  });

  callbackRef.current.onCollectionChange = props.onCollectionChange;
  callbackRef.current.onSongSelect = props.onSongSelect;
  callbackRef.current.onSongActivate = props.onSongActivate;
  callbackRef.current.onSongExit = props.onSongExit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const library = new BrowserSongLibrary({
      onCollectionChange: (collection) => callbackRef.current.onCollectionChange?.(collection),
      onSongSelect: (song) => callbackRef.current.onSongSelect?.(song),
      onSongActivate: (song) => callbackRef.current.onSongActivate?.(song),
      onSongExit: (song) => callbackRef.current.onSongExit?.(song),
    } satisfies BrowserSongLibraryOptions);
    libraryRef.current = library;
    void library.mount(host).then(() => {
      if (props.collection) {
        library.setCollection(props.collection);
      }
      if (props.statusText) {
        library.setStatus(props.statusText);
      }
    });
    return () => {
      library.dispose();
      libraryRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (props.collection) {
      libraryRef.current?.setCollection(props.collection);
    }
  }, [props.collection]);

  useEffect(() => {
    if (props.statusText) {
      libraryRef.current?.setStatus(props.statusText);
    }
  }, [props.statusText]);

  return createElement('div', {
    className: props.className,
    onDragOver: props.enableDrop ? handleDragOver : undefined,
    onDrop: props.enableDrop
      ? (event: DragEvent) => {
          handleDragOver(event);
          const transfer = event.dataTransfer;
          if (!transfer) {
            return;
          }
          void libraryRef.current?.loadFromDrop(transfer);
        }
      : undefined,
    ref: hostRef,
  });
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault();
}
