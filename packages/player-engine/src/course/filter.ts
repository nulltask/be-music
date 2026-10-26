/**
 * The SQL `WHERE` subset beatoraja random-course stages are written in, parsed and evaluated against a neutral song
 * record. beatoraja runs each stage's clause against its song database (`SQLiteSongDatabaseAccessor.getSongDatas`),
 * appending it to `... WHERE ` over `song` joined with the player's `score` and `scorelog` (and `information` when song
 * information is on); be-music has no database, so the clause is evaluated per candidate with SQLite's comparison
 * rules over the candidate's song columns, its best record (`score`) and its song information (`information`), and a
 * trailing `ORDER BY … LIMIT …` orders and cuts the selection ({@link selectCourseCharts}).
 *
 * Anything outside the subset — an unknown column, a column the joined tables make ambiguous, a function call, a
 * sub-query — is a parse error, so a stage with such a filter selects nothing (beatoraja's query fails and returns no
 * song the same way) instead of throwing at play time.
 */

/**
 * One chart as a random-course filter sees it: the `song` table columns of beatoraja's song database that be-music
 * can supply, and the rows beatoraja joins to it, `score` (the player's best record) and `information` (the chart's
 * song information). A missing text column reads as `''` and a missing integer column as `0`, the values beatoraja's
 * `SongData` stores for a chart that leaves them unset.
 */
export interface CourseChartRecord {
  md5?: string;
  sha256?: string;
  title?: string;
  subtitle?: string;
  artist?: string;
  subartist?: string;
  genre?: string;
  tag?: string;
  /** The chart file path. */
  path?: string;
  /** `#PLAYLEVEL` as an integer (0 when it is not a number). */
  level?: number;
  /** `#DIFFICULTY` (1 BEGINNER … 5 INSANE, 0 undefined). */
  difficulty?: number;
  /** beatoraja's `Mode.id`: 5, 7, 9, 10, 14, 25 (24 keys) or 50 (24 keys double). */
  mode?: number;
  notes?: number;
  minbpm?: number;
  maxbpm?: number;
  /** Chart length in milliseconds. */
  length?: number;
  /** `#RANK` / bmson `judge_rank`. */
  judge?: number;
  /** beatoraja's `SongData.FEATURE_*` bits (LN 8, CN 16, HCN 32, mines 2, `#RANDOM` 4, STOP 64, scroll 128). */
  feature?: number;
  /** beatoraja's `SongData.CONTENT_*` bits (text 1, BGA 2, preview 4, no key sound 128). */
  content?: number;
  /**
   * The `score` row: the player's best record on the chart. Absent for a chart never played, so every `score.*` column
   * reads as NULL, as beatoraja's `LEFT OUTER JOIN` gives.
   */
  score?: CourseChartScore;
  /** The `information` row: the chart's song information. Absent, every `information.*` column reads as NULL. */
  information?: CourseChartInformation;
}

/**
 * The `score` columns be-music keeps (beatoraja's `ScoreDatabaseAccessor` table). A field left out reads as NULL.
 * `exscore` is be-music's own: beatoraja keeps the judgment counts instead (`epg`, `lpg`, …), which be-music does not.
 */
export interface CourseChartScore {
  /** The clear lamp as beatoraja's `ClearType.id`: 0 NO PLAY, 1 FAILED, 3 ASSIST EASY … 10 MAX. */
  clear?: number;
  exscore?: number;
  /** The max combo. */
  combo?: number;
  /** The fewest BP. */
  minbp?: number;
  playcount?: number;
  /** The chart's note count. */
  notes?: number;
}

/** The `information` columns (beatoraja's `SongInformation`). A field left out reads as NULL. */
export interface CourseChartInformation {
  /** Taps on the keys. */
  n?: number;
  /** Long notes on the keys (a CN / HCN counts its end too). */
  ln?: number;
  /** Taps on the scratch. */
  s?: number;
  /** Long notes on the scratch. */
  ls?: number;
  total?: number;
  /** Notes per second over the busy seconds. */
  density?: number;
  /** The busiest second. */
  peakdensity?: number;
  /** The busiest 5-second average from the TOTAL border on. */
  enddensity?: number;
  mainbpm?: number;
}

/** A table a filter column belongs to. */
export type CourseChartTable = 'song' | 'score' | 'information';

type CourseChartTextColumn =
  | 'md5'
  | 'sha256'
  | 'title'
  | 'subtitle'
  | 'artist'
  | 'subartist'
  | 'genre'
  | 'tag'
  | 'path';
type CourseChartSongColumn = Exclude<keyof CourseChartRecord, 'score' | 'information'>;
type CourseChartIntegerColumn = Exclude<CourseChartSongColumn, CourseChartTextColumn>;

