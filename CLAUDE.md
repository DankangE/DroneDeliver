# DroneDeliver (Skyhook Depot)

First-person drone delivery game. Browser only, runs locally.

## Stack
- Three.js + Vite + TypeScript (strict). No backend, no API keys, no deploy config.
- All assets are procedural: geometry, canvas textures, WebAudio synth sounds. Keep it that way (or add freely licensed assets and credit them in README).

## Layout
- `src/config.ts` — stages, destinations, flight / score tuning, base layout.
- `src/sim.ts` — all game rules as pure state + `step(sim, input, dt)`; emits `SimEvent`s (notes, banners, sfx, log).
- `src/world.ts` — Three.js scene; reads `Sim`, never writes it.
- `src/hud.ts` — DOM HUD, console overlay, minimap.
- `src/main.ts` — screens, input, loop, `?debug=1` hook (`window.__game`).
- `scripts/playtest.mjs` — automated Chrome playtest (bot plays both stages, triggers events, saves `docs/screenshots/`).

## Commands
- `npm install`
- `npm run dev` — dev server on localhost (`PORT` env to change, default 5173)
- `npm run verify` — typecheck + production build (run before every PR)
- `npm run build && npm run preview` — serve the built game (`PREVIEW_PORT` or `PORT`, default 4173)
- `npm run playtest` — needs Google Chrome installed (or `CHROME_PATH`); `PLAYTEST_SPEED`, `PLAYTEST_ONLY=1|2`, `HEADED=1`

## Rules
- Tuning target: a normal base -> destination -> base round trip takes 30-40 s of game time. Re-measure with `npm run playtest` after changing `FLIGHT`, destinations or the drone state machine.
- Debug hook stays behind `?debug=1`.
