[Japanese version](./README.ja.md)

# @be-music/audio-sample

Resolve a chart sample path, decode the audio and resample it to stereo PCM. Use `renderSingleSample` for a single keysound or `createSampleLoader` to reuse decoded samples across one chart render. File lookups use the chart directory, its `#PATH_WAV` prefix and the codec fallback order.
