import { normalizeChannel, normalizeObjectKey, type BeMusicEvent, type ChartDiagnostic } from '@be-music/chart-source';
import { compileChartOptions } from './chart-option-program.ts';
import { buildChartOptionTimeline } from './chart-options.ts';
import { isLandmineChannel, isSampleTriggerChannel } from './channels.ts';
import type { ResolvedChart } from './resolved-chart.ts';
import { resolveBmsWAVResources } from './wav-directives.ts';

export function collectChartDiagnostics(
  resolved: ResolvedChart,
  droppedStackedNotes: readonly BeMusicEvent[],
): ChartDiagnostic[] {
  const { source, sortedEvents, timing, idBase } = resolved;
  const diagnostics = [...(source.diagnostics ?? [])];
  for (const event of droppedStackedNotes) {
    diagnostics.push({
      code: 'stacked-note-length',
      message: 'Dropped a stacked bmson note of a different length and its keysound.',
      position: objectPosition(event),
    });
  }
  // Branches can define a slot used by an unconditional object. Diagnose references after choosing an outcome.
  if (resolved.hasUnresolvedControlFlow) return diagnostics;

  const { resources, bms } = source;
  const references: Readonly<Record<string, readonly [string, ...Readonly<Record<string, unknown>>[]]>> = {
    '08': ['#BPM', resources.bpm],
    '09': ['#STOP', resources.stop],
    SC: ['#SCROLL', bms.scroll],
    SP: ['#SPEED', bms.speed],
    '99': ['#TEXT', resources.text, bms.songText],
    A0: ['#EXRANK', bms.exRank],
    A1: ['#ARGB', bms.argb],
    A2: ['#ARGB', bms.argb],
    A3: ['#ARGB', bms.argb],
    A4: ['#ARGB', bms.argb],
    A5: ['#SWBGA', bms.swBGA],
    A6: ['#CHANGEOPTION', bms.changeOption],
  };
  const bga = ['#BMP', resources.bmp, bms.bga, bms.exBMP] as const;
  const wav = source.sourceFormat === 'bms' ? resolveBmsWAVResources(source) : undefined;
  let hasUnresolvedSampleReference = false;
  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const reference = /^0[467A]$/.test(channel) ? bga : references[channel];
    if (reference === undefined) {
      if (
        wav !== undefined &&
        !hasUnresolvedSampleReference &&
        isSampleTriggerChannel(channel) &&
        !isLandmineChannel(channel)
      ) {
        const key = normalizeObjectKey(event.value, idBase);
        hasUnresolvedSampleReference = key !== '' && key !== '00' && !Object.hasOwn(wav, key);
      }
      continue;
    }
    const key = normalizeObjectKey(event.value, idBase, source.sourceFormat === 'bmson');
    if (!key || key === '00') continue;
    const [directive, ...tables] = reference;
    if (tables.some((table) => Object.hasOwn(table, key))) continue;
    const subject = directive + key;
    diagnostics.push({
      code: 'missing-reference',
      message: `Undefined chart reference ${subject}.`,
      subject,
      position: objectPosition(event),
    });
  }

  // Use resolved triggers when a slot is missing so silent LNOBJ markers and suppressed LN objects are excluded.
  if (hasUnresolvedSampleReference) {
    for (const { samplePath, sampleKey, event } of resolved.sampleTriggers) {
      if (samplePath !== undefined || !sampleKey || sampleKey === '00') continue;
      const subject = `#WAV${sampleKey}`;
      diagnostics.push({
        code: 'missing-reference',
        message: `Undefined chart reference ${subject}.`,
        subject,
        position: objectPosition(event),
      });
    }
  }

  const { events, layerEvents, poorEvents, header, sequences } = source.bmson.bga;
  if (events.length + layerEvents.length + poorEvents.length > 0) {
    const images = new Set(header.map(({ id }) => id));
    const sequenceIds = new Set(sequences?.map(({ id }) => id));
    for (const [field, cues] of [
      ['bga_events', events],
      ['layer_events', layerEvents],
      ['poor_events', poorEvents],
    ] as const) {
      cues.forEach((cue, index) => {
        const ids = field === 'layer_events' ? (cue.idSet ?? [cue.id]) : [cue.id];
        for (const id of ids) {
          if (id === undefined || id === 0 || images.has(id) || (field !== 'bga_events' && sequenceIds.has(id)))
            continue;
          diagnostics.push({
            code: 'missing-reference',
            message: `Undefined bmson BGA reference ${id}.`,
            subject: String(id),
            position: { kind: 'field', path: `bga.${field}[${index}]` },
          });
        }
      });
    }
  }

  const timeline = buildChartOptionTimeline(source, timing);
  // Collect invalid and unsupported declarations through the same compiler used by the player.
  timeline.initial.forEach((declaration, index) => {
    const [warning] = compileChartOptions({ initial: [declaration], cues: [] }).diagnostics;
    if (warning)
      diagnostics.push(optionDiagnostic(warning.code, declaration, { kind: 'field', path: `#OPTION[${index + 1}]` }));
  });
  for (const event of sortedEvents) {
    if (normalizeChannel(event.channel) !== 'A6') continue;
    const key = normalizeObjectKey(event.value, idBase, source.sourceFormat === 'bmson');
    if (!key || key === '00') continue;
    const declaration = bms.changeOption[key];
    if (declaration === undefined) continue;
    const [warning] = compileChartOptions({
      initial: [],
      cues: [{ key, declaration, seconds: timing.eventToSeconds(event) }],
    }).diagnostics;
    if (warning) diagnostics.push(optionDiagnostic(warning.code, declaration, objectPosition(event)));
  }
  return diagnostics;
}

function objectPosition(event: BeMusicEvent): ChartDiagnostic['position'] {
  return { kind: 'object', measure: event.measure, position: event.position, channel: event.channel };
}

function optionDiagnostic(reason: string, declaration: string, position: ChartDiagnostic['position']): ChartDiagnostic {
  const subject = JSON.stringify(declaration);
  return reason === 'unsupported-option'
    ? { code: 'unsupported-option', message: `Unsupported chart option ${subject}.`, subject, position }
    : { code: 'invalid-option', message: `Invalid chart option ${subject} (${reason}).`, subject, position };
}
