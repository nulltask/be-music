import { describe, expect, test } from 'vite-plus/test';
import { computePlayFingerprint, createPlayFingerprintDocument } from '@be-music/chart';
import { parseBMS } from '@be-music/parser';
import { checkFingerprintDocument } from './documents.ts';

const json = parseBMS(['#BPM 150', '#00111:01020102', '#00112:0001'].join('\n'));
const fingerprint = computePlayFingerprint(json, { chartPath: undefined });
const document = createPlayFingerprintDocument(json, { chartPath: undefined });

describe('checkFingerprintDocument', () => {
  test('accepts the document of the claimed fingerprint, also after a JSON round trip', () => {
    expect(checkFingerprintDocument(document, fingerprint)).toEqual({ ok: true });
    expect(checkFingerprintDocument(JSON.parse(JSON.stringify(document)), fingerprint)).toEqual({ ok: true });
  });

  test('rejects an edited document or another chart', () => {
    expect(checkFingerprintDocument({ ...document, bpm: '200' }, fingerprint)).toEqual({
      ok: false,
      reason: 'fingerprint-mismatch',
    });
    expect(checkFingerprintDocument(document, 'bmfp0:' + '0'.repeat(64))).toEqual({
      ok: false,
      reason: 'fingerprint-mismatch',
    });
  });

  test('rejects something that is not a document', () => {
    for (const value of [null, 'text', 42, [document]]) {
      expect(checkFingerprintDocument(value, fingerprint)).toEqual({ ok: false, reason: 'not-a-document' });
    }
  });
});
