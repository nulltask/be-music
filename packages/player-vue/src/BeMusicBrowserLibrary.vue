<script setup lang="ts">
import { BrowserSongLibrary, type BrowserSongCollection, type BrowserSongEntry } from '@be-music/player-web-core';
import { onBeforeUnmount, onMounted, ref, useAttrs, watch } from 'vue';
import type { BeMusicBrowserLibraryProps } from './types.ts';

defineOptions({
  name: 'BeMusicBrowserLibrary',
  inheritAttrs: false,
});

const props = withDefaults(defineProps<BeMusicBrowserLibraryProps>(), {
  enableDrop: false,
});

const emit = defineEmits<{
  collectionChange: [collection: BrowserSongCollection];
  songSelect: [song: BrowserSongEntry];
  songActivate: [song: BrowserSongEntry];
  songExit: [song: BrowserSongEntry];
}>();

const attrs = useAttrs();
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

function handleDragOver(event: DragEvent): void {
  if (!props.enableDrop) {
    return;
  }
  event.preventDefault();
}

function handleDrop(event: DragEvent): void {
  if (!props.enableDrop) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    void library.loadFromDrop(event.dataTransfer);
  }
}
</script>

<template>
  <div
    v-bind="attrs"
    ref="host"
    @dragover="handleDragOver"
    @drop="handleDrop"
  />
</template>
