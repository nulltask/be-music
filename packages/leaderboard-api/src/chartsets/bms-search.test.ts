import { describe, expect, test } from 'vite-plus/test';
import {
  BMS_SEARCH_USER_AGENT,
  bmsSearchPatternURLs,
  lookupBMSSearchPattern,
  parseBMSSearchPattern,
} from './bms-search.ts';

const SHA = 'a'.repeat(64);
const MD5 = 'b'.repeat(32);

describe('parseBMSSearchPattern', () => {
  test('reads the work a chart is filed under and its package type', () => {
    expect(
      parseBMSSearchPattern({
        title: 'Acque Minerali [Borealis]',
        packType: 'ADDITIONAL',
        bms: { id: 'mqcgl4L22QF7yc', title: 'Acque Minerali', exhibition: { id: 'x', name: 'b.i.n.' } },
      }),
    ).toEqual({
      chartset: { id: 'mqcgl4L22QF7yc', title: 'Acque Minerali', event: 'b.i.n.' },
      packType: 'additional',
    });
  });

  test('gives no chartset for an unlinked chart or a malformed id, and tolerates missing fields', () => {
    expect(parseBMSSearchPattern({ packType: 'INCLUDED', bms: null })).toEqual({
      chartset: null,
      packType: 'included',
    });
    expect(parseBMSSearchPattern({ bms: { id: '../x', title: 'T' } })).toEqual({ chartset: null, packType: null });
    expect(parseBMSSearchPattern({ bms: { id: 'abc' } })).toEqual({
      chartset: { id: 'abc', title: 'abc', event: null },
      packType: null,
    });
    expect(parseBMSSearchPattern('nonsense')).toEqual({ chartset: null, packType: null });
  });
});

describe('bmsSearchPatternURLs', () => {
  test('tries the SHA-256 before the MD5', () => {
    expect(
      bmsSearchPatternURLs([
        { kind: 'md5', hash: MD5 },
        { kind: 'sha256', hash: SHA },
      ]),
    ).toEqual([`https://api.bmssearch.net/v1/patterns/sha256/${SHA}`, `https://api.bmssearch.net/v1/patterns/${MD5}`]);
  });
});

describe('lookupBMSSearchPattern', () => {
  const aliases = [
    { kind: 'sha256' as const, hash: SHA },
    { kind: 'md5' as const, hash: MD5 },
  ];

  test('falls back to the next hash on a 404, and identifies itself', async () => {
    const requests: Array<{ url: string; agent: string | null }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), agent: new Headers(init?.headers).get('user-agent') });
      return String(input).includes('/sha256/')
        ? new Response('{}', { status: 404 })
        : Response.json({ packType: 'INCLUDED', bms: { id: 'w1', title: 'Work' } });
    }) as typeof fetch;
    expect(await lookupBMSSearchPattern(fetcher, aliases)).toEqual({
      chartset: { id: 'w1', title: 'Work', event: null },
      packType: 'included',
    });
    expect(requests.map((request) => request.agent)).toEqual([BMS_SEARCH_USER_AGENT, BMS_SEARCH_USER_AGENT]);
  });

  test('gives undefined when no hash is known, and throws on an error so the chart is tried again', async () => {
    const notFound = (async () => new Response('{}', { status: 404 })) as typeof fetch;
    expect(await lookupBMSSearchPattern(notFound, aliases)).toBeUndefined();
    const failing = (async () => new Response('', { status: 503 })) as typeof fetch;
    await expect(lookupBMSSearchPattern(failing, aliases)).rejects.toThrow('503');
  });
});
