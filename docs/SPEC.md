# WordBloc — Frozen Spec (v1)

Product: kids English word-building game, web-first, portable to Android/Windows.
Repo: github.com/adityafirmansyah/wordbloc
Domain: wordbloc.com (purchasing is owner-gated, NOT part of this build)

## Stack (LOCKED — do not re-litigate)
- **Phaser 3** (npm `phaser`, v3.80+) + **TypeScript** + **Vite**.
- Renderer: `Phaser.AUTO` (WebGL with Canvas 2D fallback) — required for low-spec Android.
- Target: full-bleed stage. `Phaser.Scale.RESIZE` (canvas == viewport, never letterboxed)
  over a 1280x720 design **island** that the main camera zooms and centres; the live
  stage grows in width (aspect > 16:9) or height (aspect < 16:9) so content always
  fills the screen edge to edge. Portrait/landscape safe via the viewport gate.
- No backend in v1. All level data is static JSON bundled from `src/data/`.
- Capacitor wiring comes in a LATER milestone. v1 must run with `npm run dev` in a browser.

## Core Loop
1. Load level N -> show illustration + play word audio.
2. Player drags letter/syllable tiles from the tray into ordered slots.
3. Correct -> snap + word audio + confetti + star award -> Next.
4. Wrong -> tile bounces back to tray, NO buzzer, NO penalty, NO life system.
5. Completed words persist to `localStorage` "wordbook".

## Difficulty Tiers & Level Progression (Strictly Monotonic Ramping)

**CRITICAL PROGRESSION LAW:**
WordBloc difficulty MUST ramp monotonically as levels increase, without upper limit (Level 100, 500, 1000+). Difficulty NEVER jumps backward (e.g. going back to 3-letter single-word spelling after mastering affixes and sentences is strictly forbidden). As level increases, cognitive load shifts continuously from phonetic spelling to syntax, semantic pairing, grammatical tenses, multi-sentence discourse, and deductive reading comprehension. Do NOT propose, design, or implement single-word spelling regressions in higher tiers.

- **Phase 1: Foundation Words (Levels 1–30)**
  - **T1 (Levels 1–10):** 3-4 letter CVC words. Exact tile set, no distractors. Ghost letters ON. (`letter_drag`)
  - **T2 (Levels 11–18):** 5-6 letters. Distractor tiles added (+2..3). Ghost letters OFF. (`letter_drag`)
  - **T3 (Levels 19–24):** 6-9 letters, multi-syllable chunks with chunk distractors. (`syllable_tap`)
  - **T4 (Levels 25–27):** Compound words fusion (two independent base words merge into one). (`compound`)
  - **T5 (Levels 28–30):** Structural affixes (prefixes *un-, re-* and suffixes *-ful*). (`affix`)

- **Phase 2: Advanced Syllabic & Lexical Complexity (Levels 31–45)**
  - Advanced 3-4 syllable chunking & phrasal collocations / prepositional pairing.
  - Multi-word tiles: e.g. `[a slice of]` + `[CAKE]` (distractors: *a cup of*, *a piece of*), `[switch on]` + `[THE LIGHT]`.
  - Cognitive focus: Natural English collocations and contextual associations.

- **Phase 3: Dynamic Sentence Builder & Syntax (Levels 46–65)**
  - Full sentence syntax ordering: 4–6 multi-word / phrasal tiles.
  - Tiles represent syntactic units: `[The monkey]` + `[is climbing]` + `[a tall tree]`.
  - Distractors test subject-verb agreement and word order (e.g. *are climbing*, *climbs*).
  - Cognitive focus: S-V-O-A syntactic construction and sentence comprehension.

- **Phase 4: Tenses & Situational Grammar Logic (Levels 66–85)**
  - Contextual time clues (past, present continuous, future):
  - Example: Situation indicates yesterday ➔ `[Yesterday,]` + `[we]` + `[bought]` + `[fresh apples]` (distractors: *buy*, *buys*, *buying*).
  - Situation indicates tomorrow ➔ `[Tomorrow,]` + `[she will visit]` + `[her grandmother]`.
  - Cognitive focus: Contextual tense inflection and temporal reasoning.