/** A column a filter can read: a `song` column ({@link CourseChartRecord}), a `score` or an `information` one. */
export type CourseChartColumn = CourseChartSongColumn | keyof CourseChartScore | keyof CourseChartInformation;

type ColumnType = 'text' | 'integer' | 'real';

const SONG_COLUMN_TYPES: Readonly<Record<CourseChartSongColumn, ColumnType>> = {
  md5: 'text',
  sha256: 'text',
  title: 'text',
  subtitle: 'text',
  artist: 'text',
  subartist: 'text',
  genre: 'text',
  tag: 'text',
  path: 'text',
  level: 'integer',
  difficulty: 'integer',
  mode: 'integer',
  notes: 'integer',
  minbpm: 'integer',
  maxbpm: 'integer',
  length: 'integer',
  judge: 'integer',
  feature: 'integer',
  content: 'integer',
} satisfies Record<CourseChartTextColumn, 'text'> & Record<CourseChartIntegerColumn, 'integer'>;

/** `score.sha256` / `information.sha256` read the song's hash on a row that exists. */
const SCORE_COLUMN_TYPES: Readonly<Record<keyof CourseChartScore | 'sha256', ColumnType>> = {
  sha256: 'text',
  clear: 'integer',
  exscore: 'integer',
  combo: 'integer',
  minbp: 'integer',
  playcount: 'integer',
  notes: 'integer',
};

const INFORMATION_COLUMN_TYPES: Readonly<Record<keyof CourseChartInformation | 'sha256', ColumnType>> = {
  sha256: 'text',
  n: 'integer',
  ln: 'integer',
  s: 'integer',
  ls: 'integer',
  total: 'real',
  density: 'real',
  peakdensity: 'real',
  enddensity: 'real',
  mainbpm: 'real',
};

const COLUMN_TYPES: Readonly<Record<CourseChartTable, Readonly<Record<string, ColumnType>>>> = {
  song: SONG_COLUMN_TYPES,
  score: SCORE_COLUMN_TYPES,
  information: INFORMATION_COLUMN_TYPES,
};

/**
 * Every column of the tables beatoraja joins (`SQLiteSongDatabaseAccessor`, `ScoreDatabaseAccessor`,
 * `ScoreLogDatabaseAccessor`, `SongInformationAccessor` at beatoraja 83574048), whether be-music supplies it or not,
 * plus be-music's `score.exscore`. An unqualified column resolves to the one table that has it, as SQLite does; one
 * that more than one table has is refused (`ambiguous column name`), so the stage selects nothing as in beatoraja:
 * write `song.mode`, not `mode`. A column be-music has no source for (`song.date`, `score.epg`, every `scorelog`
 * column, …) is an unknown column rather than a made-up value.
 */
const BEATORAJA_COLUMNS: Readonly<Record<CourseChartTable | 'scorelog', readonly string[]>> = {
  song: [
    'md5',
    'sha256',
    'title',
    'subtitle',
    'genre',
    'artist',
    'subartist',
    'tag',
    'path',
    'folder',
    'stagefile',
    'banner',
    'backbmp',
    'preview',
    'parent',
    'level',
    'difficulty',
    'maxbpm',
    'minbpm',
    'length',
    'mode',
    'judge',
    'feature',
    'content',
    'date',
    'favorite',
    'adddate',
    'notes',
    'charthash',
  ],
  score: [
    'sha256',
    'mode',
    'clear',
    'epg',
    'lpg',
    'egr',
    'lgr',
    'egd',
    'lgd',
    'ebd',
    'lbd',
    'epr',
    'lpr',
    'ems',
    'lms',
    'notes',
    'combo',
    'minbp',
    'avgjudge',
    'playcount',
    'clearcount',
    'trophy',
    'ghost',
    'option',
    'seed',
    'random',
    'date',
    'state',
    'scorehash',
    'exscore',
  ],
  scorelog: [
    'sha256',
    'mode',
    'clear',
    'oldclear',
    'score',
    'oldscore',
    'combo',
    'oldcombo',
    'minbp',
    'oldminbp',
    'avgjudge',
    'oldavgjudge',
    'date',
  ],
  information: [
    'sha256',
    'n',
    'ln',
    's',
    'ls',
    'total',
    'density',
    'peakdensity',
    'enddensity',
    'mainbpm',
    'distribution',
    'speedchange',
    'lanenotes',
  ],
};

const TABLE_NAMES = Object.keys(BEATORAJA_COLUMNS) as ReadonlyArray<CourseChartTable | 'scorelog'>;

