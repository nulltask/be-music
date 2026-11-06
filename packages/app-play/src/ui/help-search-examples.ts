/** One search Help shows on its Usage tab: the text to type, and what it lists in English and Japanese. */
export interface HelpSearchExample {
  readonly query: string;
  readonly en: string;
  readonly ja: string;
}

/**
 * The searches Help's Usage tab lists under "Searching charts". `help-search-examples.test.ts` runs each one through
 * the select screen's search over a small library, so every example listed is one that filters as described.
 */
export const HELP_SEARCH_EXAMPLES: readonly HelpSearchExample[] = [
  {
    query: 'ignition',
    en: 'charts with “ignition” in the title, subtitle, artist, genre or file name',
    ja: 'タイトル・サブタイトル・アーティスト・ジャンル・ファイル名に「ignition」を含む譜面',
  },
  {
    query: '?level BETWEEN 10 AND 12',
    en: 'level 10 to 12',
    ja: 'レベル 10〜12',
  },
  {
    query: '?song.mode = 7 AND difficulty = 4',
    en: '7-key ANOTHER charts',
    ja: '7 鍵の ANOTHER',
  },
  {
    query: "?artist LIKE '%yamd%'",
    en: 'artist contains “yamd” (any case)',
    ja: 'アーティストに「yamd」を含む (大文字と小文字を区別しません)',
  },
  {
    query: '?maxbpm >= 180 AND minbpm <> maxbpm',
    en: 'reaches BPM 180 and changes BPM',
    ja: 'BPM 180 以上に達し、BPM が変わる譜面',
  },
  {
    query: '?score.clear IS NULL OR score.clear < 5',
    en: 'not yet cleared on NORMAL or better, never-played charts included',
    ja: 'NORMAL 以上でまだクリアしていない譜面 (未プレイを含む)',
  },
  {
    query: "?level >= 10 AND NOT genre IN ('TRANCE', 'HARDCORE')",
    en: 'level 10 or higher, except the genres TRANCE and HARDCORE (exact, case-sensitive)',
    ja: 'レベル 10 以上で、ジャンルが TRANCE と HARDCORE のもの以外 (完全一致・大文字と小文字を区別)',
  },
  {
    query: '?playcount > 0 ORDER BY playcount DESC LIMIT 10',
    en: 'your 10 most played charts, most played first',
    ja: 'プレイ回数の多い 10 譜面を多い順に',
  },
];
