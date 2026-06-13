# FLUXFRONT

A real-time fluid-defense strategy game (inspired by Creeper World 3). Contain the
**Flux**, hunt the **Emitters**. Vanilla JavaScript + Canvas 2D, **zero dependencies,
no build step.**

## ▶ Play

**[Play in your browser](https://imodhish.github.io/fluxfront/)** — works on desktop, tablet and mobile.

## Running locally

The game uses ES modules, which browsers won't load from `file://`, so serve it over HTTP:

```bash
python -m http.server 8000
# then open http://localhost:8000/
```

No Python? A zero-dependency Node server is included:

```bash
node tools/serve.mjs 8000
# then open http://localhost:8000/
```

## What's in here

- `index.html` — entry point (markup + CSS)
- `src/` — ES modules: `constants`, `state`, `world`, `sim`, `net`, `economy`,
  `render`, `ui`, `audio`, `music`, `storage`
- `tools/verify-split.mjs` — `node` harness asserting sim determinism + invariants
- `fluxfront.html` — original single-file prototype (historical snapshot)

## How to play

Deploy your **Command Core** on flat ground away from the red Emitters, then build a
network of Collectors and Relays to ship energy packets to your structures. Hold the
Flux back with Cannons and Mortars, reshape the land with Terps, and charge a
**Nullifier** next to every Emitter to win. Press **H** in-game for the field manual.

Built with [Claude Code](https://claude.com/claude-code).