/** An SQL value: SQLite's INTEGER / REAL (`number`), TEXT (`string`) or NULL. */
export type CourseSQLValue = number | string | null;

/** The parsed form of a filter. */
export type CourseChartFilterExpr =
  | {
      type: 'literal';
      value: CourseSQLValue;
      /** A number written with a `.` or an exponent: SQLite REAL. */ real?: true;
    }
  | { type: 'column'; table: CourseChartTable; column: CourseChartColumn }
  | { type: 'unary'; op: '-' | '+' | 'not'; operand: CourseChartFilterExpr }
  | {
      type: 'binary';
      op: 'or' | 'and' | '=' | '!=' | '<' | '<=' | '>' | '>=' | '&' | '|' | '+' | '-' | '*' | '/' | '%' | '||';
      left: CourseChartFilterExpr;
      right: CourseChartFilterExpr;
    }
  | { type: 'in'; operand: CourseChartFilterExpr; values: CourseChartFilterExpr[]; negated: boolean }
  | {
      type: 'like';
      operand: CourseChartFilterExpr;
      pattern: CourseChartFilterExpr;
      escape?: CourseChartFilterExpr;
      negated: boolean;
    }
  | {
      type: 'between';
      operand: CourseChartFilterExpr;
      low: CourseChartFilterExpr;
      high: CourseChartFilterExpr;
      negated: boolean;
    }
  | { type: 'isNull'; operand: CourseChartFilterExpr; negated: boolean };

/** What an `ORDER BY` term sorts by: an expression, or SQLite's `RANDOM()`, which takes the injected random source. */
export type CourseChartOrderKey = CourseChartFilterExpr | { type: 'random' };

/** One `ORDER BY` term. */
export interface CourseChartOrderTerm {
  key: CourseChartOrderKey;
  descending: boolean;
  /** `NULLS FIRST` / `NULLS LAST`; absent, SQLite's default: NULL sorts first ascending and last descending. */
  nulls?: 'first' | 'last';
}

/** A whole stage filter: the `WHERE` clause and the trailing `ORDER BY` / `LIMIT` / `OFFSET` it may carry. */
export interface CourseChartQuery {
  where: CourseChartFilterExpr;
  /** Empty without `ORDER BY`: the selection keeps the candidates' order. */
  orderBy: CourseChartOrderTerm[];
  /** `LIMIT`; absent (or negative in the SQL) for none. */
  limit?: number;
  /** `OFFSET` (or the first number of `LIMIT m, n`); 0 without one, a negative one reading as 0, as in SQLite. */
  offset: number;
}

export type CourseChartFilterParseResult =
  | {
      ok: true;
      /** The `WHERE` clause alone ({@link evaluateCourseChartFilter}). */
      filter: CourseChartFilterExpr;
      /** The whole filter, ordering and limit included ({@link selectCourseCharts}). */
      query: CourseChartQuery;
    }
  | { ok: false; error: string };

type Token =
  | { kind: 'number'; value: number; real: boolean; at: number }
  | { kind: 'string'; value: string; at: number }
  | { kind: 'word'; value: string; at: number }
  | { kind: 'quoted'; value: string; at: number }
  | { kind: 'op'; value: string; at: number }
  | { kind: 'end'; at: number };

class FilterSyntaxError extends Error {}

