import { isN2SArchive, readN2SArchive } from '@be-music/chart-parser/core';
import type { CourseDefinition, CourseStageRef } from './definition.ts';
import { decodeCourseText, parseCourseXML } from './text.ts';

/**
 * Reads a Nanasi Groove 2 chart list (`.n2x`, a ZEXA container holding one XML file) as an EXPERT course: each
 * `<bmslist>` entry's `<file>` becomes a stage, in the list's order. Toy Musical 3 uses these lists for the charts a
 * stage offers to choose from; Be-Music plays them back to back instead. The unlock conditions (`<condition>`) are not
 * read, so every entry is a stage.
 *
 * A stage names its chart by `path`, relative to the list's folder with `/` separators (the lists write `\`); the host
 * matches it to a chart of the drop and fills in the chart's hashes. Until then a stage's title is its file name
 * without the extension. `name` (the list's file name without its extension) names the course.
 *
 * An `.n2x` that is not a list (a skin, mode or settings file) or lists no chart gives `undefined`. Accepts the
 * container's bytes, or the XML's bytes or text as they are inside it.
 */
export function parseN2XCourseFile(input: Uint8Array | string, name: string): CourseDefinition | undefined {
  const root = parseCourseXML(typeof input === 'string' ? input : decodeCourseText(readN2XListBytes(input)));
  if (root === undefined || root.name !== 'bmslist') return undefined;
  const stages: CourseStageRef[] = [];
  for (const entry of root.children) {
    if (entry.name !== 'bms') continue;
    const file = entry.children.find((child) => child.name === 'file')?.text.trim();
    if (file === undefined || file === '') continue;
    const path = file.replaceAll('\\', '/').replace(/^\/+/u, '');
    const stem = (path.split('/').at(-1) ?? path).replace(/\.[^.]*$/u, '');
    stages.push({ path, ...(stem !== '' ? { title: stem } : {}) });
  }
  if (stages.length === 0) return undefined;
  return { name, kind: 'expert', stages, constraints: [], trophies: [], release: true, source: { format: 'n2x' } };
}

/** The XML bytes of an `.n2x`: the container's first file, or the bytes as they are when they are no container. */
function readN2XListBytes(bytes: Uint8Array): Uint8Array {
  if (!isN2SArchive(bytes)) return bytes;
  return readN2SArchive(bytes)[0]?.bytes ?? new Uint8Array();
}
