# SFX & game juice — evidence

Task: `t_dd11fd37` · Producer: eng-frontend · Date: 2026-10-28
Branch: `feat/sfx-game-juice` · Verified against a production build (`vite build`,
`vite preview` on port 2610) with the pre-change build (`main` @ `da02314`) served
side by side on port 2611 in the same browser.

## What was added

Five short clips in `public/assets/audio/sfx/` and a `playSfx(key)` path on
`AudioManager`, wired to the interactions that should feel like something:

| key | file | dur (s) | bitrate | fires when |
|---|---|---|---|---|
| `sfx/snap` | snap.mp3 | 0.131 | 156 kbps | a tile locks into a slot (`GameScene.placeTile`) |
| `sfx/bounce` | bounce.mp3 | 0.209 | 146 kbps | an invalid tile wobbles home (`GameScene.bounceHome`) |
| `sfx/chime` | chime.mp3 | 0.679 | 133 kbps | the word is solved (`GameScene.onSolved`) |
| `sfx/star` | star.mp3 | 0.549 | 135 kbps | the reward star scales up (`RewardScene.drawStar`) |
| `sfx/click` | click.mp3 | 0.078 | 175 kbps | a button press (`src/ui/kit.ts`) |

Total added payload: **28.6 KB** (whole asset pack 1.74 MB). Durations/bitrates read
from the files with `ffprobe`, not estimated.

## Three properties that make this *juice* and not just "more audio"

Each one is a defect if it regresses, and each is pinned by `tests/sfx.test.ts`:

1. **It never replaces speech.** A cue starts on its own `AudioBufferSourceNode`, so
   the chime plays *with* the solved word and the snap plays *with* the tile's
   phoneme. Measured in the built app (below): the third snap and the chime were
   requested in the **same millisecond**, and four separate sources started at
   t=11000 ms — snap + phoneme + chime + word, all live at once.
2. **It is never synthesised.** Web Speech saying "snap" is not a snap, so a missing
   or corrupt SFX file degrades to *silence*. Word/phoneme clips keep their speech
   fallback; SFX deliberately do not have one.
3. **It cannot be evicted.** The five buffers live in their own pool, outside the
   word/phoneme LRU (`MAX_CLIPS = 32`), so a 9-letter level's clips can never trade
   away the next click. `tests/sfx.test.ts` exercises this with `maxClips: 1`: three
   phonemes evict each other and no `sfx/*` clip is stopped.

Plus: the buffers are decoded at scene `create()` (`preloadSfx()`), so the first tile
drop of a session snaps with no fetch/decode gap. Mute stops playback and stops
queued cues; preparing is not gated on mute (28 KB), so the first click after
unmuting is instant.

## Audio trace (real interaction, built app)

`audio-trace.json` is the machine record of one full journey on the production
build: Play → one wrong drop → solve `SUN` → Reward. Probes hooked
`AudioManager.prototype.playSfx`, `AudioBufferSourceNode.start` and `fetch` before
the first tap.

```
sfx order      : click -> bounce -> snap -> snap -> snap + chime -> star
sources started: 13
speech fallback: 0
errors         : 0
sfx requested  : sfx/snap, sfx/bounce, sfx/chime, sfx/star, sfx/click   (all five)
```

Timeline highlights (ms):

```
  3435  sfx/click                        Play button
  5238  sfx/bounce  (starts 5238)        wrong drop, NO buzzer
  7607  sfx/snap    (2 starts @ 7608)    tile lock + its phoneme, overlapping
  9354  sfx/snap    (2 starts @ 9355)    second tile
 10999  sfx/snap + sfx/chime             third tile AND the solve chime
        (4 starts @ 11000)               snap + phoneme + chime + word together
 12381  sfx/star    (starts 12668)       Reward star reveal
```

`speech: 0` is the point: every cue and every phonics clip came from its MP3. Nothing
was synthesised, and nothing fell back — including the five SFX that a naive
implementation would have sent to Web Speech.

Every SFX URL appears once per scene creation (the pool is scene-scoped, exactly
like word/phoneme clips) and the browser serves the repeats from cache.

## Defect found and fixed while verifying: an AudioContext leak

Instrumenting `window.AudioContext` before boot and then driving 12 scene transitions
(4 × Play → Reward → Menu → Game) showed **38 contexts created, 0 closed** on `main`.
The cause predates this task: every scene builds its own `AudioManager`, each manager
lazily built its own context, and nothing ever closed one. This branch would have made
it worse (24 on a shorter count, because SFX also touches the engine).

Browsers cap concurrent `AudioContext`s per document, so a long session would
eventually start no audio at all — the classic "sometimes there is no sound" bug that
cannot be reproduced on demand.

