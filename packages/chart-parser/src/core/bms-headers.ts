import { normalizeObjectKey, type BeMusicJSON } from '@be-music/chart-source';

const INDEXED_HEADER_COMMAND =
  /^(WAV|BMP|BPM|STOP|TEXT|SONG|EXRANK|ARGB|CHANGEOPTION|EXWAV|EXBMP|BGA|SCROLL|SPEED|SWBGA)([0-9A-Za-z]{2})$/;

type IndexedHeaderDirective =
  | 'WAV'
  | 'BMP'
  | 'BPM'
  | 'STOP'
  | 'TEXT'
  | 'SONG'
  | 'EXRANK'
  | 'ARGB'
  | 'CHANGEOPTION'
  | 'EXWAV'
  | 'EXBMP'
  | 'BGA'
  | 'SCROLL'
  | 'SPEED'
  | 'SWBGA';

const EXBPM_HEADER_COMMAND = /^EXBPM([0-9A-Za-z]{2})$/;

/**
 * Maps a header alias onto its canonical command, so file order, control flow, fingerprints and output all see one
 * definition. `#EXBPMxx` is nanasi's alias of `#BPMxx`, added to dodge a BMSC bug that confused `#BPMxx` with `#BPM`
 * (https://hitkey.nekokan.dyndns.info/cmds.htm#EXBPMXX).
 */
export function resolveHeaderCommandAlias(
  command: string,
  commandRaw: string,
): { readonly command: string; readonly commandRaw: string } {
  const exBPM = command.match(EXBPM_HEADER_COMMAND);
  if (exBPM) {
    return { command: `BPM${exBPM[1]!}`, commandRaw: `BPM${commandRaw.slice('EXBPM'.length)}` };
  }
  return { command, commandRaw };
}

/** Header commands whose lines add up instead of replacing each other, so file order never makes one override another. */
const REPEATABLE_HEADER_COMMANDS: ReadonlySet<string> = new Set(['STP', 'WAVCMD', 'LNOBJ', 'OPTION']);

/**
 * Which definition a header line sets, for the file-order rule: the command, plus the normalized object key of an
 * indexed header (`WAV01`). `undefined` for repeatable headers.
 */
export function resolveHeaderDefinitionKey(command: string, commandRaw: string, base: 36 | 62): string | undefined {
  if (REPEATABLE_HEADER_COMMANDS.has(command)) {
    return undefined;
  }
  const indexed = command.match(INDEXED_HEADER_COMMAND);
  if (indexed) {
    const directive = indexed[1]!;
    const keyRaw = base === 62 ? commandRaw.slice(directive.length) : indexed[2]!;
    return `${directive}${normalizeObjectKey(keyRaw, base)}`;
  }
  return command;
}

