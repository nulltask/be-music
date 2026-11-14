import { describe, expect, it } from 'vite-plus/test';
import { parseLuaFileMode, readLuaFileFormat } from './lua-io.ts';
import { evaluateBeatorajaLuaSkin } from './lua.ts';

const enc = (source: string): Uint8Array => new TextEncoder().encode(source);

/** Runs `lines` as a skin entry and returns the table it returns. */
function run(lines: readonly string[]): unknown {
  const result = evaluateBeatorajaLuaSkin({ entry: enc(lines.join('\n')), modules: [] });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('parseLuaFileMode', () => {
  it('reads the modes Lua accepts', () => {
    expect(parseLuaFileMode('r')).toEqual({
      readable: true,
      writable: false,
      append: false,
      truncate: false,
      mustExist: true,
    });
    expect(parseLuaFileMode('w')).toMatchObject({ readable: false, writable: true, truncate: true, mustExist: false });
    expect(parseLuaFileMode('a')).toMatchObject({ readable: false, writable: true, append: true, truncate: false });
    expect(parseLuaFileMode('r+')).toMatchObject({ readable: true, writable: true, mustExist: true });
    expect(parseLuaFileMode('w+b')).toMatchObject({ readable: true, writable: true, truncate: true });
    expect(parseLuaFileMode('ab')).toMatchObject({ append: true });
  });

  it('rejects anything else', () => {
    for (const mode of ['', 'x', 'rw', 'r++', 'br', 'w b']) expect(parseLuaFileMode(mode), mode).toBeUndefined();
  });
});

describe('readLuaFileFormat', () => {
  const text = 'one\ntwo\n3.5 rest';

  it('reads a line without its newline, or with it for `L`', () => {
    expect(readLuaFileFormat(text, 0, 'l')).toEqual({ value: 'one', position: 4 });
    expect(readLuaFileFormat(text, 4, '*l')).toEqual({ value: 'two', position: 8 });
    expect(readLuaFileFormat(text, 0, 'L')).toEqual({ value: 'one\n', position: 4 });
    // The last line has no newline to strip.
    expect(readLuaFileFormat(text, 8, 'l')).toEqual({ value: '3.5 rest', position: text.length });
  });

  it('reads nil at end of file, except `a`, which reads an empty string', () => {
    expect(readLuaFileFormat(text, text.length, 'l').value).toBeUndefined();
    expect(readLuaFileFormat(text, text.length, 4).value).toBeUndefined();
    expect(readLuaFileFormat(text, text.length, 0).value).toBeUndefined();
    expect(readLuaFileFormat(text, text.length, 'a')).toEqual({ value: '', position: text.length });
    expect(readLuaFileFormat('', 0, '*a').value).toBe('');
  });

  it('reads the rest, a count of characters and a number', () => {
    expect(readLuaFileFormat(text, 4, 'a')).toEqual({ value: 'two\n3.5 rest', position: text.length });
    expect(readLuaFileFormat(text, 0, 2)).toEqual({ value: 'on', position: 2 });
    expect(readLuaFileFormat(text, 0, 0)).toEqual({ value: '', position: 0 });
    expect(readLuaFileFormat(text, 8, 'n')).toEqual({ value: 3.5, position: 11 });
    expect(readLuaFileFormat(text, 0, 'n')).toEqual({ value: undefined, position: 0 });
    expect(readLuaFileFormat(text, 0, '?').value).toBeUndefined();
  });
});

describe('io in the Lua sandbox', () => {
  it('fails to open a file the skin never wrote, as Lua reports a missing file', () => {
    expect(
      run([
        'local f, message, code = io.open("History/all.txt", "r")',
        'local implicit = io.open("History/all.txt")',
        'local ok, err = pcall(function() return io.open("History/all.txt"):read("a") end)',
        'return { handle = f == nil, message = message, code = code, implicit = implicit == nil, ok = ok,',
        '  raised = type(err) == "string" }',
      ]),
    ).toEqual({
      handle: true,
      message: 'History/all.txt: No such file or directory',
      code: 2,
      implicit: true,
      ok: false,
      raised: true,
    });
  });

  it('reads back what the skin wrote, for the lifetime of the runtime', () => {
    expect(
      run([
        'local w = io.open("a.txt", "w")',
        'local chained = w:write("one\\n", 2, "\\n") == w',
        'local closed = w:close()',
        'local a = io.open("a.txt", "a")',
        'a:write("three\\n")',
        'a:close()',
        'local r = io.open("a.txt")',
        'local first = r:read()',
        'local n = r:read("n")',
        'local newline = r:read("L")',
        'local rest = r:read("a")',
        'local atEnd = r:read() == nil',
        'r:close()',
        'local lines = {}',
        'for line in io.lines("a.txt") do lines[#lines + 1] = line end',
        'return { chained = chained, closed = closed, first = first, n = n, newline = newline, rest = rest,',
        '  atEnd = atEnd, lines = lines }',
      ]),
    ).toEqual({
      chained: true,
      closed: true,
      first: 'one',
      n: 2,
      newline: '\n',
      rest: 'three\n',
      atEnd: true,
      lines: ['one', '2', 'three'],
    });
  });

  it('truncates on `w`, keeps on `r+`, and seeks', () => {
    expect(
      run([
        'local f = io.open("b.txt", "w") f:write("abcdef") f:close()',
        'f = io.open("b.txt", "r+")',
        'local size = f:seek("end")',
        'f:seek("set", 2) f:write("XY")',
        'local position = f:seek()',
        'f:seek("set") local patched = f:read("a") f:close()',
        'f = io.open("b.txt", "w") f:close()',
        'f = io.open("b.txt") local emptied = f:read("a") f:close()',
        'return { size = size, position = position, patched = patched, emptied = emptied }',
      ]),
    ).toEqual({ size: 6, position: 4, patched: 'abXYef', emptied: '' });
  });

  it('reports a handle used against its mode or after closing instead of pretending', () => {
    expect(
      run([
        'local w = io.open("c.txt", "w")',
        'local readValue, readMessage = w:read()',
        'w:close()',
        'local writeValue, writeMessage = w:write("x")',
        'local closeValue, closeMessage = w:close()',
        'local r = io.open("c.txt")',
        'local roValue, roMessage = r:write("x")',
        'local invalid = pcall(io.open, "c.txt", "rw")',
        'local missingLines = pcall(io.lines, "missing.txt")',
        'return { readValue = readValue == nil, readMessage = readMessage, writeValue = writeValue == nil,',
        '  writeMessage = writeMessage, closeValue = closeValue == nil, closeMessage = closeMessage,',
        '  roValue = roValue == nil, roMessage = roMessage, invalid = invalid, missingLines = missingLines }',
      ]),
    ).toEqual({
      readValue: true,
      readMessage: 'c.txt: file is not open for reading',
      writeValue: true,
      writeMessage: 'attempt to use a closed file',
      closeValue: true,
      closeMessage: 'attempt to use a closed file',
      roValue: true,
      roMessage: 'c.txt: file is not open for writing',
      invalid: false,
      missingLines: false,
    });
  });

  it('removes and renames the files the skin wrote, and fails for the ones it did not', () => {
    expect(
      run([
        'local f = io.open("d.txt", "w") f:write("kept") f:close()',
        'local renamed = os.rename("d.txt", "e.txt")',
        'local gone = io.open("d.txt") == nil',
        'local g = io.open("e.txt") local moved = g:read("a") g:close()',
        'local removed = os.remove("e.txt")',
        'local again, message, code = os.remove("e.txt")',
        'local renameMissing = os.rename("e.txt", "f.txt")',
        'return { renamed = renamed, gone = gone, moved = moved, removed = removed, again = again == nil,',
        '  message = message, code = code, renameMissing = renameMissing == nil }',
      ]),
    ).toEqual({
      renamed: true,
      gone: true,
      moved: 'kept',
      removed: true,
      again: true,
      message: 'e.txt: No such file or directory',
      code: 2,
      renameMissing: true,
    });
  });

  it('keeps nothing from one runtime to the next', () => {
    run(['local f = io.open("f.txt", "w") f:write("state") f:close()', 'return {}']);
    expect(run(['return { missing = io.open("f.txt") == nil }'])).toEqual({ missing: true });
  });

  it('runs a skin that checks existence, creates the file and appends without checking the handle', () => {
    // The shape of ModernChic's history helpers: `existFile` by `io.open(path, "r") == nil`, `createFile` by an
    // unchecked "w", a record count over `f:lines()`, and an unchecked append.
    expect(
      run([
        'local function exists(path) local f = io.open(path, "r") if f == nil then return false end f:close() return true end',
        'local function create(path) local f = io.open(path, "w") f:close() end',
        'local function count(path) local f = io.open(path, "r") local n = 0 for _ in f:lines() do n = n + 1 end f:close() return n end',
        'local path = "History/history.txt"',
        'local before = exists(path)',
        'if not before then create(path) end',
        'for i = 1, 3 do local f = io.open(path, "a") f:write(count(path) + 1, "_title\\n") f:close() end',
        'local f = io.open(path, "r") local all = f:read("a") f:close()',
        'return { before = before, after = exists(path), count = count(path), all = all }',
      ]),
    ).toEqual({ before: false, after: true, count: 3, all: '1_title\n2_title\n3_title\n' });
  });

  it('leaves the standard streams empty', () => {
    expect(
      run([
        'local lines = 0 for _ in io.lines() do lines = lines + 1 end',
        'return { read = io.read() == nil, write = io.write("x") == nil, lines = lines }',
      ]),
    ).toEqual({ read: true, write: true, lines: 0 });
  });
});