- **Phase 5: Master Riddles & Deductive Comprehension (Levels 86–100+)**
  - Multi-sentence riddle / reading comprehension clue requiring deductive reasoning.
  - No direct answer pictures; visual provides ambient clue, text requires deduction.
  - Example: *"I have no legs but I run. I roar without a throat. I bring life to the desert."* ➔ `[A rushing]` + `[river]` (distractors: *A blowing wind*, *A thunderstorm*).
  - Comparative and superlative deduction: e.g. `[the fastest]` + `[animal in the world]`.
  - Open-ended scale: Further expansions (Levels 101+) continue building into advanced idioms, paragraph ordering, story sequencing, and multi-step logic without ever resetting to lower-tier mechanics.

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
- Real 2D art (30 sticker WebPs) and recorded audio (30 word + 50 phoneme MP3s) ship
  in `public/assets/`; see "Real Assets" below.

## Real Assets (living section)

Ruled after the art/audio milestone. The pack lives in `public/`, which Vite copies
verbatim into `dist/`:

```
public/assets/
  images/<category>/<word>.webp    30 stickers, 512x512, RGBA, <40 KB each
  audio/words/<word>.mp3           30 word clips, -23 LUFS
  audio/phonemes/<phoneme>.mp3     50 phoneme clips
  audio/sfx/<cue>.mp3              5 tactile SFX (snap, bounce, chime, star, click)
```

- Level JSON keeps extension-free refs (`image: "animals/cat"`,
  `audio_word: "words/cat"`, `audio_phonemes: ["phonemes/k", ...]`). `src/game/assets.ts`
  is the ONLY place that turns a ref into a URL / texture key.
- **Illustrations** load per level, on demand, deduped per scene (`src/game/art.ts`),
  and register as `art/<ref>` in the texture cache so a sticker can never collide with
  a generated UI-atlas frame. The clue band is SQUARE (`BANDS.artSize`) because the
  pack is uniformly 512x512; a failed load falls back to a tinted halo + word initial.
- **Audio** is Web Audio first: the clip is fetched + `decodeAudioData`d, then
  `AudioBufferSourceNode.start()` is synchronous, so a tile placement speaks with no
  buffering gap. `HTMLMediaElement` is the fallback where Web Audio is missing, and
  Web Speech is used ONLY when the FILE failed to load (a 404 / undecodable bytes) —
  never for an autoplay block, which is a policy state, not a broken file.
- `phonemes/silent` deliberately has NO file: it must resolve to silence without a
  network request (a 404 per silent letter was the risk).
- **Game juice (SFX)** rides the same manager through `playSfx(key)` with a closed key
  set — `sfx/snap` (tile locks into a slot), `sfx/bounce` (invalid tile wobbles home;
  never a harsh buzzer), `sfx/chime` (word solved), `sfx/star` (reward star reveal) and
  `sfx/click` (button press). Three properties are requirements, not polish:
  each cue starts on its OWN source node so it overlaps the phoneme/word speech instead
  of cutting it off; the five buffers are decoded per scene and pooled OUTSIDE the
  word/phoneme LRU so a long level cannot evict them; and SFX are NEVER synthesised via
  Web Speech — a missing cue is silence, because a spoken "snap" is not a snap.
  Mute silences playback (buffers are still decoded ahead of time).
- **One `AudioContext` per document.** Every scene builds its own `AudioManager`, so a
  per-manager context leaked one context per scene transition (measured: 38 over 12
  transitions on main) with nothing ever closing them. The context is now created once
  per page and borrowed; `dispose()` closes only a context the engine itself built.
  Real browsers cap concurrent contexts per document, so the leak would eventually
  silence the game mid-session.
