# WordBloc

Susun kata, buka dunia. Kids English word-building game.

Web-first (Phaser 3 + Vite + TypeScript), portabel ke Android (Capacitor) dan Windows (Tauri).

## Status

- [x] Spec frozen — `docs/SPEC.md`
- [x] v1 scaffold + core loop (this milestone)
- [x] Real 2D art pass — 30 WebP stickers in `public/assets/images/`
- [x] Native audio pass — 30 word + 50 phoneme MP3s in `public/assets/audio/`
- [ ] Capacitor Android wrapper
- [ ] Tauri Windows build

## Assets

The real asset pack lives in `public/`, so Vite copies it verbatim into `dist/`:

```
public/assets/
  images/<category>/<word>.webp    30 stickers, 512x512, transparent, <40 KB each
  audio/words/<word>.mp3           30 word clips, -23 LUFS normalised
  audio/phonemes/<phoneme>.mp3     50 phoneme clips (letter SOUND, not letter name)
  audio/sfx/<cue>.mp3              5 tactile SFX: snap, bounce, chime, star, click
```

Total payload is 1.9 MB. Source refs in the level JSON stay extension-free
(`"image": "animals/cat"`, `"audio_word": "words/cat"`) — `src/game/assets.ts` is the
single place that maps them to URLs (`imageUrl`, `audioUrl`, `textureKey`), so the pack
can be re-nested or moved behind a CDN by editing one file.

Loading rules:

- Illustrations load on demand, one file per level, deduped per scene
  (`src/game/art.ts`). A failed sticker keeps the tinted halo + word initial, so a
  broken image can never take a level down.
- Audio is Web Audio first (decode once, then `source.start()` is synchronous, so a
  tile speaks with no buffering gap), an `HTMLAudioElement` where Web Audio is
  missing, and Web Speech ONLY when the file itself failed. `phonemes/silent` has no
  file on purpose: it resolves to silence without a network request.
- Scenes call `audio.unlock()` from their first pointerdown, because browsers start an
  `AudioContext` suspended until a gesture.

### Game juice (SFX)

`AudioManager.playSfx(key)` plays one of five short cues, wired to the interactions
that should _feel_ like something:

| key          | file                   | when                                     |
| ------------ | ---------------------- | ---------------------------------------- |
| `sfx/snap`   | `audio/sfx/snap.mp3`   | a tile locks into a slot                 |
| `sfx/bounce` | `audio/sfx/bounce.mp3` | an invalid tile wobbles home (no buzzer) |
| `sfx/chime`  | `audio/sfx/chime.mp3`  | the word is solved                       |
| `sfx/star`   | `audio/sfx/star.mp3`   | the reward star scales up                |
| `sfx/click`  | `audio/sfx/click.mp3`  | a button press                           |

SFX are deliberately **not** the phonics path:

- **Never synthesised.** Web Speech saying "snap" is not a snap, so a missing SFX file
  degrades to silence instead of speech.
- **Overlapping.** Every cue starts on its own `AudioBufferSourceNode`, so the chime
  plays _with_ the solved word and the snap plays _with_ the tile's phoneme — neither
  cuts the other off.
- **Own pool, preloaded.** The five buffers are decoded at scene `create()` and kept
  outside the word/phoneme LRU, so a 9-letter level can never evict the next click.
- **Muted plays nothing.** A muted game starts no cue; the buffers are still decoded
  (28 KB) so the first click after unmuting is instant.

### One AudioContext per document

Every scene builds its own `AudioManager`, so the context must NOT be per manager.
It is created once per page (`sharedContextFactory`) and borrowed by every engine;
`dispose()` only closes a context the engine itself built (the injected-factory path
tests use). Measured on the built app: **main leaked 38 AudioContexts over 12
scene transitions; this branch creates 2 (both at boot) and 0 thereafter.** Nothing
closed them before, and browsers cap concurrent contexts per document — a long
session would eventually start no audio at all, which is exactly the "sometimes
there is no sound" bug that resists reproduction.

`sfx/snap`, `sfx/bounce`, `sfx/chime`, `sfx/star`, `sfx/click` are the only accepted
keys (`SfxKey`); anything else resolves to silence without a network request.

## Dev

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
```

Other scripts:

```bash
npm run lint          # ESLint flat config
npm run format        # Prettier --write
npm run format:check  # Prettier --check (CI gate)
npm run typecheck     # tsc -b
npm test              # vitest run
```

Set `PORT` to move the dev/preview server off the default port:

```bash
PORT=2610 npm run dev
```

## Architecture

```
src/
  main.ts                 entry — validates level data, boots Phaser
  game/
    config.ts             Phaser config (AUTO renderer, Scale.RESIZE full-bleed)
    levelTypes.ts         frozen level + manifest contract types, LevelContractError
    levelLoader.ts        validating parsers (readable throws)
    levels.ts             manifest lookups + lazy per-level loading + cache
    puzzle.ts             pure core-loop rules (no Phaser) — unit tested
    progress.ts           unlock / resume rules (manifest only)
    wordbook.ts           localStorage persistence (graceful degradation)
    audio.ts              phonics + SFX playback facade (never crashes on a missing key)
    uiAtlas.ts            builds ONE procedural texture atlas at boot
    theme.ts              design tokens, stage model, layout bands, touch-target math
    rng.ts                seeded PRNG for stable tray shuffles
  scenes/                 Boot -> Menu -> Game -> Reward -> Wordbook
  ui/kit.ts               shared button / text / panel helpers
  ui/stage.ts             camera + backdrop + edge anchoring for the live stage
  ui/frameCoalesce.ts     one layout pass per animation frame on resize bursts
  data/levels/
    manifest.json         index of all 30 levels (sync, lightweight)
    tier-1..tier-5/       one JSON per level -> one lazy JS chunk each
