---
'@be-music/chart-source': patch
---

Reject opaque bmson field values nested deeper than 256 levels instead of overflowing the stack. A hostile or broken unknown field made `parseBmson` throw `Maximum call stack size exceeded`; the field is now dropped like any other invalid annotation.
