import type { CourseDefinition } from './definition.ts';
import { parseTableHeaderCourses } from './table.ts';

/** Fetches a URL's body as text; injected so this layer stays runtime-neutral (no global `fetch`). */
export type TableFetchText = (url: string) => Promise<string>;

/** The courses a difficulty table publishes, under the label its folder bar shows. */
export interface TableHeaderCourses {
  /** The table's `name`, else its `symbol`, else the host it was fetched from. */
  label: string;
  /** Every course of the header, its groups flattened in order. */
  courses: CourseDefinition[];
  /** The header JSON's resolved URL. */
  headerURL: string;
}

const META_TAG_PATTERN = /<meta\b([^>]*)>/giu;
const ATTRIBUTE_PATTERN = /([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gu;
const HTML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeHTMLEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return HTML_ENTITIES[lower] ?? entity;
  });
}

function readAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1]!.toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeHTMLEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

/**
 * The header JSON URL a difficulty-table page names in `<meta name="bmstable" content="header.json">`, resolved
 * against the page URL. Attribute order, quoting and case do not matter. `undefined` when the page has no such tag or
 * its content is not a valid URL.
 */
export function resolveTableHeaderURL(pageURL: string, html: string): string | undefined {
  for (const match of html.matchAll(META_TAG_PATTERN)) {
    const attributes = readAttributes(match[1]!);
    if (attributes.get('name')?.trim().toLowerCase() !== 'bmstable') continue;
    const content = attributes.get('content')?.trim();
    if (content === undefined || content.length === 0) continue;
    try {
      return new URL(content, pageURL).href;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseJSONObject(text: string): Record<string, unknown> | undefined {
  // Strip a UTF-8 BOM; some tables serve one.
  const trimmed = text.replace(/^﻿/u, '').trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Loads a difficulty table's courses from its page URL (whose `bmstable` meta names the header JSON) or from the header
 * JSON URL itself, and parses them with {@link parseTableHeaderCourses}. Only the header is fetched: the song list
 * behind `data_url` is not. Throws when the page names no header or the header is not a JSON object; fetch failures
 * propagate from `fetchText`.
 */
export async function fetchTableHeaderCourses(url: string, fetchText: TableFetchText): Promise<TableHeaderCourses> {
  const first = await fetchText(url);
  let headerURL = url;
  let header = parseJSONObject(first);
  if (header === undefined) {
    const resolved = resolveTableHeaderURL(url, first);
    if (resolved === undefined) throw new Error(`No difficulty-table header (bmstable meta) found at ${url}`);
    headerURL = resolved;
    header = parseJSONObject(await fetchText(resolved));
    if (header === undefined) throw new Error(`The difficulty-table header at ${resolved} is not a JSON object`);
  }
  return {
    label: nonEmptyString(header.name) ?? nonEmptyString(header.symbol) ?? hostOf(url),
    courses: parseTableHeaderCourses(header).flat(),
    headerURL,
  };
}