tests/                    vitest suites (loader, catalog, data, puzzle, audio, layout)
```

### Level data

Levels are modular: `src/data/levels/manifest.json` is a small synchronous index
(id, tier, word, display, meaning, category, mechanic, file) and the full puzzle
for each word lives in its own file under `src/data/levels/tier-N/`. Vite's
`import.meta.glob` maps every level file to a separate chunk, so `loadLevel(id)`
downloads exactly one puzzle and caches it; `preloadLevel(id)` warms the next one
during play. Menu, Progress and Wordbook read the manifest only.

Validation happens in two places: the manifest (plus "does every row have a
bundled file?") is checked at boot in `main.ts`, and each level file is validated
against the contract in `docs/SPEC.md` through `parseLevel()` the first time it is
loaded. An unknown `mechanic`, a missing `tiles`/`chunks` array, a tile set that
cannot spell the word, or a file that disagrees with its manifest row throws a
`LevelContractError` naming the offending level and field.

Adding a level is one new file plus one manifest row — nothing else re-downloads.

### Rendering & assets

All UI art is generated at boot into a single `ui` texture atlas
(`src/game/uiAtlas.ts`) — the game performs **zero** per-file image requests.
Real art replaces this atlas in a later milestone.

### Audio

`AudioManager` plays a decoded buffer when one exists for a key, and otherwise
degrades to silence (or the Web Speech API when available). A missing audio key
never throws. Placing a tile speaks the **phoneme**; completing a word speaks the
**whole word** — letter names are a defect per the spec.

Game juice adds five tactile cues on the same manager (`playSfx`): a wooden snap when
a tile locks, a rubbery boing when it wobbles home (never a buzzer), a chime on a
solved word, a star ping on the reward reveal, and a soft click on buttons. They run
on their own source nodes so a cue overlaps the speech it accompanies instead of
cutting it off, are preloaded per scene, and live outside the word/phoneme LRU so a
long level cannot evict them. A missing SFX file is silence — never a synthesised
"snap".

### Stage & touch targets

`Scale.RESIZE` sizes the canvas to `#game` (the viewport), so the canvas rect always
equals the viewport rect and there is never a letterbox bar. Content is authored against
a 1280x720 design _island_; the main camera zooms by the stage scale and centres on it
(`src/ui/stage.ts`), and the live stage grows in width (aspect > 16:9, phones) or height
(aspect < 16:9, tablets) so the screen is filled edge to edge. `stageMetrics()`
(`src/game/theme.ts`) is the single source of truth for that geometry; the full model is
in `docs/SPEC.md`.

The effective scale is still `min(vw/1280, vh/720)`, so at the smallest supported
viewport (640x360 landscape, factor 0.5) every interactive element must be >= 128 design
px to clear the spec's 64x64 CSS px floor. Tiles and buttons are sized accordingly, and
`tests/theme.test.ts`, `tests/layout.regression.test.ts`,
`tests/wordbookLayout.regression.test.ts` and `tests/stage.test.ts` enforce it across
932x430 / 915x412 / 1280x720 / 1180x820 / 1024x768.

Below factor 0.5 no fixed design size can satisfy the floor — a portrait phone renders the
same tile at 36-41 CSS px. Rather than serve un-tappable controls, `viewportFit()`
(`src/game/theme.ts`) + `src/ui/viewportGate.ts` replace the playable stage with a
readable overlay asking the player to rotate (portrait) or enlarge the window (below
`vh >= 360` on wide screens, `vw >= 640` on squarer ones). `tests/viewportGate.test.ts`
pins the boundary.

Resize bursts collapse into one layout pass per animation frame
(`src/ui/frameCoalesce.ts`) and only move existing objects, so the procedural atlas is
never rebuilt by a resize.

### Phonics data invariant

`audio_phonemes` must contain exactly **one key per slot** — one per letter for
`letter_drag`, one per chunk otherwise. The loader throws a `LevelContractError`
otherwise, so a sound can never shift onto its neighbour. Digraphs spanning two
letter positions carry the same key twice (`HOUSE` = `h ow ow s silent`), and a
letter that makes no sound uses the explicit `phonemes/silent` key.

## Docs

Read `docs/SPEC.md` before writing any code. It is the frozen contract; the
difficulty tiers, the level JSON shape, and the phonics rule are locked.
