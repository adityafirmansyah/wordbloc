# WordBloc — Frozen Spec (v1)

Product: kids English word-building game, web-first, portable to Android/Windows.
Repo: github.com/adityafirmansyah/wordbloc
Domain: wordbloc.com (purchasing is owner-gated, NOT part of this build)

## Stack (LOCKED — do not re-litigate)
- **Phaser 3** (npm `phaser`, v3.80+) + **TypeScript** + **Vite**.
- Renderer: `Phaser.AUTO` (WebGL with Canvas 2D fallback) — required for low-spec Android.
- Target: 1280x720 design space, `Scale.FIT` + center, portrait/landscape safe.
- No backend in v1. All level data is static JSON bundled from `src/data/`.
- Capacitor wiring comes in a LATER milestone. v1 must run with `npm run dev` in a browser.

## Core Loop
1. Load level N -> show illustration + play word audio.
2. Player drags letter/syllable tiles from the tray into ordered slots.
3. Correct -> snap + word audio + confetti + star award -> Next.
4. Wrong -> tile bounces back to tray, NO buzzer, NO penalty, NO life system.
5. Completed words persist to `localStorage` "wordbook".

## Difficulty Tiers (mechanic changes, engine stays identical)
- **T1 (Grade 1):** 3-4 letter CVC words. Exact tile set, no distractors. Ghost letters ON.
- **T2 (Grade 2-3):** 4-6 letters. Distractor tiles added (+2..3). Ghost letters OFF.
- **T3 (Grade 3-4):** 6-9 letters, mechanic = `syllable_tap` (chunks, not per-letter).
- **T4 (Grade 4-5):** compound words, mechanic = `compound` (two parts merge).
- **T5 (Grade 5-6):** prefixes/suffixes, mechanic = `affix` + sentence riddle clue.

## Phonics Rule (non-negotiable)
When a tile is tapped/placed, speak the **phoneme** (`/k/ /æ/ /t/`), NOT the letter name
("cue ay tee"). On full-word completion, speak the whole word. Letter-name audio is a defect.

## Level Data (`src/data/levels/`)
Levels are **not** one monolithic file. Each level is its own JSON file under a
tier directory, indexed by a small manifest that is the only part imported
synchronously:

```
src/data/levels/
  manifest.json                  # index: one lightweight row per level (version 2)
  tier-1/lvl_0001_cat.json       # full puzzle for ONE word -> its own JS chunk
  tier-1/...                     # 10 x T1
  tier-2/...                     # 8 x T2
  tier-3/...                     # 6 x T3
  tier-4/...                     # 3 x T4
  tier-5/...                     # 3 x T5
```

### Manifest (`src/data/levels/manifest.json`, `version: 2`)
Only the metadata the Menu, Progress and Wordbook need — no tiles, phonemes or
hints — so it stays cheap as the catalogue grows:
```json
{
  "version": 2,
  "levels": [
    {
      "id": "lvl_0001",
      "tier": 1,
      "word": "CAT",
      "display": "cat",
      "meaning_id": "kucing",
      "category": "animals",
      "mechanic": "letter_drag",
      "file": "tier-1/lvl_0001_cat.json"
    }
  ]
}
```
`file` must match `tier-<tier>/<name>.json` and live in the directory of its own
`tier`; the loader rejects traversal, URLs, and tier/file mismatches.

### Per-level file (`src/data/levels/tier-X/lvl_NNNN_word.json`)
One object holding the whole puzzle for that word:
```json
{
  "id": "lvl_0001",
  "tier": 1,
  "word": "CAT",
  "display": "cat",
  "meaning_id": "kucing",
  "category": "animals",
  "mechanic": "letter_drag",
  "image": "animals/cat",
  "audio_word": "words/cat",
  "audio_phonemes": ["phonemes/k", "phonemes/ae", "phonemes/t"],
  "tiles": ["C", "A", "T"],
  "distractors": [],
  "chunks": null,
  "hint": "It says meow.",
  "ghost_letters": true
}
```
Field rules:
- `mechanic` ∈ `letter_drag | syllable_tap | compound | affix`.
- `tiles` = shuffled-ready source pool (engine shuffles at runtime; do NOT pre-shuffle).
- `chunks` used ONLY by `syllable_tap`/`compound`/`affix`, e.g. `["BUT","TER","FLY"]`.
- `distractors` appended to `tiles` to form the tray.
- Paths in `image`/`audio_*` are atlas/key refs, never file extensions.
- Loader MUST throw a readable error on unknown `mechanic` or missing `tiles`/`chunks`.
- `id`, `tier`, `word`, `display`, `mechanic` must agree with the manifest row that
  points at the file — a mismatch is a `LevelContractError`, not a silent win.

### Lazy loading (`src/game/levels.ts`)
Vite indexes the directory at build time, turning **each** level file into its own
chunk:
```ts
const levelModules = import.meta.glob('../data/levels/tier-*/*.json');
```
- `manifest.json` is imported eagerly: counts, tier lists, unlock rules and
  Wordbook cards need no network beyond the initial bundle.
- `loadLevel(id)` resolves the row, awaits that one chunk, validates it through
  `parseLevel()`, and caches the result (repeat plays are synchronous-fast).
  Concurrent calls share one in-flight import.
- `preloadLevel(id)` warms the next chunk without ever throwing, so a failed
  prefetch cannot break the scene that requested it.
- `GameScene` draws a small "Loading <word>" card while the chunk arrives, then
  builds the board; a load that resolves after navigation is discarded.
- `RewardScene` preloads the next level while the star animates; `Next` is instant.
- `main.ts` / `BootScene` validate the manifest and assert every row has a bundled
  file — deliberately without importing the files, which would undo the laziness.

Adding a level = one new file under its tier directory + one manifest row.
Nothing else re-downloads, and no other file needs editing.

## v1 Deliverable Scope
- Boot -> Menu -> Game -> Reward scene flow.
- 30 seeded levels: 10 x T1, 8 x T2, 6 x T3, 3 x T4, 3 x T5.
- Working drag-drop with magnetic snap on pointer + touch.
- Wordbook screen listing unlocked words with replay audio.
- Placeholder art (procedural Phaser Graphics shapes) — real art is a separate milestone.
- Placeholder audio: silent/no-audio graceful degradation, never a crash if a key is missing.

## Hard Constraints
- 60 FPS on a 2GB-RAM Android (Unisoc/Helio A22 class). Single texture atlas for UI.
- Touch targets >= 64x64 CSS px.
- No console errors on load; `tsc -b && vite build` must pass clean.
- TypeScript strict mode ON. No `.jsx`/`.js` source files.
- All copy in English UI; `meaning_id` reserved for future Indonesian gloss.