- Browsers start an `AudioContext` suspended until a user gesture. Scenes therefore
  call `audio.unlock()` from their first pointerdown; `GameScene` re-speaks its arrival
  word afterwards if the pre-gesture attempt was swallowed.
- Every `play*` promise settles. Both `AudioContext.resume()` and a media element's
  `play()` can stay pending forever (measured in headless Chrome), so both are
  bounded by timeouts — a hang would otherwise freeze the caller.


## Scale / Viewport Model (living section)

Ruled after the mobile defect "on mobile the layout did not use full space".

- `Phaser.Scale.RESIZE` with `autoCenter: NO_CENTER`. The canvas is sized to `#game`
  (100% x 100%), so `canvas.getBoundingClientRect()` equals the viewport rect at every
  aspect ratio — no letterbox bars, ever. Canvas pixels are CSS pixels (`autoRound`),
  which keeps the fill-rate budget sane on 2GB-RAM Android.
- Content is authored against a fixed **design island** of 1280x720 (`DESIGN_WIDTH` /
  `DESIGN_HEIGHT`) whose centre is `(ISLAND_CENTRE_X, ISLAND_CENTRE_Y)`. Scenes centre
  their content on that island; the main camera is zoomed by the stage scale and centred
  on it (`src/ui/stage.ts`), so the island always appears centred on screen.
- The live stage is derived from the viewport aspect (`stageMetrics()` in
  `src/game/theme.ts`):

  ```
  aspect = viewportWidth / viewportHeight
  width  = max(MIN_DESIGN_WIDTH, DESIGN_HEIGHT * aspect)
  height = width / aspect
  scale  = viewportWidth / width   (=== viewportHeight / height)
  ```

  `MIN_DESIGN_WIDTH` is 1280: it is the narrowest stage on which the widest
  fixed-width surface still fits (Wordbook panel 980 + pager arrows at 76/width-76
  needs >= 1264; the Game tray wraps at 1180).
- **Narrow viewports grow the visible HEIGHT, not the content.** When the aspect is
  narrower than 16:9 (tablet landscape, e.g. 1180x820 or 1024x768) the stage width is
  pinned at 1280 and the visible height grows past 720, so the extra room becomes sky
  above and below the island band instead of dead letterbox bars. Content is never
  down-scaled by a second mechanism: `scale` is one number for the whole renderer, which
  keeps the touch-target math exact.
- Full-bleed background, centred content. The gradient backdrop is stretched over the
  live stage and its hills/clouds are painted at fractions of the live stage, so the
  decoration reaches the screen edges; panels keep their authored content width (Wordbook
  980, Reward 800) centred on the island.
- Edge-anchored surfaces (header icon buttons, Wordbook pager arrows and Back,
  confetti bounds, floating tiles) use `anchorX()` against the LIVE stage edges, not the
  1280 constant, so nothing drifts inside the frame or clips on a wider stage.
- Resize handling is coalesced to one layout pass per animation frame
  (`src/ui/frameCoalesce.ts`) and only repositions/camera-zooms existing objects, so the
  procedural atlas is never rebuilt by a resize.
- Portrait phones (and landscape windows below the floor) are gated: `viewportFit()`
  reports 'rotate' / 'too-small' and the HTML overlay takes over, because no fixed design
  size can honour the 64 CSS px touch-target floor there. Under the full-bleed model the
  effective scale is still `min(vw/1280, vh/720)`, so the floor is `vh >= 360` CSS px on
  wide screens and `vw >= 640` CSS px on squarer ones.

## Hard Constraints
- 60 FPS on a 2GB-RAM Android (Unisoc/Helio A22 class). Single texture atlas for UI.
- Touch targets >= 64x64 CSS px.
- No console errors on load; `tsc -b && vite build` must pass clean.
- TypeScript strict mode ON. No `.jsx`/`.js` source files.
- All copy in English UI; `meaning_id` reserved for future Indonesian gloss.