const OPERATORS = [
  '<>',
  '!=',
  '==',
  '<=',
  '>=',
  '||',
  '=',
  '<',
  '>',
  '(',
  ')',
  ',',
  '.',
  '+',
  '-',
  '*',
  '/',
  '%',
  '&',
  '|',
];

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (/\s/u.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (c === "'") {
      let value = '';
      i++;
      for (;;) {
        if (i >= sql.length) throw new FilterSyntaxError(`unterminated string at ${at}`);
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += sql[i];
        i++;
      }
      tokens.push({ kind: 'string', value, at });
      continue;
    }
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      const end = sql.indexOf(close, i + 1);
      if (end < 0) throw new FilterSyntaxError(`unterminated identifier at ${at}`);
      tokens.push({ kind: 'quoted', value: sql.slice(i + 1, end), at });
      i = end + 1;
      continue;
    }
    const number = /^(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/u.exec(sql.slice(i));
    if (number !== null) {
      const text = number[0];
      if (/^[A-Za-z_]/u.test(sql.slice(i + text.length))) throw new FilterSyntaxError(`bad number at ${at}`);
      tokens.push({ kind: 'number', value: Number(text), real: !/^0[xX]/u.test(text) && /[.eE]/u.test(text), at });
      i += text.length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(sql.slice(i));
    if (word !== null) {
      tokens.push({ kind: 'word', value: word[0], at });
      i += word[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => sql.startsWith(candidate, i));
    if (op === undefined) throw new FilterSyntaxError(`unexpected '${c}' at ${at}`);
    tokens.push({ kind: 'op', value: op, at });
    i += op.length;
  }
  tokens.push({ kind: 'end', at: sql.length });
  return tokens;
}

const RESERVED = new Set(['and', 'or', 'not', 'in', 'like', 'between', 'is', 'null', 'escape', 'order', 'limit']);

class Parser {
  private index = 0;
  // A plain field, not a constructor parameter property: Node's type stripping (the bench runner) rejects those.
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): CourseChartQuery {
    const where = this.or();
    const orderBy = this.orderBy();
    let limit: number | undefined;
    let offset = 0;
    if (this.acceptKeyword('limit')) {
      const first = this.integer('LIMIT');
      if (this.acceptOp(',') !== undefined) {
        // `LIMIT m, n`: SQLite reads the first number as the offset.
        offset = first;
        limit = this.integer('LIMIT');
      } else {
        limit = first;
        if (this.acceptKeyword('offset')) offset = this.integer('OFFSET');
      }
    }
    const next = this.peek();
    if (next.kind !== 'end') throw new FilterSyntaxError(`unexpected ${describe(next)} at ${next.at}`);
    return {
      where,
      orderBy,
      ...(limit !== undefined && limit >= 0 ? { limit } : {}),
      offset: Math.max(0, offset),
    };
  }

  /** `ORDER BY term [ASC | DESC] [NULLS FIRST | LAST], …`, or nothing. */
  private orderBy(): CourseChartOrderTerm[] {
    if (!this.acceptKeyword('order')) return [];
    this.expectKeyword('by');
    const terms: CourseChartOrderTerm[] = [];
    do {
      let key: CourseChartOrderKey;
      const at = this.peek().at;
      const after = this.peek(1);
      if (this.isKeyword('random') && after.kind === 'op' && after.value === '(') {
        this.index += 2;
        this.expectOp(')');
        key = { type: 'random' };
      } else {
        key = this.or();
        // SQLite reads a bare integer as a result-column number, which depends on beatoraja's column list.
        if (key.type === 'literal' && typeof key.value === 'number') {
          throw new FilterSyntaxError(`ORDER BY a column number is not supported at ${at}`);
        }
      }
      let descending = false;
      if (this.acceptKeyword('desc')) descending = true;
      else this.acceptKeyword('asc');
      let nulls: 'first' | 'last' | undefined;
      if (this.acceptKeyword('nulls')) {
        if (this.acceptKeyword('first')) nulls = 'first';
        else if (this.acceptKeyword('last')) nulls = 'last';
        else throw new FilterSyntaxError(`expected FIRST or LAST at ${this.peek().at}`);
      }
      terms.push({ key, descending, ...(nulls !== undefined ? { nulls } : {}) });
    } while (this.acceptOp(',') !== undefined);
    return terms;
  }

  /** A `LIMIT` / `OFFSET` count: an integer literal, optionally signed. */
  private integer(clause: string): number {
    const sign = this.acceptOp('-', '+');
    const token = this.next();
    if (token.kind !== 'number' || token.real || !Number.isSafeInteger(token.value)) {
      throw new FilterSyntaxError(`${clause} takes an integer at ${token.at}`);
    }
    return sign === '-' ? -token.value : token.value;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.index++;
    return token;
  }

  private isKeyword(name: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'word' && token.value.toLowerCase() === name;
  }

  private acceptKeyword(name: string): boolean {
    if (!this.isKeyword(name)) return false;
    this.index++;
    return true;
  }

  private expectKeyword(name: string): void {
    if (!this.acceptKeyword(name)) {
      const token = this.peek();
      throw new FilterSyntaxError(`expected ${name.toUpperCase()} at ${token.at}`);
    }
  }

  private acceptOp(...ops: string[]): string | undefined {
    const token = this.peek();
    if (token.kind === 'op' && ops.includes(token.value)) {
      this.index++;
      return token.value;
    }
    return undefined;
  }

  private expectOp(op: string): void {
    if (this.acceptOp(op) === undefined) {
      const token = this.peek();
      throw new FilterSyntaxError(`expected '${op}' at ${token.at}`);
    }
  }

  private or(): CourseChartFilterExpr {
    let left = this.and();
    while (this.acceptKeyword('or')) left = { type: 'binary', op: 'or', left, right: this.and() };
    return left;
  }

  private and(): CourseChartFilterExpr {
    let left = this.not();
    while (this.acceptKeyword('and')) left = { type: 'binary', op: 'and', left, right: this.not() };
    return left;
  }

  private not(): CourseChartFilterExpr {
    if (this.acceptKeyword('not')) return { type: 'unary', op: 'not', operand: this.not() };
    return this.equality();
  }

  /** SQLite's equality tier: `=`, `==`, `!=`, `<>`, `IS [NOT] NULL`, `[NOT] IN`, `[NOT] LIKE`, `[NOT] BETWEEN`. */
  private equality(): CourseChartFilterExpr {
    let left = this.relational();
    for (;;) {
      const op = this.acceptOp('=', '==', '!=', '<>');
      if (op !== undefined) {
        left = { type: 'binary', op: op === '=' || op === '==' ? '=' : '!=', left, right: this.relational() };
        continue;
      }
      if (this.acceptKeyword('is')) {
        const negated = this.acceptKeyword('not');
        this.expectKeyword('null');
        left = { type: 'isNull', operand: left, negated };
        continue;
      }
      const negated = this.isKeyword('not') && ['in', 'like', 'between'].some((name) => this.isKeyword(name, 1));
      if (negated) this.index++;
      if (this.acceptKeyword('in')) {
        this.expectOp('(');
        if (this.isKeyword('select')) throw new FilterSyntaxError(`sub-queries are not supported`);
        const values: CourseChartFilterExpr[] = [];
        if (this.acceptOp(')') === undefined) {
          do values.push(this.or());
          while (this.acceptOp(',') !== undefined);
          this.expectOp(')');
        }
        left = { type: 'in', operand: left, values, negated };
        continue;
      }
      if (this.acceptKeyword('like')) {
        const pattern = this.relational();
        const escape = this.acceptKeyword('escape') ? this.relational() : undefined;
        left = { type: 'like', operand: left, pattern, ...(escape !== undefined ? { escape } : {}), negated };
        continue;
      }
      if (this.acceptKeyword('between')) {
        const low = this.relational();
        this.expectKeyword('and');
        left = { type: 'between', operand: left, low, high: this.relational(), negated };
        continue;
      }
      return left;
    }
  }

  private relational(): CourseChartFilterExpr {
    let left = this.bitwise();
    for (;;) {
      const op = this.acceptOp('<', '<=', '>', '>=') as '<' | '<=' | '>' | '>=' | undefined;
      if (op === undefined) return left;
      left = { type: 'binary', op, left, right: this.bitwise() };
    }
  }

  private bitwise(): CourseChartFilterExpr {
    let left = this.additive();
    for (;;) {
      const op = this.acceptOp('&', '|') as '&' | '|' | undefined;
      if (op === undefined) return left;
      left = { type: 'binary', op, left, right: this.additive() };
    }
  }

  private additive(): CourseChartFilterExpr {
    let left = this.multiplicative();
    for (;;) {
      const op = this.acceptOp('+', '-') as '+' | '-' | undefined;
      if (op === undefined) return left;
      left = { type: 'binary', op, left, right: this.multiplicative() };
    }
  }

  private multiplicative(): CourseChartFilterExpr {
    let left = this.concat();
    for (;;) {
      const op = this.acceptOp('*', '/', '%') as '*' | '/' | '%' | undefined;
      if (op === undefined) return left;
      left = { type: 'binary', op, left, right: this.concat() };
    }
  }

  private concat(): CourseChartFilterExpr {
    let left = this.unary();
    while (this.acceptOp('||') !== undefined) left = { type: 'binary', op: '||', left, right: this.unary() };
    return left;
  }

  private unary(): CourseChartFilterExpr {
    const op = this.acceptOp('-', '+') as '-' | '+' | undefined;
    if (op !== undefined) return { type: 'unary', op, operand: this.unary() };
    return this.primary();
  }

  private primary(): CourseChartFilterExpr {
    const token = this.next();
    if (token.kind === 'number') return { type: 'literal', value: token.value, ...(token.real ? { real: true } : {}) };
    if (token.kind === 'string') return { type: 'literal', value: token.value };
    if (token.kind === 'op' && token.value === '(') {
      if (this.isKeyword('select')) throw new FilterSyntaxError(`sub-queries are not supported`);
      const inner = this.or();
      this.expectOp(')');
      return inner;
    }
    if (token.kind === 'word' && token.value.toLowerCase() === 'null') return { type: 'literal', value: null };
    if (token.kind === 'word' || token.kind === 'quoted') {
      if (token.kind === 'word' && RESERVED.has(token.value.toLowerCase())) {
        throw new FilterSyntaxError(`unexpected ${token.value.toUpperCase()} at ${token.at}`);
      }
      let name = token.value;
      let table: string | undefined;
      if (this.acceptOp('.') !== undefined) {
        table = name.toLowerCase();
        if (!(TABLE_NAMES as readonly string[]).includes(table)) throw new FilterSyntaxError(`no such table: ${name}`);
        const column = this.next();
        if (column.kind !== 'word' && column.kind !== 'quoted') {
          throw new FilterSyntaxError(`expected a column name at ${column.at}`);
        }
        name = column.value;
      }
      if (this.peek().kind === 'op' && (this.peek() as { value: string }).value === '(') {
        throw new FilterSyntaxError(`functions are not supported: ${name}`);
      }
      return resolveColumn(table, name);
    }
    throw new FilterSyntaxError(`unexpected ${describe(token)} at ${token.at}`);
  }
}

