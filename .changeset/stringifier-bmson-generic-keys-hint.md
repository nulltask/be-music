---
'@be-music/stringifier': patch
---

A BMS chart whose lanes fit no canonical bmson layout is now written with the spec's `generic-<lanes>keys` hint (lanes numbered left to right) instead of a made-up `beat-<lanes>k`, which is an unknown hint that beatoraja, Qwilight and Bemuse read as `beat-7k`.
