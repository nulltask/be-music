---
'@be-music/player': patch
---

Name the judge ruleset ids once: `PlayerOptions.judgeRuleset`, `PlaylogPlay.judgeRuleset` and `PlaylogRecorderPlaySettings.judgeRuleset` are now typed `PlaylogRulesetId` (`@be-music/player/ruleset`) instead of each spelling out `'lr2' | 'beatoraja' | 'iidx'`. `JudgeWindowRuleset` (`@be-music/player/core/judge-window`) is now a deprecated alias of `PlaylogRulesetId`. The ids themselves are unchanged.
