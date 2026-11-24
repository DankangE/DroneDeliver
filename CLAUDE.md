# DroneDeliver (하늘길 택배)

First-person drone delivery game. Browser only, runs locally. All player-facing text is Korean; code identifiers stay English.

## Stack
- Three.js + Vite + TypeScript (strict). No backend, no API keys, no deploy config.
- Optional nalidagame.online login / progress / leaderboard behind the build flag `VITE_NG_PLATFORM=1` (`src/platform.ts`, README "nalidagame.online"). Flag off must stay free of that code and of network calls: keep every call site behind `PLATFORM` so Vite folds it away. Nicknames and other API fields reach the DOM through `textContent` only.
- Geometry, canvas textures and WebAudio sounds are procedural. Bundled files (HDRI, PBR textures) are CC0 only, in `public/assets/`, and credited in `public/assets/ASSETS.md`.

## Layout
- `src/config.ts` — stages, destinations, flight / score tuning, base layout.
- `src/sim.ts` — all game rules as pure state + `step(sim, input, dt)`; emits `SimEvent`s (notes, banners, sfx, log).
- `src/world.ts` — Three.js scene; reads `Sim`, never writes it.
- `src/graphics/` — render pipeline + post (`pipeline.ts`, `post/`), material library (`materials.ts`, `materials/`), drone, depot, crates, terrain, city, destinations.
- `src/hud.ts` — DOM HUD, console overlay, minimap.
- `src/main.ts` — screens, input, loop, `?debug=1` hook (`window.__game`).
- `scripts/playtest.mjs` — automated Chrome playtest (bot plays all four stages, triggers events, saves `docs/screenshots/`).
- `src/platform.ts` — nalidagame.online gate, progress, plays and leaderboard (flag on only); `scripts/platform-e2e.mjs` checks it against a local NalidaGame API.

## Commands
- `npm install`
- `npm run dev` — dev server on localhost (`PORT` env to change, default 5173)
- `npm run verify` — typecheck + production build (run before every PR)
- `npm run build && npm run preview` — serve the built game (`PREVIEW_PORT` or `PORT`, default 4173)
- `npm run playtest` — needs Google Chrome installed (or `CHROME_PATH`); `PLAYTEST_SPEED`, `PLAYTEST_ONLY=1|2|3|4`, `PLAYTEST_FULL=1`, `HEADED=1`, `PLAYTEST_GL=swiftshader`
- `NG_API=http://localhost:8790 npm run e2e:platform` — flag-on end-to-end check; local API only (creates throwaway accounts)

## Rules
- Tuning target: a normal base -> destination -> base round trip takes 30-40 s of game time. Re-measure with `npm run playtest` after changing `FLIGHT`, destinations or the drone state machine.
- Destinations have a `kind` (`ground` / `roof` / `balcony`) and a surface height `y`; hold altitude, drop judging and the winch all read them. A stage lists its stops in `StageDef.destinations`.
- Debug hook stays behind `?debug=1`.
