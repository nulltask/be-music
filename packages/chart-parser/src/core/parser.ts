import {
  BMS_JSON_FORMAT,
  type BMSControlFlowCommand,
  type BMSControlFlowHeaderEntry,
  type BMSSourceLineEntry,
  type BeMusicJSON,
  createEmptyJSON,
} from '@be-music/chart-source';
import { compareEvents, drawRandomOutcomes, type RandomDraws } from '@be-music/chart-model';
import { normalizeASCIIBase36Code } from '@be-music/shared-utils/core';
import { buildBMSObjectLineEntry, upsertMeasureLength } from './event-utils.ts';
import type { BmsonDocument } from './bmson.ts';
import {
  createControlFlowObjectEntry,
  resolveControlFlow,
  resolveControlFlowAliasDirective,
  type ControlFlowCaptureFrameType,
  updateControlFlowCaptureStack,
} from './control-flow.ts';
import { pushHeaderLine, resolveHeaderCommandAlias, resolveHeaderDefinitionKey } from './bms-headers.ts';
import { parseJSONDocument } from './bms-json-document.ts';
import { parseBmsonDocument } from './bmson-document.ts';

/**
 * Pre-scans for the BMS `#BASE` directive (the beatoraja base-62 extension switch). Default base is 36; only `#BASE 62`
 * or `#BASE 36` are recognized. We do a one-pass forward scan and stop at the first object data line, mirroring real
 * implementations that require `#BASE` to come before any objects.
 */
// A whole `#BASE 36` / `#BASE 62` line, with the leading / separating whitespace `parseBMS` trims (never a line break).
const BASE_DIRECTIVE_REGEX = /^[^\S\r\n]*#BASE[^\S\r\n]+(36|62)\b/gim;
const CONTROL_FLOW_COMMANDS: ReadonlySet<BMSControlFlowCommand> = new Set([
  'RANDOM',
  'SETRANDOM',
  'IF',
  'ELSEIF',
  'ELSE',
  'ENDIF',
  'ENDRANDOM',
  'SWITCH',
  'SETSWITCH',
  'CASE',
  'SKIP',
  'DEF',
  'ENDSW',
]);

type MeasureLengthEntry = BeMusicJSON['measures'][number];

