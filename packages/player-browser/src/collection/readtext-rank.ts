/**
 * Which of a chart folder's text files reads most like its README: the one the README dialog opens on when a folder
 * ships several (a BGA or difference-chart note, a score-attack entry, lyrics, a chart saved as `.txt` beside it).
 *
 * The score adds a weight for each clue in the file name and the head of the text. The weights are the log likelihood
 * ratios of the clues measured over 122 hand-labelled chart folders with two or more text files (1990s BM98 packages
 * through 2025 BMS event packages): how much likelier each clue is on the file the author meant as the README than on
 * the others. On that set the highest score picks the README for 96% of the folders, against 48% for the first file in
 * the listing, 71% for the first file named `readme`, and 66% for the largest file.
 */

/** A text file of a chart folder: its file name (no folder) and its decoded text. */
export interface ReadtextFile {
  readonly name: string;
  readonly text: string;
}

/** How far into a text its content clues are looked for. */
const HEAD_LENGTH = 4000;

interface Clue {
  readonly weight: number;
  readonly test: (stem: string, head: string) => boolean;
}

const CLUES: readonly Clue[] = [
  // A README word anywhere in the name: `readme`, `read me`, `read_me!`, `re@dme`, `りーどみ`, `読んで`, `lesen mich`.
  { weight: 0.6, test: (stem) => /re[a@]d[\s_-]*(?:me|みー|myu)|りーどみ|リードミ|読|lesen/u.test(stem) },
  // The name is just `readme`, with only numbering or symbols around it (`_readme`, `@readme`, `001_readme`, `readme!!`).
  {
    weight: 2.5,
    test: (stem) =>
      /^(?:readme|read me|read_me|read-me|re@dme)$/u.test(
        stem.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, ''),
      ),
  },
  // An information or comment file: `info`, `infomation`, `曲説明`, `コメント`.
  { weight: 0.8, test: (stem) => /info|説明|コメント|comment|about/u.test(stem) },
  // A secondary README: the BGA's, a difference chart's, a second or lettered one (`readmebga`, `readme2`, `readme-b`).
  {
    weight: -2.2,
    test: (stem) =>
      /bga|bmp|movie|sabun|差分|2nd|vocal|easy|imp|_?2p|\(\d\)|readme\s*\d|no\d|_[a-z]$|-[a-z]$|readme[a-z]{1,2}$/u.test(
        stem,
      ),
  },
  // Not a README at all: a score-attack entry, lyrics, a story, chords, a sample list, a notice, a chart.
  {
    weight: -3.2,
    test: (stem) =>
      /score|lyric|歌詞|story|chord|script|answer|credit|sampling|notice|danger|attention|note|未配置|template|_bms$|typed/u.test(
        stem,
      ),
  },
  // A score-attack entry form, as BM98's score sites took them.
  { weight: -3.2, test: (_, head) => head.trimStart().startsWith('[Start of Score]') },
  // A chart saved as text (its header and channel lines).
  {
    weight: -2.7,
    test: (_, head) =>
      (/^\s*#(?:PLAYER|WAV|BPM|TITLE)\b|HEADER FIELD/imu.test(head) && /^#\d{5}:/mu.test(head)) ||
      head.split('\n#WAV').length > 4,
  },
  // Two or more kinds of chart metadata near the top: genre, title, artist, BPM, level.
  {
    weight: 0.8,
    test: (_, head) => {
      const kinds = new Set<string>();
      const pattern = /genre|genle|title|artist|bpm|ジャンル|ｼﾞｬﾝﾙ|タイトル|ﾀｲﾄﾙ|曲名|作曲|level|難易度/giu;
      for (const match of head.slice(0, 1500).matchAll(pattern)) kinds.add(match[0].toLowerCase());
      return kinds.size >= 2;
    },
  },
  // A note for files to merge into another chart's folder: a difference chart or an overwrite.
  { weight: -1.7, test: (_, head) => /差分|sabun|上書き|フォルダ(?:の中)?に(?:入れ|放り)/iu.test(head.slice(0, 400)) },
  // A note that opens about the BGA or its images.
  { weight: -0.5, test: (_, head) => /bga|bmp|アニメーション/iu.test(head.slice(0, 200)) },
];

/** How much `file` reads like its folder's README; higher is likelier. See the module comment. */
export function readtextScore(file: ReadtextFile): number {
  const stem = file.name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.txt$/u, '');
  const head = file.text.slice(0, HEAD_LENGTH);
  let score = 0;
  for (const clue of CLUES) if (clue.test(stem, head)) score += clue.weight;
  return score;
}

/** `files` with the likeliest README first ({@link readtextScore}); files that score the same keep their order. */
export function rankReadtexts<T extends ReadtextFile>(files: readonly T[]): T[] {
  return files
    .map((file, index) => ({ file, index, score: readtextScore(file) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ file }) => file);
}
