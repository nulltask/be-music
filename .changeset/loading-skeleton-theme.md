---
'@be-music/service-web-theme': minor
---

Add a shared loading placeholder: `skeletonTemplate` draws a shimmering line, circle or block in the box of the content it stands in for, `skeletonGroupTemplate` marks the region busy for assistive technology, and `src/skeleton.css` styles both for light and dark themes and stops the shimmer under `prefers-reduced-motion`. The header takes `accountLoading`, which shows a placeholder in the signed-in control's box instead of "Sign in" while a page reads the account.
