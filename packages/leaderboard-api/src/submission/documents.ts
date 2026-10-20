import { computeFingerprintOfDocument, type BeMusicFingerprintDocument } from '@be-music/chart';

export type DocumentCheck = { ok: true } | { ok: false; reason: 'not-a-document' | 'fingerprint-mismatch' };

/**
 * Checks a fingerprint document a client sent against the fingerprint it claims (verification layer L3,
 * docs/leaderboard.md section 5.3). The document is canonicalized and hashed exactly like the chart package hashes the
 * documents it builds, so any edit to it, or a document of another chart, fails. This checks integrity only; whether
 * the document describes the play log's notes is a later layer.
 */
export function checkFingerprintDocument(document: unknown, claimedFingerprint: string): DocumentCheck {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return { ok: false, reason: 'not-a-document' };
  }
  let actual: string;
  try {
    actual = computeFingerprintOfDocument(document as BeMusicFingerprintDocument);
  } catch {
    return { ok: false, reason: 'not-a-document' };
  }
  return actual === claimedFingerprint ? { ok: true } : { ok: false, reason: 'fingerprint-mismatch' };
}
