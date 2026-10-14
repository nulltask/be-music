---
'@be-music/leaderboard-api': patch
---

Keep signed-in players' session cookie cache warm. Pages and the API read the session with Better Auth's `getSession` but dropped the cookies it set while answering, so once the five-minute cookie cache expired every request read the session from D1 again, and a session whose expiry Better Auth extended was never extended in the browser. Those cookies are now passed on with the response (except on publicly cacheable ones). The Better Auth instance is also built once per bindings object and origin instead of per request.
