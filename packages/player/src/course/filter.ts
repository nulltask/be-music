/**
 * The SQL `WHERE` subset beatoraja random-course stages are written in, parsed and evaluated against a neutral song
 * record. beatoraja runs each stage's clause against its song database (`SQLiteSongDatabaseAccessor.getSongDatas`);
 * be-music has no database, so the clause is evaluated per candidate with SQLite's comparison rules.
 *
 * Anything outside the subset — an unknown column, a function call, a sub-query — is a parse error, so a stage with
 * such a filter selects nothing (beatoraja's query fails and returns no song the same way) instead of throwing at play
 * time.
 */

/**
 * One chart as a random-course filter sees it: the `song` table columns of beatoraja's song database that be-music
 * can supply. A missing text column reads as `''` and a missing integer column as `0`, the values beatoraja's
 * `SongData` stores for a chart that leaves them unset.
 */
export interface CourseSongRecord {
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
}

type CourseSongTextColumn = 'md5' | 'sha256' | 'title' | 'subtitle' | 'artist' | 'subartist' | 'genre' | 'tag' | 'path';
type CourseSongIntegerColumn = Exclude<keyof CourseSongRecord, CourseSongTextColumn>;

/** A column a filter can read: one of the {@link CourseSongRecord} fields. */
export type CourseSongColumn = keyof CourseSongRecord;

const COLUMN_TYPES: Readonly<Record<CourseSongColumn, 'text' | 'integer'>> = {
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
} satisfies Record<CourseSongTextColumn, 'text'> & Record<CourseSongIntegerColumn, 'integer'>;

/** An SQL value: SQLite's INTEGER / REAL (`number`), TEXT (`string`) or NULL. */
export type CourseSqlValue = number | string | null;

/** The parsed form of a filter. */
export type CourseSongFilterExpr =
  | {
      type: 'literal';
      value: CourseSqlValue;
      /** A number written with a `.` or an exponent: SQLite REAL. */ real?: true;
    }
  | { type: 'column'; column: CourseSongColumn }
  | { type: 'unary'; op: '-' | '+' | 'not'; operand: CourseSongFilterExpr }
  | {
      type: 'binary';
      op: 'or' | 'and' | '=' | '!=' | '<' | '<=' | '>' | '>=' | '&' | '|' | '+' | '-' | '*' | '/' | '%' | '||';
      left: CourseSongFilterExpr;
      right: CourseSongFilterExpr;
    }
  | { type: 'in'; operand: CourseSongFilterExpr; values: CourseSongFilterExpr[]; negated: boolean }
  | {
      type: 'like';
      operand: CourseSongFilterExpr;
      pattern: CourseSongFilterExpr;
      escape?: CourseSongFilterExpr;
      negated: boolean;
    }
  | {
      type: 'between';
      operand: CourseSongFilterExpr;
      low: CourseSongFilterExpr;
      high: CourseSongFilterExpr;
      negated: boolean;
    }
  | { type: 'isNull'; operand: CourseSongFilterExpr; negated: boolean };

export type CourseSongFilterParseResult = { ok: true; filter: CourseSongFilterExpr } | { ok: false; error: string };

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

const RESERVED = new Set(['and', 'or', 'not', 'in', 'like', 'between', 'is', 'null', 'escape']);

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): CourseSongFilterExpr {
    const expr = this.or();
    const next = this.peek();
    if (next.kind !== 'end') throw new FilterSyntaxError(`unexpected ${describe(next)} at ${next.at}`);
    return expr;
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

  private or(): CourseSongFilterExpr {
    let left = this.and();
    while (this.acceptKeyword('or')) left = { type: 'binary', op: 'or', left, right: this.and() };
    return left;
  }

  private and(): CourseSongFilterExpr {
    let left = this.not();
    while (this.acceptKeyword('and')) left = { type: 'binary', op: 'and', left, right: this.not() };
    return left;
  }

  private not(): CourseSongFilterExpr {
    if (this.acceptKeyword('not')) return { type: 'unary', op: 'not', operand: this.not() };
    return this.equality();
  }

  /** SQLite's equality tier: `=`, `==`, `!=`, `<>`, `IS [NOT] NULL`, `[NOT] IN`, `[NOT] LIKE`, `[NOT] BETWEEN`. */
  private equality(): CourseSongFilterExpr {
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
        const values: CourseSongFilterExpr[] = [];
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

  private relational(): CourseSongFilterExpr {
    let left = this.bitwise();
    for (;;) {
      const op = this.acceptOp('<', '<=', '>', '>=') as '<' | '<=' | '>' | '>=' | undefined;
      if (op === undefined) return left;
      left = { type: 'binary', op, left, right: this.bitwise() };
    }
  }

  private bitwise(): CourseSongFilterExpr {
    let left = this.additive();
    for (;;) {
      const op = this.acceptOp('&', '|') as '&' | '|' | undefined;
      if (op === undefined) return left;
      left = { type: 'binary', op, left, right: this.additive() };
    }
  }

  private additive(): CourseSongFilterExpr {
    let left = this.multiplicative();
    for (;;) {
      const op = this.acceptOp('+', '-') as '+' | '-' | undefined;
      if (op === undefined) return left;
      left = { type: 'binary', op, left, right: this.multiplicative() };
    }
  }

  private multiplicative(): CourseSongFilterExpr {
    let left = this.concat();
    for (;;) {
      const op = this.acceptOp('*', '/', '%') as '*' | '/' | '%' | undefined;
      if (op === undefined) return left;
      left = { type: 'binary', op, left, right: this.concat() };
    }
  }

  private concat(): CourseSongFilterExpr {
    let left = this.unary();
    while (this.acceptOp('||') !== undefined) left = { type: 'binary', op: '||', left, right: this.unary() };
    return left;
  }

  private unary(): CourseSongFilterExpr {
    const op = this.acceptOp('-', '+') as '-' | '+' | undefined;
    if (op !== undefined) return { type: 'unary', op, operand: this.unary() };
    return this.primary();
  }

  private primary(): CourseSongFilterExpr {
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
      if (this.acceptOp('.') !== undefined) {
        // Only the `song` table is modelled; `score.clear`, `scorelog.*` and `information.*` are not.
        if (name.toLowerCase() !== 'song') throw new FilterSyntaxError(`unsupported table '${name}'`);
        const column = this.next();
        if (column.kind !== 'word' && column.kind !== 'quoted') {
          throw new FilterSyntaxError(`expected a column name at ${column.at}`);
        }
        name = column.value;
      }
      if (this.peek().kind === 'op' && (this.peek() as { value: string }).value === '(') {
        throw new FilterSyntaxError(`functions are not supported: ${name}`);
      }
      const column = name.toLowerCase();
      if (!Object.hasOwn(COLUMN_TYPES, column)) throw new FilterSyntaxError(`unknown column '${name}'`);
      return { type: 'column', column: column as CourseSongColumn };
    }
    throw new FilterSyntaxError(`unexpected ${describe(token)} at ${token.at}`);
  }
}

