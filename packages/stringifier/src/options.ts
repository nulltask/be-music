export interface BMSStringifyOptions {
  eol?: '\n' | '\r\n';
  maxResolution?: number;
  /**
   * When `true`, skip the round-trip re-parse that normally verifies the preserved source / object lines still encode
   * the same chart as `json`. The default (`false`) re-runs `parseBMS` against the just-rendered output and falls back
   * to canonical sections on mismatch — the safe choice when callers may have mutated the JSON between parse and
   * stringify. Set to `true` only when you can guarantee the preservation arrays were produced by an in-process parse
   * of unchanged content (e.g. a pure round-trip in tests, a SHA-stable export pipeline); doing so halves stringify
   * time on charts large enough for the re-parse to dominate (`stringifier:200`).
   */
  skipPreservationValidation?: boolean;
}

export interface BmsonStringifyOptions {
  resolution?: number;
  indent?: number;
  /** See {@link BMSStringifyOptions.skipPreservationValidation}. */
  skipPreservationValidation?: boolean;
}
