[日本語](./0023-generic-bmson-keyboards.ja.md)

# 0023: Generic bmson keyboards retain their declared layout

## Context

The [bmson specification](https://github.com/bemusic/bmson-spec/blob/668c4338cd7c64da2d2ec0f848c4ad58a3a881d9/doc/index.rst) distinguishes generic keyboards from beat layouts with the same channel count. Positional parsing followed by beat-mode inference changes ordinary keys into scratch or FREE ZONE, and sparse charts lose their declared width. The internal visible channel domain has two banks of 35 columns.

## Decision

Represent a supported generic keyboard by `ChartPlayVariant` `generic-N` and the label `N KEY GENERIC`. Support integer N from 1 through 70; reject zero or overflow explicitly rather than clamping. Reject malformed hints under the reserved `generic-` prefix with `TypeError`. Preserve the existing singular `generic-Nkey` alias. Generate a shared layout and bmson table for each count. Positions 1–35 use `11..1Z`, and 36–70 use `21..2Z`, but every column belongs to one continuous 1P keyboard. All columns are ordinary white keys with global slots 1–N. Neither storage-bank prefixes nor populated-note counts determine the game mode.

The engine binds the full declared keyboard, including empty columns. Scratch assistance and FREE ZONE aliases do not apply. The beatoraja ruleset uses its keyboard judgment and default-TOTAL category for every generic count; this is Be-Music behavior because generic layouts have no upstream mode enum. Beat-specific battle/conversion operations stay unavailable. NONSTOP retains the declared generic count, and rejects mixing it with a different layout.

Native, Canvas and LR2 use equal-width fallback columns. A beatoraja theme supplies its note-area bounds, subdivided equally, while ordinary fallback graphics replace mode-specific note sprites. Terminal uses white-key styling. Existing themes may retain their decorative fixed-layout artwork; the note positions and input layout remain generic. Physical keyboard bindings use real printable codes followed by F1–F24. Bound F5 takes precedence over restart. Terminal input uses the [kitty functional encodings](https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions) and [Win32 virtual-key codes](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes), retaining key state. Input hardware, terminal width and simultaneous-key limits remain host constraints.

Canonical bmson output preserves authored generic positions, including unused columns and bank crossings. A generic hint synthesized when converting an unclassified BMS chart numbers that chart’s used lanes consecutively. BMS output rejects an explicitly generic layout because it cannot preserve this game identity. Be-Music JSON and bmson retain it.

Play fingerprints include `generic-N`; factorized chart fingerprints retain the canonical generic hint among lane-mode inputs. Previously misclassified generic charts receive corrected fingerprints. Replay lane-mode labels and the existing source-variant field carry the identity; no replay schema fields are added. Replay parsing validates the bounded variants.

## Consequences

Generic keyboards remain distinct at the parser/model/engine boundary and across rendering and replay. The 70-key bound follows the current channel representation rather than an arbitrary parser clamp. Increasing it requires a new internal lane representation; it must not borrow invisible or long-note channel families. Unknown non-generic hints keep their separate compatibility policy. These changes do not claim generic-layout support in LR2 or beatoraja themselves.
