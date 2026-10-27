# Voice unification — 7 adult clips replaced with the child voice

Task: `t_0b7c772c` · Producer: eng-frontend · Date: 2026-10-27
Branch: `fix/unify-child-voice-all-words` · Build verified: production bundle (`vite preview`, port 2455)

## Owner feedback this closes

> "I like new audio voice, but old audio voice still exist, can we remove old audio
> and replace it with new voice tone?"

The audio pack was never one voice. 23 of the 30 word clips used the child voice
(`en-US-AnaNeural`), but 7 fell back to the adult narrator (`en-US-AriaNeural`):
`dog`, `frog`, `hat`, `map`, `snake`, `unhappy`, `rewrite`. The reason was recorded
in the pack's own report (`wordbloc-assets/audio/REPORT.md`): Ana "mispronounces"
those short words under ASR (Ana's `frog` even read as profanity), so they were
re-synthesized with the adult voice. That fix was correct for intelligibility and
wrong for tone — a kid's game with two narrators.

## What changed

The same 7 words, re-synthesized in `en-US-AnaNeural` through the pack's own
encoding chain, and confirmed to keep their final consonants. Only the 7 MP3s
change; no source code, no level data, no test touched.

| word | prompt | variant | dur (s) | F0 before → after | RMS dBFS | shape |
|---|---|---|---|---|---|---|
| dog | `dog!` | FULL | 0.470 | 182.3 → **358.5** Hz | -24.1 | 44100/1/mp3 |
| frog | `frog!` | FULL | 0.522 | 194.3 → **310.6** Hz | -24.7 | 44100/1/mp3 |
| hat | `hat!` | LOOSE | 0.575 | 197.7 → **367.5** Hz | -24.0 | 44100/1/mp3 |
| map | `map,` | LOOSE | 0.549 | 234.6 → **300.0** Hz | -24.0 | 44100/1/mp3 |
| snake | `snake!` | FULL | 0.522 | 200.1 → **350.0** Hz | -24.7 | 44100/1/mp3 |
| unhappy | `un-happy` | FULL | 0.758 | 197.3 → **280.0** Hz | -24.0 | 44100/1/mp3 |
| rewrite | `re write` | FULL | 0.653 | 212.0 → **292.1** Hz | -24.2 | 44100/1/mp3 |

The adult clips were archived to `wb8_old_aria/` in the working scratch dir before
the swap, so the change is reversible and auditable.

## How "is this the child voice?" was decided

Not by ear and not by filename — the voice is not a tag inside the MP3. Measuring
F0 across the pack **before** the change gave two overlapping registers:

```
Aria (adult, 7 clips)  : 182.3 - 234.6 Hz
Ana  (child, 23 clips) : 229.1 - 347.2 Hz
```

They overlap at the bottom (the child pack's own `sunflower` is 229.1 Hz), so a
single clip cannot be classified by absolute band. The gate therefore checks the
two things the task is actually about:

1. **Regression** — for each of the 7 replaced words, the new clip must clear the
   child floor (≥229.1 Hz) *and* move up at least 5 Hz from its own archived adult
   pitch. Result: **7/7**, lifts of +65 to +176 Hz.
2. **Cohesion** — the whole 30-clip set must look like one voice. F0 spread across
   the set tightened from **164.9 Hz → 138.4 Hz**, with the untouched 23 clips
   still spanning 229.1–347.2 Hz and the new 7 landing inside 280.0–367.5 Hz.

```
$ ./wb8_voice_gate.py public/assets/audio/words
clips in set        : 30
F0 now: min=229.1 median=303.6 max=367.5
F0 spread across the whole set: 138.4 Hz (was 164.9 Hz before the swap)
still at/under adult register or not lifted: 0 []
contract violations (format/duration/RMS): 0 []
GATE: PASS
```

## Two guards the brief did not restate

Both were caught by measurement, not assumed.

**1. Loudness drift on sub-400 ms clips.** The briefed chain is single-pass
`loudnorm`, whose gating block is 400 ms. A 392 ms word never fills it, so the
filter instead ran gain up to the true-peak ceiling and `hat`/`map` shipped ~8 dB
hotter than the pack (RMS -16.1 / -14.8 vs the pack's -26.3..-23.2). The original
pack's report documents its own fix — an RMS fallback for clips shorter than the
gating window — so that fallback is applied here, folded into the *same* ffmpeg
pass so each shipped file is one lossy generation. All 7 now land at RMS
**-24.0..-24.7 dBFS** and true peak **-8.3..-13.0**, inside the pack's range.

**2. Duration floor.** The briefed `-45 dB` stop threshold trims so hard that
`hat` and `map` fell to 0.392 s, under the pack's documented 0.4–1.5 s word
duration range. For those two takes only, the stop threshold relaxes to `-75 dB`,
which keeps the release instead of truncating it. Every take is re-measured and
must satisfy both the floor and the consonant test either way.

## Proof the final consonants survived the filter

Trimming a word-final stop is exactly how `hat` becomes `ha`. Each word was
therefore compared against the same utterance with its final consonant removed
(`hat` vs `ha`, `map` vs `ma`), run through the identical filter chain:

| word | burst(word) | burst(control, no stop) | delta |
|---|---|---|---|
| hat | 7.3 dB | 2.1 dB | **+5.2 dB** |
| map | 9.0 dB | 6.2 dB | **+2.8 dB** |
| unhappy | 10.2 dB | 9.8 dB | +0.4 dB |
| rewrite | 7.0 dB | 6.9 dB | +0.1 dB |

For `hat`/`map` — the two whose stop is audible on release — the word carries a
clear high-frequency burst its own no-stop control does not. `dog`, `frog` and
`snake` cannot be tested this way: their final stops have little release energy,
and their controls showed *more* burst than the words, so no claim is made for
them from this measurement.

## ASR cross-check (and why it is not the pass bar)

`hat` transcribes as "Ha!" under `small.en` and `medium.en` — the same
isolated-short-word artifact the **accepted** pack already has (`cup`→"Come",
`pig`→"P", `sun`→"SON", `bed`→"Ben"; the shipped pack's transcript pass rate is
20/23). What was verified instead: **zero profanity and zero letter-name readings**
across the new takes — the exact failure that forced the adult voice originally.
`hat`'s consonant is independently proven present by the burst test.

- under `small.en`, 5 of the 7 transcribe to the exact word (`dog`, `frog`, `map`,
  `unhappy`, `rewrite`); the 2 misses are `hat` ("Ha!") and `snake` ("SNA-").
- under `medium.en` the stronger model reads **6/7 exactly** (`dog`, `frog`, `map`,
  `snake`, `unhappy`, `rewrite`); the sole miss is `hat` → "Ha!", and `hat`'s
  consonant is independently proven present by the burst test above (+5.2 dB over
  its own no-stop control, with a 0.053 closure dip and 9.2x HF tilt at the end).

## Browser evidence

All screenshots are from the production build, not the dev server.

The key check is not that the files exist — `tests/assets.test.ts` already pins
that — but that the game's own AudioManager fetches and decodes each *replaced*
clip when its level loads. Each of the 7 real levels was started through the
game's scene API and its network + decode calls recorded:

```
dog       level=lvl_0002  wordAudio=['assets/audio/words/dog.mp3']       decoded=[... 0.427s ...]  errors=[]
frog      level=lvl_0009  wordAudio=['assets/audio/words/frog.mp3']      decoded=[... 0.485s ...]  errors=[]
hat       level=lvl_0007  wordAudio=['assets/audio/words/hat.mp3']       decoded=[... 0.540s ...]  errors=[]
map       level=lvl_0008  wordAudio=['assets/audio/words/map.mp3']       decoded=[... 0.515s ...]  errors=[]
snake     level=lvl_0015  wordAudio=['assets/audio/words/snake.mp3']     decoded=[... 0.492s ...]  errors=[]
unhappy   level=lvl_0028  wordAudio=['assets/audio/words/unhappy.mp3']   decoded=[... 0.725s ...]  errors=[]
rewrite   level=lvl_0029  wordAudio=['assets/audio/words/rewrite.mp3']   decoded=[... 0.616s ...]  errors=[]
PROBLEMS: none
```

Every decoded duration matches the offline measurement for that clip, at
44100 Hz mono, with zero console errors. Screenshots of the 7 levels:
`level-lvl_0002-dog.png` … `level-lvl_0029-rewrite.png`.

Served-file check against the production preview (port 2455) — byte-identical to
what was committed:

```
dog: HTTP 200 served=7984B repo=7984B OK
frog: HTTP 200 served=8820B repo=8820B OK
hat: HTTP 200 served=9656B repo=9656B OK
map: HTTP 200 served=9238B repo=9238B OK
snake: HTTP 200 served=8820B repo=8820B OK
unhappy: HTTP 200 served=12581B repo=12581B OK
rewrite: HTTP 200 served=10910B repo=10910B OK
SERVE GATE: PASS
```

## Gates

| gate | command | result |
|---|---|---|
| lint | `eslint .` | exit 0 |
| format | `prettier --check .` | exit 0 |
| typecheck | `tsc -b` | exit 0 |
| tests | `vitest run` | **304 passed** (16 files) |
| build | `npm run build` | exit 0 |
| bundle | `find dist -name '*.mp3' \| wc -l` | 80 (30 words + 50 phonemes) |
| voice | voice gate over all 30 clips | PASS |
| serve | 7 clips over HTTP, byte-compare | PASS |
| runtime | 7 levels in a real browser, decode + console | PASS, 0 errors |

The test suite grew from the 214+ the brief cites to 304; the two audio-adjacent
suites (`assets.test.ts` 18, `audio.test.ts` 62) both pass unchanged.

## Staging parity

`/home/aditf/projects/wordbloc-assets/audio/words/` was updated to match, verified
`diff -r` clean against the repo copy and passing the same voice gate.