export function parseBMS(input: string): BeMusicJSON {
  const json = createEmptyJSON('bms');
  const controlFlowCaptureStack: ControlFlowCaptureFrameType[] = [];
  // Branch header lines by the header they define, until a later top-level line of the same header overrides them.
  const capturedHeadersByKey = new Map<string, BMSControlFlowHeaderEntry[]>();
  const measureByIndex = new Map<number, MeasureLengthEntry>();
  let hasValidMainBPMHeader = false;
  // Resolve the chart's object-ID radix BEFORE main parsing so that every `#WAVxx` / `#BMPxx` key + every
  // channel-stream token gets normalized under the right rule. Default is base 36 (case-fold lowercase to uppercase).
  // `#BASE 62` opts into the beatoraja extension where lowercase `a-z` is a separate ID space.
  const base = detectBMSBase(input);
  if (base === 62) {
    json.bms.base = 62;
  }

  forEachLine(input, (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('#')) {
      return;
    }

    const second = line.charCodeAt(1);
    const startsWithMeasure = second >= 0x30 && second <= 0x39;
    if (startsWithMeasure) {
      const objectLine = parseObjectDataLine(line);
      if (!objectLine) {
        return;
      }
      const { measure, channel, data } = objectLine;
      if (controlFlowCaptureStack.length > 0) {
        const controlFlowObject = createControlFlowObjectEntry(measure, channel, data, base);
        if (controlFlowObject) {
          json.bms.controlFlow.push(controlFlowObject);
          json.preservation.bms.sourceLines.push(controlFlowObject);
        }
      } else {
        // Tokenized once: the preserved line and the chart's events come from the same entry.
        const objectLine = buildBMSObjectLineEntry(measure, channel, data, base);
        if (objectLine) {
          json.preservation.bms.objectLines.push(objectLine);
          json.preservation.bms.sourceLines.push({
            kind: 'object',
            ...objectLine,
          });
          if (objectLine.measureLength !== undefined) {
            upsertMeasureLength(json, measure, objectLine.measureLength, measureByIndex);
          }
          for (const event of objectLine.events) {
            // A copy per event: the chart's events must not alias the preserved line's.
            json.events.push({
              measure,
              channel,
              position: [event.position[0], event.position[1]],
              value: event.value,
            });
          }
        }
      }
      return;
    }

    const headerLine = parseHeaderDirectiveLine(line);
    if (!headerLine) {
      return;
    }
    const { value } = headerLine;
    // `#EXBPMxx` is stored as `#BPMxx`, so round-tripped output is normalized like the control-flow spellings below.
    const { command, commandRaw } = resolveHeaderCommandAlias(headerLine.command, headerLine.commandRaw);

    // Spelling variants (`#END IF` / `#END` / `#ELSE IF n`) normalize onto the canonical control-flow commands —
    // captured entries store the canonical form, so round-tripped output is normalized too.
    const aliasedDirective = resolveControlFlowAliasDirective(command, value);
    if (aliasedDirective) {
      const directiveEntry: BMSSourceLineEntry = {
        kind: 'directive',
        command: aliasedDirective.command,
        value: aliasedDirective.value,
      };
      json.bms.controlFlow.push(directiveEntry);
      json.preservation.bms.sourceLines.push(directiveEntry);
      updateControlFlowCaptureStack(controlFlowCaptureStack, aliasedDirective.command);
      return;
    }

    if (isControlFlowCommand(command)) {
      const directiveEntry: BMSSourceLineEntry = {
        kind: 'directive',
        command,
        value: value.length > 0 ? value : undefined,
      };
      json.bms.controlFlow.push(directiveEntry);
      json.preservation.bms.sourceLines.push(directiveEntry);
      updateControlFlowCaptureStack(controlFlowCaptureStack, command);
      return;
    }

    // Stash the case-preserved command on captured entries when it differs from the uppercased canonical form. Only
    // base-62 charts (`#BASE 62`) put lowercase letters in indexed-header keys (e.g. `#WAV0a`), so most charts skip
    // this entirely and the JSON stays compact.
    const commandCaseDiffers = command !== commandRaw;
    const definitionKey = resolveHeaderDefinitionKey(command, commandRaw, base);
    if (controlFlowCaptureStack.length > 0) {
      const headerEntry: BMSControlFlowHeaderEntry = {
        kind: 'header',
        command,
        value,
        ...(commandCaseDiffers ? { commandRaw } : {}),
      };
      json.bms.controlFlow.push(headerEntry);
      json.preservation.bms.sourceLines.push(headerEntry);
      if (definitionKey !== undefined) {
        const captured = capturedHeadersByKey.get(definitionKey);
        if (captured) {
          captured.push(headerEntry);
        } else {
          capturedHeadersByKey.set(definitionKey, [headerEntry]);
        }
      }
      return;
    }

    // LR2 and beatoraja apply header lines in file order: a top-level line overrides the same header in any branch
    // above it, taken or not.
    if (definitionKey !== undefined && value.length > 0) {
      for (const entry of capturedHeadersByKey.get(definitionKey) ?? []) {
        entry.overriddenByLaterHeader = true;
      }
      capturedHeadersByKey.delete(definitionKey);
    }

    json.preservation.bms.sourceLines.push({
      kind: 'header',
      command,
      value,
      ...(commandCaseDiffers ? { commandRaw } : {}),
    });
    if (command === 'BPM') {
      const parsedMainBPM = Number.parseFloat(value);
      if (Number.isFinite(parsedMainBPM) && parsedMainBPM > 0) {
        hasValidMainBPMHeader = true;
      }
    }
    pushHeaderLine(json, command, commandRaw, value, base);
  });

  if (
    json.bms.controlFlow.length > 0 &&
    json.preservation.bms.sourceLines.some((entry) => entry.kind === 'header' && entry.command === 'OPTION')
  ) {
    // Unlike replacing headers, OPTION families combine. Keep unconditional declarations interleaved with
    // branch declarations so their source order remains available after choosing a RANDOM/SWITCH outcome.
    const captured = new Set(json.bms.controlFlow);
    json.bms.controlFlow = json.preservation.bms.sourceLines.filter(
      (entry) => captured.has(entry) || (entry.kind === 'header' && entry.command === 'OPTION'),
    );
    json.bms.optionHeadersInControlFlow = true;
  }
  if (!hasValidMainBPMHeader) {
    // BMS compatibility: if #BPM is not declared, treat 130 as the default base BPM.
    json.metadata.bpm = 130;
  }
  json.measures.sort((left, right) => left.index - right.index);
  // Every event above was built normalized (channel and object ids folded, positions in range), so sorting is enough.
  json.events.sort(compareEvents);
  return json;
}

