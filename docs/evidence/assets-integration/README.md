# Real asset pack integration — browser evidence

Task: `t_9c9c2749` · Producer: eng-frontend · Date: 2026-10-27
Branch: `feat/integrate-real-assets` · Build verified: production bundle (`vite preview`, port 2499)

## What was integrated

| Asset | Count | Source | Destination in repo |
|---|---|---|---|
| Illustrations (WebP, 512x512, transparent) | 30 | `wordbloc-assets/images/` | `public/assets/images/<category>/<word>.webp` |
| Word clips (MP3, -23 LUFS) | 30 | `wordbloc-assets/audio/words/` | `public/assets/audio/words/<word>.mp3` |
| Phoneme clips (MP3) | 50 | `wordbloc-assets/audio/phonemes/` | `public/assets/audio/phonemes/<phoneme>.mp3` |

Total payload: **1.9 MB** (40 KB illustrations max, 13 KB clips max). Vite copies
`public/` verbatim, so `dist/assets/` carries all 110 files (`find dist -name '*.webp' | wc -l` = 30,
`-name '*.mp3' | wc -l` = 80).

## Screenshots (all from the production build, not the dev server)

### 01 — Level 1 (CAT): the real sticker replaces the procedural placeholder
`01-level1-cat-illustration.png` · viewport 1280x720

The 512x512 cat WebP renders at 180x180 design px, centred on the content island
(x=640, y=210) inside a category-tinted halo. Screen-read state:

```
art: { key: 'art/animals/cat', visible: true, display: [180, 180], source: [512, 512] }
```

The band is square and bounded: header text block ends at y=114, the mechanic line
starts at y=305, and the sticker spans 120..300 — 6px and 5px of clearance
(`tests/layout.regression.test.ts`).

### 02 — Phoneme MP3 on tile placement
`02-phoneme-audio-on-placement.png` · viewport 1280x720

Dragging the C tile into slot 1 produced, in order:

```
audioPlays: ["assets/audio/phonemes/k.mp3"]
lastPlayed: { key: "phonemes/k", outcome: "file", url: "assets/audio/phonemes/k.mp3" }
```

`outcome: 'file'` means the recorded clip actually played — Web Speech was not used.

### Full CAT solve — audio routing
Completing the word drove this exact sequence (instrumented on the Web Audio engine):

```
words/cat.mp3      <- spoken on arrival (after the first gesture unlocked the context)
phonemes/k.mp3     <- tile 1
phonemes/ae.mp3    <- tile 2
phonemes/t.mp3     <- tile 3
words/cat.mp3      <- word completion
```

Each placement speaks the PHONEME, never a letter name (docs/SPEC.md "Phonics Rule").

### 03 — Wordbook: authentic thumbnail on an unlocked card
`03-wordbook-thumbnail.png` · viewport 1280x720

Card children, read from the live scene graph:

```
[card bg 292x128] [art well 96x96 @ x=-86] [art/animals/cat 88x88 @ x=-86, visible]
[text "cat" @ x=24, y=-24] [text "Tier 1 · animals" @ x=86, y=26, right-aligned]
[speaker bg 44x44 @ 116,34] [speaker icon @ 116,34]
```

The thumbnail is the REAL sticker (`art/animals/cat`), not a generic box.

### 05 — Wordbook: 9 staggered words, including every long one
`05-wordbook-full-page-thumbnails.png` · viewport 1280x720

Seeded with cat / butterfly / elephant / umbrella / sunflower / rainbow / pancake /
unhappy / rewrite. All 9 thumbnails resolved (`visible: true`, 88px each) and the
longest labels clear the replay speaker: the text column's right edge is *derived*
from the speaker circle (`wordbookTextRight() = speaker.x - radius - 8`), so the
clearance is structural rather than a glyph-width estimate.

### 06 — Tier 3 (BUTTERFLY): chunk mechanic with the real clue
`06-tier3-butterfly-chunks.png` · viewport 1280x720

`mechanic: syllable_tap`, tray `[FLY, TER, BET, BUT, BAT]`, slots `[BUT, TER, FLY]`,
pooled clips `[words/butterfly, phonemes/but, phonemes/ter, phonemes/fly]`.

### 07 — Phone landscape 932x430: no regression at the smallest supported viewport
`07-phone-landscape-level1.png` · viewport 932x430, DPR 2, mobile

Canvas rect equals the viewport rect (932x430) — no letterbox bars. The sticker
scales to 108 CSS px (zoom 0.597) and stays centred at screen (466, 125). Header,
instruction, hint, slots and tray all remain clear of each other.

### 08 — Tier 5 (REWRITE): affix mechanic, long riddle
`08-tier5-rewrite-affix.png` · viewport 932x430

Riddle line ("Riddle: to write it again. Put a prefix before WRITE.") fits on one
row above the slots; the `school/rewrite` sticker renders crisply.

### 04 — Reward: word audio replay
`04-reward-word-audio.png` · viewport 1280x720 (at 1280x577 during capture)

Star, "You built \"cat\"", wordbook count, Next/Replay/Wordbook. The Next button
overlapping the panel's bottom edge is PRE-EXISTING (same in
`docs/evidence/evidence-reward.png` from main) and out of scope for this task.

## Console cleanliness

A full tier-5 solve (open → both chunk placements → completion) produced **zero**
console errors, warnings, window errors and unhandled rejections:

```
{ "console": [] }
```

## Fallback behaviour verified live

A key with no file must degrade, never throw or hang:

```
playPhoneme('phonemes/zzz-does-not-exist')
  -> { outcome: 'speech', url: 'assets/audio/phonemes/zzz-does-not-exist.mp3' }
playWord('words/zzz-does-not-exist')
  -> { outcome: 'speech', url: 'assets/audio/words/zzz-does-not-exist.mp3' }
hasFailed(): [true, true]    <- no further network attempts for those keys
```

And the explicit silent key requests nothing at all (the pack has no `silent.mp3`,
so a request would be a guaranteed 404):

```
playPhoneme('phonemes/silent') -> { outcome: 'silent', url: '' }
```

## Two real defects found by this verification (not deferred)

1. **`HTMLMediaElement.play()` never settled in headless Chrome.** The first
   implementation streamed clips through `new Audio()`. Measured: the element sat at
   `readyState 0` indefinitely (`loadstart` → `stalled`, never `loadedmetadata`) and
   its `play()` promise stayed pending forever, so any `await` on it hung. The same
   bytes decoded fine through Web Audio (`decodeAudioData`, 0.367 s). Engine order was
   therefore inverted: **Web Audio primary, media element fallback**, and the media
   fallback now races `play()` against `START_TIMEOUT_MS`.

2. **`AudioContext.resume()` never settled without a user gesture.** With the Web
   Audio engine in place, a suspended context (every cold session) left `resume()`
   pending indefinitely, which hung the play call. Fixed by bounding the resume with
   `RESUME_TIMEOUT_MS`, re-reading `context.state` afterwards, and reporting
   `NotAllowedError` (a policy block — silent, no speech, file NOT marked broken) when
   it never reached `'running'`. Scenes now call `audio.unlock()` from the first
   pointerdown, and `GameScene` re-speaks the arrival word once unlocked if the
   pre-gesture attempt was swallowed.

Both have regression tests (`tests/audio.test.ts`: "does not HANG when resume() never
settles", "does not hang on a stalled play()").

## Gates

```
eslint .                 exit 0
prettier --check .       exit 0
tsc -b                   exit 0
vitest run               304 tests / 16 files, all passing
vite build               exit 0, 30 webp + 80 mp3 in dist/assets/
```
