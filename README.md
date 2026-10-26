# WordBloc

Susun kata, buka dunia. Kids English word-building game.

Web-first (Phaser 3 + Vite + TypeScript), portabel ke Android (Capacitor) dan Windows (Tauri).

## Status

- [x] Spec frozen — `docs/SPEC.md`
- [ ] v1 scaffold + core loop (in progress, PR workflow)
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

## Docs

Read `docs/SPEC.md` before writing any code. It is the frozen contract; the
difficulty tiers, the level JSON shape, and the phonics rule are locked.
