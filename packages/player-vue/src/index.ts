import { BrowserSongLibrary, type BrowserSongCollection, type BrowserSongEntry } from '@be-music/player-web-core';
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type DefineComponent, type PropType } from 'vue';

export interface BeMusicBrowserLibraryProps {
  collection?: BrowserSongCollection;
  statusText?: string;
  enableDrop?: boolean;
}

export const BeMusicBrowserLibrary: DefineComponent = defineComponent({
  name: 'BeMusicBrowserLibrary',
  props: {
    collection: Object as PropType<BrowserSongCollection | undefined>,
    statusText: String,
    enableDrop: {
      type: Boolean,
      default: false,
    },
  },
  emits: {
    collectionChange: (_collection: BrowserSongCollection) => true,
    songSelect: (_song: BrowserSongEntry) => true,
    songActivate: (_song: BrowserSongEntry) => true,
    songExit: (_song: BrowserSongEntry) => true,
  },
  setup(props: Readonly<BeMusicBrowserLibraryProps>, { emit, attrs }) {
    const host = ref<HTMLDivElement | null>(null);
    const library = new BrowserSongLibrary({
      onCollectionChange: (collection) => emit('collectionChange', collection),
      onSongSelect: (song) => emit('songSelect', song),
      onSongActivate: (song) => emit('songActivate', song),
      onSongExit: (song) => emit('songExit', song),
    });

    onMounted(() => {
      if (!host.value) {
        return;
      }
      void library.mount(host.value).then(() => {
        if (props.collection) {
          library.setCollection(props.collection);
        }
        if (props.statusText) {
          library.setStatus(props.statusText);
        }
      });
    });

    onBeforeUnmount(() => {
      library.dispose();
    });

    watch(
      () => props.collection,
      (collection) => {
        if (collection) {
          library.setCollection(collection);
        }
      },
    );

    watch(
      () => props.statusText,
      (statusText) => {
        if (statusText) {
          library.setStatus(statusText);
        }
      },
    );

    return () =>
      h('div', {
        ...attrs,
        ref: host,
        onDragover: props.enableDrop
          ? (event: DragEvent) => {
              event.preventDefault();
            }
          : undefined,
        onDrop: props.enableDrop
          ? (event: DragEvent) => {
              event.preventDefault();
              if (event.dataTransfer) {
                void library.loadFromDrop(event.dataTransfer);
              }
            }
          : undefined,
      });
  },
});
