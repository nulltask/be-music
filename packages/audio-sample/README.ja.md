[English version](./README.md)

# @be-music/audio-sample

譜面のサンプルパスを解決し、音声をデコードしてステレオ PCM に変換します。キー音を個別に取得するには `renderSingleSample`、譜面内でデコード結果を再利用するには `createSampleLoader` を使います。ファイルの検索には譜面ディレクトリ、`#PATH_WAV` の指定、コーデックのフォールバック順を使います。
