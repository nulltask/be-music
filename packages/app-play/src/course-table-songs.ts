// The song list a difficulty table publishes behind its header's `data_url`, read for the download pages of the stages
// a course is missing. Only the links are kept: the list's levels and comments do not become folders.
import type { CourseStageRef } from '@be-music/player-engine/course';
import type { LibraryCourse } from '@be-music/player-scene-model';

/** Where one of a table's songs can be found: its download page, its chart (差分) page, and the pack it ships in. */
export interface TableSongLinks {
  title?: string;
  artist?: string;
  /** The song's own download page (`url`). */
  url?: string;
  /** The chart's page when it ships apart from the song (`url_diff`), with its author or name (`name_diff`). */
  urlDiff?: string;
  nameDiff?: string;
  /** The pack the song ships in (`url_pack`), with its name (`name_pack`). */
  urlPack?: string;
  namePack?: string;
}

/** A table's songs by chart-file hash: lower-case MD5 and SHA-256 hex. */
export type TableSongIndex = ReadonlyMap<string, TableSongLinks>;

/** One link a missing stage offers: what it leads to, and where. */
export interface MissingStageLink {
  kind: 'song' | 'diff' | 'pack';
  href: string;
  /** The chart's author or the pack's name, when the table names one. */
  name?: string;
}

/** A stage a course is missing from the collection: its title and where it can be found. */
export interface MissingCourseStage {
  /** 1-based stage number. */
  stage: number;
  title: string;
  artist?: string;
  links: MissingStageLink[];
}

const HASH_PATTERN = /^[0-9a-f]{32}$|^[0-9a-f]{64}$/u;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** An absolute http(s) URL, else `undefined`: a table's links open in a new tab, so nothing else may get through. */
function webURL(value: unknown): string | undefined {
  const raw = nonEmpty(value);
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function hashKey(value: unknown): string | undefined {
  const hash = nonEmpty(value)?.toLowerCase();
  return hash !== undefined && HASH_PATTERN.test(hash) ? hash : undefined;
}

/**
 * Reads a difficulty table's song list (the JSON array behind `data_url`) into its songs' links by MD5 and SHA-256.
 * Entries without a valid hash are skipped, as are links that are not absolute http(s) URLs. A text that is not a JSON
 * array gives an empty index.
 */
export function parseTableSongIndex(text: string): Map<string, TableSongLinks> {
  const index = new Map<string, TableSongLinks>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/u, ''));
  } catch {
    return index;
  }
  if (!Array.isArray(parsed)) return index;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const keys = [hashKey(record.md5), hashKey(record.sha256)].filter((key) => key !== undefined);
    if (keys.length === 0) continue;
    const links: TableSongLinks = {};
    const fields: [keyof TableSongLinks, string | undefined][] = [
      ['title', nonEmpty(record.title)],
      ['artist', nonEmpty(record.artist)],
      ['url', webURL(record.url)],
      ['urlDiff', webURL(record.url_diff)],
      ['nameDiff', nonEmpty(record.name_diff)],
      ['urlPack', webURL(record.url_pack)],
      ['namePack', nonEmpty(record.name_pack)],
    ];
    for (const [field, value] of fields) if (value !== undefined) links[field] = value;
    // The first entry for a hash wins, as a table lists each chart once.
    for (const key of keys) if (!index.has(key)) index.set(key, links);
  }
  return index;
}

function linksOf(song: TableSongLinks | undefined): MissingStageLink[] {
  if (song === undefined) return [];
  const links: MissingStageLink[] = [];
  const add = (kind: MissingStageLink['kind'], href: string | undefined, name?: string): void => {
    if (href === undefined || links.some((link) => link.href === href)) return;
    links.push({ kind, href, ...(name !== undefined ? { name } : {}) });
  };
  add('song', song.url);
  add('diff', song.urlDiff, song.nameDiff);
  add('pack', song.urlPack, song.namePack);
  return links;
}

/**
 * The stages of `course` that are not in the collection, each with its title and the pages `songs` (its table's song
 * list) names for it, looked up by the stage's SHA-256, then its MD5. Without `songs`, or for a stage the list does
 * not name, the stage keeps the course's title for it and offers no link.
 */
export function describeMissingCourseStages(course: LibraryCourse, songs?: TableSongIndex): MissingCourseStage[] {
  const missing: MissingCourseStage[] = [];
  course.stages.forEach((stage, index) => {
    if (stage.chart !== undefined) return;
    const ref = course.definition.stages[index];
    const song = findStageSong(ref, songs);
    const title = song?.title ?? ref?.title ?? stage.title;
    missing.push({
      stage: index + 1,
      title,
      ...(song?.artist !== undefined ? { artist: song.artist } : {}),
      links: linksOf(song),
    });
  });
  return missing;
}

/** The song `songs` lists for a stage, by its SHA-256, then its MD5. */
function findStageSong(ref: CourseStageRef | undefined, songs: TableSongIndex | undefined): TableSongLinks | undefined {
  if (ref === undefined || songs === undefined) return undefined;
  return (
    (ref.sha256 !== undefined ? songs.get(ref.sha256.toLowerCase()) : undefined) ??
    (ref.md5 !== undefined ? songs.get(ref.md5.toLowerCase()) : undefined)
  );
}

/**
 * `course` with each stage the collection lacks titled as its table's song list names it, so the select screen shows
 * the song in place of the course's placeholder (beatoraja's `course N`). Only what is shown changes: the definition
 * (and so the course's records and replays) is kept. The course itself comes back when no title changes.
 */
export function withTableSongTitles(course: LibraryCourse, songs: TableSongIndex): LibraryCourse {
  let changed = false;
  const stages = course.stages.map((stage, index) => {
    if (stage.chart !== undefined) return stage;
    const title = findStageSong(course.definition.stages[index], songs)?.title;
    if (title === undefined || title === stage.title) return stage;
    changed = true;
    return { ...stage, title };
  });
  return changed ? { ...course, stages } : course;
}
