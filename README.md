# WordBloc

Susun kata, buka dunia. Kids English word-building game.

Web-first (Phaser 3 + Vite + TypeScript), portabel ke Android (Capacitor) dan Windows (Tauri).

## Status

- [x] Spec frozen — `docs/SPEC.md`
- [x] v1 scaffold + core loop (this milestone)
- [ ] Real 2D art pass
- [ ] Native audio pass (phonemes + words)
- [ ] Capacitor Android wrapper
- [ ] Tauri Windows build

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
    config.ts             Phaser config (AUTO renderer, Scale.FIT 1280x720)
    levelTypes.ts         frozen level contract types + LevelContractError
    levelLoader.ts        validating loader (readable throws)
    levels.ts             validated pack singleton + lookups
    puzzle.ts             pure core-loop rules (no Phaser) — unit tested
    progress.ts           unlock / resume rules
    wordbook.ts           localStorage persistence (graceful degradation)
    audio.ts              phonics playback facade (never crashes on a missing key)
    uiAtlas.ts            builds ONE procedural texture atlas at boot
    theme.ts              design tokens, layout bands, touch-target math
    rng.ts                seeded PRNG for stable tray shuffles
  scenes/                 Boot -> Menu -> Game -> Reward -> Wordbook
  ui/kit.ts               shared button / text / panel helpers
  data/levels.json        30 seeded levels
tests/                    vitest suites (loader, puzzle, data, audio, layout)
```

### Level data

Levels live in `src/data/levels.json` and are validated against the contract in
`docs/SPEC.md` at boot. An unknown `mechanic`, a missing `tiles`/`chunks` array,
or a tile set that cannot spell the word throws a `LevelContractError` naming the
offending level and field.

### Rendering & assets

All UI art is generated at boot into a single `ui` texture atlas
(`src/game/uiAtlas.ts`) — the game performs **zero** per-file image requests.
Real art replaces this atlas in a later milestone.

### Audio

`AudioManager` plays a decoded buffer when one exists for a key, and otherwise
degrades to silence (or the Web Speech API when available). A missing audio key
never throws. Placing a tile speaks the **phoneme**; completing a word speaks the
**whole word** — letter names are a defect per the spec.

### Touch targets

Design space is 1280x720 with `Scale.FIT`, so at the smallest supported viewport
(640x360, factor 0.5) every interactive element must be >= 128 design px to clear
the spec's 64x64 CSS px floor. Tiles and buttons are sized accordingly, and
`tests/theme.test.ts` + `tests/layout.regression.test.ts` enforce it.

## Docs

Read `docs/SPEC.md` before writing any code. It is the frozen contract; the
difficulty tiers, the level JSON shape, and the phonics rule are locked.