/**
 * The column `table.name` (or `name` alone) names, resolved as SQLite resolves it over beatoraja's joined tables:
 * unqualified, it must belong to exactly one of them. A column be-music has no source for is an unknown column.
 */
function resolveColumn(table: string | undefined, name: string): CourseChartFilterExpr {
  const column = name.toLowerCase();
  let owner = table;
  if (owner === undefined) {
    const owners = TABLE_NAMES.filter((candidate) => BEATORAJA_COLUMNS[candidate].includes(column));
    if (owners.length > 1) throw new FilterSyntaxError(`ambiguous column name: ${name}`);
    owner = owners[0] ?? 'song';
  }
  const label = table === undefined ? name : `${table}.${name}`;
  if (owner === 'scorelog' || !Object.hasOwn(COLUMN_TYPES[owner as CourseChartTable], column)) {
    throw new FilterSyntaxError(`unknown column '${label}'`);
  }
  return { type: 'column', table: owner as CourseChartTable, column: column as CourseChartColumn };
}

function describe(token: Token): string {
  if (token.kind === 'end') return 'end of filter';
  return `'${String(token.value)}'`;
}

/**
 * Parses a random-course stage filter. Supported: column names (optionally qualified with `song.`, `score.` or
 * `information.`, quoted with `"`, `` ` `` or `[]`), string / number / `NULL` literals, `=` `==` `!=` `<>` `<` `<=` `>` `>=`, `AND` `OR` `NOT`, parentheses,
 * `[NOT] IN (…)`, `[NOT] LIKE … [ESCAPE …]`, `[NOT] BETWEEN … AND …`, `IS [NOT] NULL`, `+ - * / %`, `& |` and `||`,
 * then an optional `ORDER BY expr | RANDOM() [ASC | DESC] [NULLS FIRST | LAST], …` and `LIMIT n [OFFSET m]` /
 * `LIMIT m, n`. Anything else — an unknown column, an unqualified column beatoraja's joined tables share (`mode`,
 * `notes`, `sha256`, …), a column be-music has no source for (`scorelog.*`, `score.epg`, …), a function, a sub-query — gives `{ ok: false }` with the reason.
 */
