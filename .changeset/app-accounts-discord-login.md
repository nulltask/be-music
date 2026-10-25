---
'@be-music/app-accounts': patch
---

Discord sign-in asks for consent on the first authorization. Google sign-in leaves the authorize prompt unset so the first authorization can show account selection and consent, and the Accounts Worker requires the Discord and Google client id and secret for that environment.
