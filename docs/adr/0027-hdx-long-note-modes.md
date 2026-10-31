[日本語](./0027-hdx-long-note-modes.ja.md)

# 0027: Resolve HDX LONGMODE before preparing notes

## Context

The archived official charatbeatHDX manuals define `#OPTION charatbeatHDX:LONGMODE 0` as CN and `1` as HCN, overriding the user's default. HDX does not support CHANGEOPTION. The manuals do not define interactions with another dialect's `#LNMODE`, repeated declarations or case folding. See the [primary-source research](../research/chart-authored-options.md).

Be-Music already judges CN and HCN, but retaining the declaration without resolving it produces LN notes, fingerprints and recordings. Recognizing the declaration must also preserve earlier replay semantics and each NONSTOP stage's mode.

## Decision

After RANDOM/SWITCH selection, resolve BMS chart mode as valid explicit `#LNMODE` (1, 2 or 3), then the last valid initial HDX LONGMODE, then LN. Keep the vendor's exact case and whole argument; accept only 0 or 1 separated by spaces or tabs. Malformed later declarations do not erase valid earlier ones. These precedence and duplicate rules are Be-Music policy, not a claim of native cross-dialect behavior. bmson retains per-note `t` over `info.ln_type` over its default; this BMS extension does not override bmson.

Apply the chart's mode before the user's undefined-mode default or course constraints fill a missing mode. Route it through the existing judge selected by the user: beatoraja implements CN/HCN, LR2 retains its LN interpretation, and no directive selects another ruleset. LONGMODE is not a version-1 display-profile field. A timed A6 LONGMODE produces `initial-only-option`; malformed arguments produce `invalid-parameter`.

Fingerprint the effective long-note types using the existing representation, exactly as explicit LNMODE does. Conditional LONGMODE headers participate in the same dependency factor as LNMODE and lane objects. Raw spelling and display-only options add no fingerprint content. BMS writing retains the raw declaration; bmson conversion writes its effective `ln_type`.

A recorded replay's chart mode wins over newly recognized source declarations, including recorded LN (1). The same applies when reusing a previous arrangement. Resolve branch draws before applying the live user's default, including pre-resolved charts.

NONSTOP stitch version 3 uses bmson's per-note types whenever a BMS stage contains CN/HCN, preserving modes across stage boundaries and FIT. Versions 1 and 2 retain their previous BMS stitching behavior for historical recordings. This also repairs the same loss for explicit BMS LNMODE. Existing bmson courses retain their per-note path.

## Consequences

No new judge algorithm or visual family is required. Effective note modes drive existing rendering, recording and deterministic replay simulation. BMS-only CN/HCN courses can now produce an internal bmson chart; export mixed-mode courses as bmson to retain their types, because native BMS has only one global LNMODE. Other OPTION families remain tracked in #835.