export function parseBmson(input: string): BeMusicJSON {
  const document = JSON.parse(input) as BmsonDocument;
  return parseBmsonDocument(document);
}

function parseStructuredChartObject(parsed: Record<string, unknown>): BeMusicJSON {
  if (parsed.format === BMS_JSON_FORMAT) {
    return parseJSONDocument(parsed as Partial<BeMusicJSON>);
  }
  return parseBmsonDocument(parsed as BmsonDocument);
}

export function parseChart(input: string, formatHint?: string): BeMusicJSON {
  if (formatHint === undefined) {
    const firstCode = input.charCodeAt(0);
    if (firstCode === 0x23) {
      return parseBMS(input);
    }
  }

  const hint = formatHint?.toLowerCase();
  if (hint === 'bmson') {
    return parseBmson(input);
  }
  if (hint === 'json') {
    const parsed = JSON.parse(input.trim()) as Record<string, unknown>;
    return parseStructuredChartObject(parsed);
  }

  let startIndex = 0;
  while (startIndex < input.length) {
    const code = input.charCodeAt(startIndex);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      break;
    }
    startIndex += 1;
  }
  if (input.charCodeAt(startIndex) === 0x7b) {
    const parsed = JSON.parse(input.slice(startIndex)) as Record<string, unknown>;
    return parseStructuredChartObject(parsed);
  }

  return parseBMS(input);
}