function describe(token: Token): string {
  if (token.kind === 'end') return 'end of filter';
  return `'${String(token.value)}'`;
}

/**
 * Parses a random-course stage filter. Supported: column names (optionally `song.`-qualified, quoted with `"`, `` ` ``
 * or `[]`), string / number / `NULL` literals, `=` `==` `!=` `<>` `<` `<=` `>` `>=`, `AND` `OR` `NOT`, parentheses,
 * `[NOT] IN (…)`, `[NOT] LIKE … [ESCAPE …]`, `[NOT] BETWEEN … AND …`, `IS [NOT] NULL`, `+ - * / %`, `& |` and `||`.
 * Anything else — an unknown column, another table, a function, a sub-query — gives `{ ok: false }` with the reason.
 */
export function parseCourseSongFilter(sql: string): CourseSongFilterParseResult {
  try {
    return { ok: true, filter: new Parser(tokenize(sql)).parse() };
  } catch (error) {
    if (error instanceof FilterSyntaxError) return { ok: false, error: error.message };
    throw error;
  }
}

type Affinity = 'text' | 'integer' | 'none';

function affinityOf(expr: CourseSongFilterExpr): Affinity {
  return expr.type === 'column' ? COLUMN_TYPES[expr.column] : 'none';
}

function columnValue(record: CourseSongRecord, column: CourseSongColumn): CourseSqlValue {
  const value = record[column];
  if (COLUMN_TYPES[column] === 'text') return typeof value === 'string' ? value : '';
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** SQLite's NUMERIC affinity: a text value that reads as a number in full becomes that number. */
function applyNumericAffinity(value: CourseSqlValue): CourseSqlValue {
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
  left: CourseSongFilterExpr,
  right: CourseSongFilterExpr,
  record: CourseSongRecord,
): [CourseSqlValue, CourseSqlValue] {
  let a = evaluate(left, record);
  let b = evaluate(right, record);
  const la = affinityOf(left);
  const ra = affinityOf(right);
  if (la === 'integer' && ra !== 'integer') b = applyNumericAffinity(b);
  else if (ra === 'integer' && la !== 'integer') a = applyNumericAffinity(a);
  else if (la === 'text' && ra === 'none' && typeof b === 'number') b = toText(b);
  else if (ra === 'text' && la === 'none' && typeof a === 'number') a = toText(a);
  return [a, b];
}

function compare(
  op: '=' | '!=' | '<' | '<=' | '>' | '>=',
  left: CourseSongFilterExpr,
  right: CourseSongFilterExpr,
  record: CourseSongRecord,
): CourseSqlValue {
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
function truth(value: CourseSqlValue): boolean | null {
  if (value === null) return null;
  return toNumber(value) !== 0;
}

function fromTruth(value: boolean | null): CourseSqlValue {
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

/** Whether an arithmetic operand is REAL by type: a REAL literal, or arithmetic over one. */
function isRealExpr(expr: CourseSongFilterExpr): boolean {
  if (expr.type === 'literal') return expr.real === true;
  if (expr.type === 'unary') return expr.op !== 'not' && isRealExpr(expr.operand);
  if (expr.type === 'binary' && ['+', '-', '*', '/'].includes(expr.op))
    return isRealExpr(expr.left) || isRealExpr(expr.right);
  return false;
}

function arithmetic(op: '+' | '-' | '*' | '/' | '%' | '&' | '|', a: number, b: number, real: boolean): CourseSqlValue {
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

function evaluate(expr: CourseSongFilterExpr, record: CourseSongRecord): CourseSqlValue {
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'column':
      return columnValue(record, expr.column);
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
export function evaluateCourseSongFilter(filter: CourseSongFilterExpr, record: CourseSongRecord): boolean {
  return truth(evaluate(filter, record)) === true;
}
