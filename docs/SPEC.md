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

## Level JSON Contract (`src/data/levels.json`)
```json
{
  "version": 1,
  "levels": [{
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
  }]
}
```
Field rules:
- `mechanic` ∈ `letter_drag | syllable_tap | compound | affix`.
- `tiles` = shuffled-ready source pool (engine shuffles at runtime; do NOT pre-shuffle).
- `chunks` used ONLY by `syllable_tap`/`compound`/`affix`, e.g. `["BUT","TER","FLY"]`.
- `distractors` appended to `tiles` to form the tray.
- Paths in `image`/`audio_*` are atlas/key refs, never file extensions.
- Loader MUST throw a readable error on unknown `mechanic` or missing `tiles`/`chunks`.

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