export interface ResolveBMSControlFlowOptions {
  /** Random source for the draws, in `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
}

/**
 * Resolves `#RANDOM` / `#SETRANDOM` / `#SWITCH` control flow with freshly drawn outcomes: shorthand for
 * `resolveBMSControlFlowWithDraws(input, drawRandomOutcomes(input, random))`. A host that needs to know which branches
 * it played (the replay, the RANDOM summary, a second scene showing the same chart) draws once with
 * `drawRandomOutcomes` (`@be-music/chart-model`) and resolves with {@link resolveBMSControlFlowWithDraws} instead.
 */
export function resolveBMSControlFlow(input: BeMusicJSON, options: ResolveBMSControlFlowOptions = {}): BeMusicJSON {
  return resolveBMSControlFlowWithDraws(input, drawRandomOutcomes(input, options.random ?? Math.random));
}

/**
 * Resolves `#RANDOM` / `#SETRANDOM` / `#SWITCH` control flow with explicit outcomes — the draws made once for a play
 * with `drawRandomOutcomes`, or the ones a replay recorded. The same chart and draws always give the same result.
 *
 * @throws RangeError when `draws` was not drawn for `input`'s control flow.
 */
export function resolveBMSControlFlowWithDraws(input: BeMusicJSON, draws: RandomDraws): BeMusicJSON {
  return resolveControlFlow(input, draws, {
    applyHeader: (json, command, commandRaw, value) => {
      // Replay path: prefer the case-preserved `commandRaw` when available so a `#WAV0a` captured inside a `#RANDOM` /
      // `#IF` block on a `#BASE 62` chart still registers under the lowercase key. Falls back to the uppercased
      // `command` for the common base-36 case-insensitive path.
      pushHeaderLine(json, command, commandRaw ?? command, value, json.bms.base === 62 ? 62 : 36);
    },
  });
}

export { decodeBMSText, decodeUTF8Text, type DecodedBMSText } from './bms-text-decode.ts';
export { canonicalizeBMSCharset, extractDeclaredBMSCharset } from './bms-charset.ts';

interface ParsedObjectDataLine {
  measure: number;
  channel: string;
  data: string;
}

function parseObjectDataLine(line: string): ParsedObjectDataLine | undefined {
  if (line.length < 8 || line.charCodeAt(0) !== 0x23) {
    return undefined;
  }

  const digit0 = line.charCodeAt(1);
  const digit1 = line.charCodeAt(2);
  const digit2 = line.charCodeAt(3);
  if (digit0 < 0x30 || digit0 > 0x39 || digit1 < 0x30 || digit1 > 0x39 || digit2 < 0x30 || digit2 > 0x39) {
    return undefined;
  }

  const channel0 = normalizeASCIIBase36Code(line.charCodeAt(4));
  const channel1 = normalizeASCIIBase36Code(line.charCodeAt(5));
  if (channel0 < 0 || channel1 < 0) {
    return undefined;
  }

  let cursor = 6;
  while (cursor < line.length && isASCIIWhitespace(line.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor >= line.length || line.charCodeAt(cursor) !== 0x3a) {
    return undefined;
  }

  cursor += 1;
  while (cursor < line.length && isASCIIWhitespace(line.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor >= line.length) {
    return undefined;
  }

  const data = line.slice(cursor).trim();
  if (data.length === 0) {
    return undefined;
  }

  return {
    measure: (digit0 - 0x30) * 100 + (digit1 - 0x30) * 10 + (digit2 - 0x30),
    channel: String.fromCharCode(channel0, channel1),
    data,
  };
}

interface ParsedHeaderDirectiveLine {
  /** Uppercased command — used for keyword matching (case-insensitive). */
  command: string;
  /**
   * Case-preserved command. For base-62 indexed-header keys, the trailing 2 characters of `commandRaw` hold the
   * lowercase-aware ID — uppercasing here would collapse `#WAV0a` and `#WAV0A` back into the same slot.
   */
  commandRaw: string;
  value: string;
}

function parseHeaderDirectiveLine(line: string): ParsedHeaderDirectiveLine | undefined {
  if (line.length < 2 || line.charCodeAt(0) !== 0x23) {
    return undefined;
  }
  const commandStart = line.charCodeAt(1);
  if (!isASCIILetter(commandStart)) {
    return undefined;
  }

  let cursor = 2;
  while (cursor < line.length && isHeaderCommandChar(line.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor < line.length && !isASCIIWhitespace(line.charCodeAt(cursor))) {
    return undefined;
  }

  const commandRaw = line.slice(1, cursor);
  const command = commandRaw.toUpperCase();
  while (cursor < line.length && isASCIIWhitespace(line.charCodeAt(cursor))) {
    cursor += 1;
  }

  const value = cursor < line.length ? line.slice(cursor).trim() : '';
  return { command, commandRaw, value };
}

function isASCIIWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0b || code === 0x0c;
}

function isASCIILetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isHeaderCommandChar(code: number): boolean {
  if (isASCIILetter(code)) {
    return true;
  }
  return (code >= 0x30 && code <= 0x39) || code === 0x5f;
}

function isControlFlowCommand(command: string): command is BMSControlFlowCommand {
  return CONTROL_FLOW_COMMANDS.has(command as BMSControlFlowCommand);
}

function forEachLine(input: string, visitor: (line: string) => void): void {
  let lineStart = 0;
  let index = 0;
  while (index < input.length) {
    const code = input.charCodeAt(index);
    if (code !== 0x0a && code !== 0x0d) {
      index += 1;
      continue;
    }

    visitor(input.slice(lineStart, index));

    if (code === 0x0d && index + 1 < input.length && input.charCodeAt(index + 1) === 0x0a) {
      index += 1;
    }
    lineStart = index + 1;
    index += 1;
  }
  visitor(input.slice(lineStart, input.length));
}

/**
 * Pre-scans the BMS source for the `#BASE` directive (the beatoraja base-62 extension switch). Returns 62 when the last
 * `#BASE 36` / `#BASE 62` line in the file is `#BASE 62`, otherwise 36.
 *
 * Like beatoraja's BMSDecoder, the scan covers the whole file before anything is decoded, so the directive's position
 * does not matter (it may follow object data) and control-flow blocks are not evaluated. Other values are ignored.
 */
function detectBMSBase(input: string): 36 | 62 {
  let resolved: 36 | 62 = 36;
  for (const match of input.matchAll(BASE_DIRECTIVE_REGEX)) {
    resolved = match[1] === '62' ? 62 : 36;
  }
  return resolved;
}