export function parseCourseChartFilter(sql: string): CourseChartFilterParseResult {
  try {
    const query = new Parser(tokenize(sql)).parse();
    return { ok: true, filter: query.where, query };
  } catch (error) {
    if (error instanceof FilterSyntaxError) return { ok: false, error: error.message };
    throw error;
  }
}

/** A column's affinity: TEXT, or NUMERIC for an INTEGER or a REAL column; `none` for any other expression. */
type Affinity = 'text' | 'numeric' | 'none';

function columnType(expr: Extract<CourseChartFilterExpr, { type: 'column' }>): ColumnType {
  return COLUMN_TYPES[expr.table][expr.column]!;
}

function affinityOf(expr: CourseChartFilterExpr): Affinity {
  if (expr.type !== 'column') return 'none';
  return columnType(expr) === 'text' ? 'text' : 'numeric';
}

function columnValue(
  record: CourseChartRecord,
  expr: Extract<CourseChartFilterExpr, { type: 'column' }>,
): CourseSQLValue {
  const type = columnType(expr);
  if (expr.table === 'song') {
    const value = record[expr.column as CourseChartSongColumn];
    if (type === 'text') return typeof value === 'string' ? value : '';
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  // A joined row the record lacks reads as NULL in every column, as an outer join gives; so does a field it lacks.
  const row = record[expr.table];
  if (row === undefined) return null;
  if (expr.column === 'sha256') return record.sha256 ?? '';
  const value = (row as Readonly<Record<string, unknown>>)[expr.column];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** SQLite's NUMERIC affinity: a text value that reads as a number in full becomes that number. */
function applyNumericAffinity(value: CourseSQLValue): CourseSQLValue {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length === 0 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) return value;
  return Number(trimmed);
}

function toText(value: number | string): string {
  return typeof value === 'string' ? value : String(value);
}

/** SQLite's conversion of a value to a number for arithmetic: the longest numeric prefix of a text, else 0. */
function toNumber(value: number | string): number {
  if (typeof value === 'number') return value;
  const prefix = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(value);
  return prefix === null ? 0 : Number(prefix[0]);
}

/** SQLite's sort order: numbers before text, numbers by value, text by code unit (BINARY collation). */
function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The operands of a comparison with SQLite's affinity rules applied (INTEGER beats TEXT beats none). */
function comparisonOperands(
  left: CourseChartFilterExpr,
  right: CourseChartFilterExpr,
  record: CourseChartRecord,
): [CourseSQLValue, CourseSQLValue] {
  let a = evaluate(left, record);
  let b = evaluate(right, record);
  const la = affinityOf(left);
  const ra = affinityOf(right);
  if (la === 'numeric' && ra !== 'numeric') b = applyNumericAffinity(b);
  else if (ra === 'numeric' && la !== 'numeric') a = applyNumericAffinity(a);
  else if (la === 'text' && ra === 'none' && typeof b === 'number') b = toText(b);
  else if (ra === 'text' && la === 'none' && typeof a === 'number') a = toText(a);
  return [a, b];
}

function compare(
  op: '=' | '!=' | '<' | '<=' | '>' | '>=',
  left: CourseChartFilterExpr,
  right: CourseChartFilterExpr,
  record: CourseChartRecord,
): CourseSQLValue {
  const [a, b] = comparisonOperands(left, right, record);
  if (a === null || b === null) return null;
  const order = compareValues(a, b);
  const result =
    op === '='
      ? order === 0
      : op === '!='
        ? order !== 0
        : op === '<'
          ? order < 0
          : op === '<='
            ? order <= 0
            : op === '>'
              ? order > 0
              : order >= 0;
  return result ? 1 : 0;
}

/** Three-valued truth: `true`, `false`, or `null` (unknown). */
function truth(value: CourseSQLValue): boolean | null {
  if (value === null) return null;
  return toNumber(value) !== 0;
}

function fromTruth(value: boolean | null): CourseSQLValue {
  return value === null ? null : value ? 1 : 0;
}

/** SQLite folds ASCII letters only for `LIKE`. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/gu, (c) => c.toLowerCase());
}

const likePatterns = new Map<string, RegExp>();

function like(text: string, pattern: string, escape: string | undefined): boolean {
  const key = `${escape ?? ''}\u0000${pattern}`;
  let regex = likePatterns.get(key);
  if (regex === undefined) {
    regex = likePattern(pattern, escape);
    // A filter set has a handful of patterns; the cap only stops an adversarial one from growing without bound.
    if (likePatterns.size >= 256) likePatterns.clear();
    likePatterns.set(key, regex);
  }
  return regex.test(text);
}

function likePattern(pattern: string, escape: string | undefined): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (escape !== undefined && c === escape && i + 1 < pattern.length) {
      i++;
      source += pattern[i]!.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    } else if (c === '%') source += '[\\s\\S]*';
    else if (c === '_') source += '[\\s\\S]';
    else source += c.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`${source}$`, 'u');
}

/** Whether an arithmetic operand is REAL by type: a REAL literal or column, or arithmetic over one. */
function isRealExpr(expr: CourseChartFilterExpr): boolean {
  if (expr.type === 'literal') return expr.real === true;
  if (expr.type === 'column') return columnType(expr) === 'real';
  if (expr.type === 'unary') return expr.op !== 'not' && isRealExpr(expr.operand);
  if (expr.type === 'binary' && ['+', '-', '*', '/'].includes(expr.op))
    return isRealExpr(expr.left) || isRealExpr(expr.right);
  return false;
}

function arithmetic(op: '+' | '-' | '*' | '/' | '%' | '&' | '|', a: number, b: number, real: boolean): CourseSQLValue {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) return null;
      return !real && Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b;
    case '%': {
      const divisor = Math.trunc(b);
      return divisor === 0 ? null : Math.trunc(a) % divisor;
    }
    case '&':
    case '|': {
      // SQLite's bitwise operators work on 64-bit integers.
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      const x = BigInt.asIntN(64, BigInt(Math.trunc(a)));
      const y = BigInt.asIntN(64, BigInt(Math.trunc(b)));
      return Number(op === '&' ? x & y : x | y);
    }
  }
}