Fix: one context per **document** (`sharedContextFactory`), borrowed by every engine;
`dispose()` closes only a context the engine itself built (the injected-factory path
tests use), so a scene teardown can never silence the next scene.
`WebAudioEngine.isSupported()` also became a constructor probe — it used to *build* a
context just to answer "is Web Audio available?".

Measured after the fix, same harness, same 12 transitions:

```
main    : 38 created / 0 closed
branch  :  2 created / 0 closed   (both at boot; 0 per transition)
```

`tests/audio.test.ts` gained a "one shared AudioContext per document" block: two
engines share one context, disposing a borrower closes nothing, an injected context is
still closed, `isSupported()` allocates nothing, and a menu-then-game manager pair hits
the same context.

## No visual or loading regression

Six captures, both builds, same browser, CDP `Page.captureScreenshot`. Three controls
so the comparison measures **layout**, not animation phase:

- `Math.random` seeded to a fixed PRNG before boot (Phaser's `Between()` drives the
  confetti and the tray shuffle);
- every scene tween added at `timeScale 0`, then paused before capture, with the
  target scene entered explicitly and the others stopped first — `game.scene.start`
  does NOT stop the previous scene, so "first active scene" is otherwise the wrong one
  (this is what made the first Reward capture look dirty);
- the two inherently non-reproducible animations pinned: Reward's confetti dots
  destroyed + its star pulse fixed at resting scale 1.95, and the Menu's five floating
  tiles fixed at their rest `y`.

Result — **byte-identical on every screen**:

```
01-menu.png         IDENTICAL (738,560 px)
02-game.png         IDENTICAL (738,560 px)
03-reward.png       IDENTICAL (738,560 px)
04-wordbook.png     IDENTICAL (738,560 px)

05-portrait-gate.png    IDENTICAL (860x1864,  DPR 2)  touch-target gate still fires
06-menu-dpr3-932x430.png IDENTICAL (2796x1290, DPR 3) phone landscape
```

The `*-baseline.png` files next to each capture are the `main` build's frames for the
same control method, so the pair can be re-diffed by hand.

Notes on how this was reached, because the first attempt was misleading: an
uncontrolled capture pair showed 39–52% of pixels differing on Menu/Game. That was
*entirely* tween phase — the Menu's five floating tiles bob on a 1400 ms yoyo that
starts at scene create, and Reward's confetti is spawned from `Math.random`. The
noise floor was measured directly: two captures of the **same** build under the naive
method differed by 1.03–1.06% (matching the "branch vs baseline" number), and zero
under the controlled method. Without freezing, a pixel diff on this game measures the
clock, not the change.

## Gates

```
eslint .            exit 0
prettier --check .  exit 0
tsc -b              exit 0
vitest run          19 files / 409 tests passed  (was 17 / 366;
                    +31 tests/sfx.test.ts, +7 tests/kitSfx.test.ts,
                    +5 in tests/audio.test.ts for the shared context)
vite build          exit 0  (dist built in ~13 s; sfx/*.mp3 copied into dist/assets/audio/sfx/)
```

`tests/sfx.test.ts` (31 tests) covers: the declared key set and the `isSfxKey` guard;
the files on disk (present, ID3 + MPEG frame sync, under 20 KB each); key → path
routing for all five; overlap (two sources, nothing stopped); mute (plays nothing,
still warms buffers, stops a running cue when muted mid-clip); graceful degradation
(missing file → silence and **never** `speechSynthesis.speak`, no re-request,
non-policy play failure → silence, policy block keeps the buffer, no engine, a
runtime-undeclared key never hits the network); pool isolation from the LRU;
`release()` clearing the SFX pool; `preloadSfx()` order/idempotence/subset/failure
memoisation; and a real `WebAudioEngine` case proving the word and the chime run as
two distinct live source nodes.

`tests/kitSfx.test.ts` (7 tests) pins the button wiring: one click per press, the
click fires **before** `onClick` (a navigating press would otherwise be cut off when
the next scene's `create()` releases the pool), no click on pointerdown/pointerout,
and a button built without `sfx` stays silent. The ordering assertion was verified to
bite: temporarily swapping the two calls in `makeButton` fails it.

## Files

| file | what it shows |
| --- | --- |
| `01-menu.png` … `04-wordbook.png` | branch build, controlled capture |
| `*-baseline.png` | `main` @ da02314, same control method |
| `05-portrait-gate.png` / `-baseline.png` | portrait touch-target gate |
| `06-menu-dpr3-932x430.png` / `-baseline.png` | phone landscape at DPR 3 |
| `audio-trace.json` | the SFX/audio timeline quoted above |