export function pushHeaderLine(
  json: BeMusicJSON,
  command: string,
  commandRaw: string,
  value: string,
  base: 36 | 62,
): void {
  const objectCommand = command.match(INDEXED_HEADER_COMMAND);
  if (objectCommand) {
    const directive = objectCommand[1] as IndexedHeaderDirective;
    // For base-62 charts, lift the key from the case-preserved `commandRaw`; the trailing 2 chars hold the
    // lowercase-aware ID. `commandRaw[directive.length...]` falls back to the uppercased form for base-36 (where case
    // folding is intended).
    const keyRaw = base === 62 ? commandRaw.slice(directive.length) : objectCommand[2]!;
    const key = normalizeObjectKey(keyRaw, base);
    applyIndexedHeaderLine(json, directive, key, value);
    return;
  }

  const numericValue = Number.parseFloat(value);
  switch (command) {
    case 'TITLE':
      json.metadata.title = value;
      return;
    case 'SUBTITLE':
      json.metadata.subtitle = value;
      return;
    case 'ARTIST':
      json.metadata.artist = value;
      return;
    case 'GENRE':
      json.metadata.genre = value;
      return;
    case 'COMMENT':
      json.metadata.comment = value;
      return;
    case 'STAGEFILE':
      json.metadata.stageFile = value;
      return;
    case 'BACKBMP':
      json.metadata.backBMP = value;
      return;
    case 'BANNER':
      json.metadata.banner = value;
      return;
    case 'PREVIEW':
      if (value.length > 0) {
        json.bms.preview = value;
      }
      return;
    case 'PLAYLEVEL':
      {
        const playLevelValue = parsePlayLevelValue(value);
        if (playLevelValue !== undefined) {
          json.metadata.playLevel = playLevelValue;
        }
      }
      return;
    case 'RANK':
      if (Number.isFinite(numericValue)) {
        json.metadata.rank = numericValue;
      }
      return;
    case 'TOTAL':
      if (Number.isFinite(numericValue)) {
        json.metadata.total = numericValue;
      }
      return;
    case 'DIFFICULTY':
      if (Number.isFinite(numericValue)) {
        json.metadata.difficulty = numericValue;
      }
      return;
    case 'BPM':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.metadata.bpm = numericValue;
      }
      return;
    case 'LNTYPE':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.bms.lnType = Math.floor(numericValue);
      }
      return;
    case 'LNMODE':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.bms.lnMode = Math.floor(numericValue);
      }
      return;
    case 'LNOBJ':
      if (value.length > 0) {
        // `#LNOBJ` carries an object-ID payload — preserve case for `#BASE 62` charts so the LN-end marker matches its
        // case-sensitive `#WAVxx` counterpart.
        const normalizedValue = normalizeObjectKey(value, base);
        json.bms.lnObjs = [...(json.bms.lnObjs ?? []), normalizedValue];
      }
      return;
    case 'VOLWAV':
      if (Number.isFinite(numericValue) && numericValue >= 0) {
        json.bms.volWAV = numericValue;
      }
      return;
    case 'DEFEXRANK':
      if (Number.isFinite(numericValue)) {
        json.bms.defExRank = numericValue;
      }
      return;
    case 'PLAYER':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.bms.player = Math.floor(numericValue);
      }
      return;
    case 'PATH_WAV':
      if (value.length > 0) {
        json.bms.pathWAV = value;
      }
      return;
    case 'BASEBPM':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.bms.baseBPM = numericValue;
      }
      return;
    case 'STP':
      if (value.length > 0) {
        json.bms.stp.push(value);
      }
      return;
    case 'OPTION':
      if (value.length > 0) {
        const declarations = (json.bms.options ??= json.bms.option ? [json.bms.option] : []);
        declarations.push(value);
        json.bms.option = value;
      }
      return;
    case 'WAVCMD':
      if (value.length > 0) {
        // BMS spec — `#WAVCMD pp xx vv` declares per-slot WAV playback overrides (pitch / volume / loop). Real charts
        // emit ONE line per `(parameter, slot)` pair, so we collect every line into `wavCmds`. The legacy single-string
        // `wavCmd` field is preserved for the first occurrence so older consumers that only read the head value keep
        // compiling.
        json.bms.wavCmds.push(value);
        if (typeof json.bms.wavCmd !== 'string') {
          json.bms.wavCmd = value;
        }
      }
      return;
    case 'POORBGA':
      if (value.length > 0) {
        json.bms.poorBGA = value;
      }
      return;
    case 'VIDEOFILE':
      if (value.length > 0) {
        json.bms.videoFile = value;
      }
      return;
    case 'MIDIFILE':
      if (value.length > 0) {
        json.bms.midiFile = value;
      }
      return;
    case 'MATERIALS':
      if (value.length > 0) {
        json.bms.materials = value;
      }
      return;
    case 'DIVIDEPROP':
      if (value.length > 0) {
        json.bms.divideProp = value;
      }
      return;
    case 'CHARSET':
      if (value.length > 0) {
        json.bms.charset = value;
      }
      return;
    case 'BASE':
      // `#BASE 62` is the beatoraja base-62 ID extension. The base was already resolved during pre-scan
      // (`detectBMSBase`) and stamped onto `json.bms.base` before this header reaches us; swallow the directive here so
      // it doesn't leak into `metadata.extras`.
      return;
    default:
      if (value.length > 0) {
        json.metadata.extras[command] = value;
      }
  }
}

function parsePlayLevelValue(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return trimmed;
}

function applyIndexedHeaderLine(
  json: BeMusicJSON,
  directive: IndexedHeaderDirective,
  key: string,
  value: string,
): void {
  switch (directive) {
    case 'WAV':
      applyIndexedStringValue(json.resources.wav, key, value);
      return;
    case 'BMP':
      applyIndexedStringValue(json.resources.bmp, key, value);
      return;
    case 'TEXT':
      applyIndexedStringValue(json.resources.text, key, value);
      return;
    case 'SONG':
      applyIndexedStringValue(json.bms.songText, key, value);
      return;
    case 'EXRANK':
      applyIndexedStringValue(json.bms.exRank, key, value);
      return;
    case 'ARGB':
      applyIndexedStringValue(json.bms.argb, key, value);
      return;
    case 'CHANGEOPTION':
      applyIndexedStringValue(json.bms.changeOption, key, value);
      return;
    case 'EXWAV':
      applyIndexedStringValue(json.bms.exWAV, key, value);
      return;
    case 'EXBMP':
      applyIndexedStringValue(json.bms.exBMP, key, value);
      return;
    case 'BGA':
      applyIndexedStringValue(json.bms.bga, key, value);
      return;
    case 'SCROLL': {
      applyIndexedNumberValue(json.bms.scroll, key, value);
      return;
    }
    case 'SPEED': {
      applyIndexedNumberValue(json.bms.speed, key, value);
      return;
    }
    case 'SWBGA':
      applyIndexedStringValue(json.bms.swBGA, key, value);
      return;
    case 'BPM':
    case 'STOP': {
      if (directive === 'BPM') {
        applyIndexedNumberValue(json.resources.bpm, key, value);
      } else {
        applyIndexedNumberValue(json.resources.stop, key, value);
      }
      return;
    }
  }
}

function applyIndexedStringValue(values: Record<string, string>, key: string, value: string): void {
  if (value.length > 0) {
    values[key] = value;
  }
}

function applyIndexedNumberValue(values: Record<string, number>, key: string, value: string): void {
  const numericValue = Number.parseFloat(value);
  if (Number.isFinite(numericValue)) {
    values[key] = numericValue;
  }
}