function evaluate(expr: CourseChartFilterExpr, record: CourseChartRecord): CourseSQLValue {
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'column':
      return columnValue(record, expr);
    case 'unary': {
      const value = evaluate(expr.operand, record);
      if (expr.op === 'not') {
        const t = truth(value);
        return fromTruth(t === null ? null : !t);
      }
      if (value === null) return null;
      return expr.op === '-' ? -toNumber(value) : expr.op === '+' ? value : null;
    }
    case 'binary': {
      const { op } = expr;
      if (op === 'and' || op === 'or') {
        const a = truth(evaluate(expr.left, record));
        const b = truth(evaluate(expr.right, record));
        if (op === 'and') return fromTruth(a === false || b === false ? false : a === null || b === null ? null : true);
        return fromTruth(a === true || b === true ? true : a === null || b === null ? null : false);
      }
      if (op === '=' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
        return compare(op, expr.left, expr.right, record);
      }
      const a = evaluate(expr.left, record);
      const b = evaluate(expr.right, record);
      if (a === null || b === null) return null;
      if (op === '||') return toText(a) + toText(b);
      return arithmetic(op, toNumber(a), toNumber(b), isRealExpr(expr.left) || isRealExpr(expr.right));
    }
    case 'in': {
      let sawNull = false;
      for (const value of expr.values) {
        const result = compare('=', expr.operand, value, record);
        if (result === null) sawNull = true;
        else if (result === 1) return expr.negated ? 0 : 1;
      }
      if (evaluate(expr.operand, record) === null || sawNull) return null;
      return expr.negated ? 1 : 0;
    }
    case 'like': {
      const text = evaluate(expr.operand, record);
      const pattern = evaluate(expr.pattern, record);
      const escape = expr.escape !== undefined ? evaluate(expr.escape, record) : undefined;
      if (text === null || pattern === null || escape === null) return null;
      const escapeChar = escape !== undefined ? toText(escape) : undefined;
      const matched = like(
        asciiLower(toText(text)),
        asciiLower(toText(pattern)),
        escapeChar !== undefined ? asciiLower(escapeChar) : undefined,
      );
      return matched !== expr.negated ? 1 : 0;
    }
    case 'between': {
      const low = truth(compare('>=', expr.operand, expr.low, record));
      const high = truth(compare('<=', expr.operand, expr.high, record));
      const inside = low === false || high === false ? false : low === null || high === null ? null : true;
      return fromTruth(inside === null ? null : inside !== expr.negated);
    }
    case 'isNull':
      return (evaluate(expr.operand, record) === null) !== expr.negated ? 1 : 0;
  }
}

