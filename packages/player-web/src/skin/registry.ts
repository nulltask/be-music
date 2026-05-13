import { beatorajaSkinFamily } from './beatoraja/family.ts';
import { defaultSkinFamily } from './default/family.ts';
import { createSkinFamilyRegistry, type SkinFamilyRegistry } from './family.ts';
import { lr2SkinFamily } from './lr2/family.ts';

/**
 * The package's canonical {@link SkinFamilyRegistry} — the three skin families in the order the host should consult
 * them. LR2 and beatoraja are theme-supplying families (probed via `matchesThemeFile`); default sits last as the
 * fallthrough. Hosts that need to extend the family set can build their own registry via
 * {@link createSkinFamilyRegistry}; this default registry covers every shipped scene path.
 *
 * Priority rationale: today no two families' `matchesThemeFile` predicates overlap, so iteration order doesn't
 * affect detection. The order below documents intent — if a future family extension creates an overlap, LR2 is
 * checked first, then beatoraja, then default (which never matches files anyway).
 */
export const skinFamilyRegistry: SkinFamilyRegistry = createSkinFamilyRegistry([
  lr2SkinFamily,
  beatorajaSkinFamily,
  defaultSkinFamily,
]);

// Individual family objects are re-exported from `src/index.ts` directly (one re-export per family file). Don't
// re-export them here as well — duplicate `export *` paths cause name-collision warnings during package build.
