[日本語版](./0001-skin-families-only-draw.ja.md)

# Skin families only draw

Each screen's behaviour — browsing, play options, chart preparation, engine options, input, endings, sounds — lives once, in a family-neutral **scene session** working on a runtime-neutral **scene model**. The built-in, LR2 and beatoraja **skin families** are **family views**: they draw the model in their skin and turn the player's actions into **intents** (open a folder, start a course, cycle the gauge). Every scene has one lifecycle (`PixiScene`) and every family the same host API.

We chose this because the families had grown two engine wirings and two browse models, and their drift caused most of the bugs the course work found: the cursor not restored after a course, PLAY / AUTO ignoring course bars, ESC not interrupting the engine on one family, beatoraja never applying RANDOM / MIRROR, replay and NONSTOP missing on beatoraja.

## Considered options

- **Shared helpers called from per-family scenes.** Keeps two or three places to wire every feature; a helper nobody calls on one family is the same bug as today.
- **A base scene with protected hooks** (how the built-in and LR2 gameplay worked). The base grew to 5,900 lines carrying LR2 vocabulary, and beatoraja could not fit into it, so it forked.