/** Whether a record passes a parsed filter: the clause is true (an unknown / NULL result does not pass, as in SQL). */
export function evaluateCourseChartFilter(filter: CourseChartFilterExpr, record: CourseChartRecord): boolean {
  return truth(evaluate(filter, record)) === true;
}

/** SQLite's `ORDER BY` order of two values for one term: NULL first ascending, last descending, unless `nulls` says. */
function compareOrderValues(a: CourseSQLValue, b: CourseSQLValue, term: CourseChartOrderTerm): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    const nullsFirst = term.nulls !== undefined ? term.nulls === 'first' : !term.descending;
    return (a === null) === nullsFirst ? -1 : 1;
  }
  const order = compareValues(a, b);
  return term.descending ? -order : order;
}

/**
 * The candidates a whole stage filter selects, in its order: those its `WHERE` clause passes, sorted by its
 * `ORDER BY` (ties keep the candidates' order, so the result is deterministic), then cut by its `OFFSET` / `LIMIT`.
 * `recordOf` gives each candidate's {@link CourseChartRecord}. `ORDER BY RANDOM()` draws one value per selected
 * candidate, in the candidates' order, from `random` (values in `[0, 1)` like `Math.random`), and throws without it.
 */
export function selectCourseCharts<T>(
  query: CourseChartQuery,
  candidates: readonly T[],
  recordOf: (candidate: T) => CourseChartRecord,
  random?: () => number,
): T[] {
  const selected = candidates.filter((candidate) => evaluateCourseChartFilter(query.where, recordOf(candidate)));
  let ordered = selected;
  if (query.orderBy.length > 0) {
    const keyed = selected.map((candidate) => {
      const record = recordOf(candidate);
      const keys = query.orderBy.map(({ key }): CourseSQLValue => {
        if (key.type !== 'random') return evaluate(key, record);
        if (random === undefined) throw new Error('ORDER BY RANDOM() needs a random source');
        return random();
      });
      return { candidate, keys };
    });
    keyed.sort((a, b) => {
      for (const [index, term] of query.orderBy.entries()) {
        const order = compareOrderValues(a.keys[index]!, b.keys[index]!, term);
        if (order !== 0) return order;
      }
      return 0;
    });
    ordered = keyed.map(({ candidate }) => candidate);
  }
  const end = query.limit !== undefined ? query.offset + query.limit : undefined;
  return ordered.slice(query.offset, end);
}
