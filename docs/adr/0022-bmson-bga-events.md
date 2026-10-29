[日本語](./0022-bmson-bga-events.ja.md)

# 0022: Conditional bmson BGA events follow deterministic chart time

## Context

beatoraja's bmson decoder stores sequence alternatives, conditions and intervals. Its renderer implements MISS layers but does not execute PLAY/ALWAYS event layers or event intervals. Copying retention alone leaves those chart features inactive. The user chose documented Be-Music execution rules for these unfinished upstream features on 2026-10-29. See [the sequence data specification](../bmson-spec.md#beatoraja-bga-sequence-data) for upstream references and resource-id conventions.

## Decision

The deterministic engine owns the active sequence and publishes its filename, display plane and frame-start time on `PlayerUIFramePayload.bmsonBGA`. Hosts load every possible referenced frame, then draw the published state using their normal BGA composition. Judgments, score, audio and recorded input streams do not depend on this presentation state.

| Condition                     | Start                                                                  | Meaning of positive `interval`                                  |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `play`                        | PERFECT, GREAT or GOOD judgment                                        | Minimum milliseconds between accepted starts                    |
| `miss`                        | Existing engine POOR-BGA trigger, including BAD/POOR and mine triggers | Minimum milliseconds between accepted starts                    |
| `always` or unknown condition | Selection's chart second                                               | Repeat starts at that many chart milliseconds; zero starts once |

Intervals and authored sequence-frame offsets use chart milliseconds, so pause holds them and tempo scales them with the chart. An absent layer interval is zero. POOR events keep the upstream forced MISS condition, interval 1 and single-id lookup. An accepted start cycles through `id_set` in authored order; throttled triggers do not advance the choice. A host may supply an explicit alternative index to the controller. No hidden clock or randomness changes the choice.

A newer selection ends the previous animation and resets its choice counter. Ordinary image-layer changes clear an earlier event selection while continuing through the normal image timeline. At equal chart times, selections precede judgments; source order breaks selection ties. A successful judgment clears an active MISS animation. MISS frames replace the normal BGA stack; PLAY/ALWAYS frames use its layer plane. End markers end an animation until the next accepted start; a missing image never borrows another id.

Manual seek discards prior live judgment history. AUTO and replay seek rebuild the exact presentation inputs from the same silent judge effects used to rebuild their score; this includes mine POOR triggers. Reversal freezes selections and sequence-frame changes; an already selected movie follows the host’s existing video clock. Querying a controller backwards folds its retained inputs again and reproduces the same frame.

## Consequences

These rules implement useful event behavior without claiming beatoraja pixel or trigger parity for its unfinished features. They are presentation rules and add no replay schema fields: replay judgments reproduce the sequence choices. The engine and terminal implement the state path first; browser drawing and NONSTOP placement remain part of issue #826 until their own integration tests pass.
