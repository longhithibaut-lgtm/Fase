# Fase

## Planet Works (factory game)

A small 2D automation game in Phaser 3 + TypeScript, built to run on an in-game computer
screen inside the Unity orbital station shop (through Vuplex 3D WebView).

Each site is a small plot on the planet with one product to make. Get the orbital elevator
receiving the target rate (per minute, over a 60 s window) and the site is **automated**: it
keeps shipping to the station in the background and the next site unlocks. Later sites can
receive earlier products by cargo drop.

```
npm install
npm run dev        # http://127.0.0.1:5173/   (?site=gears jumps ahead, ?demo=1 builds a reference factory)
npm test           # simulation tests
npm run typecheck
npm run build      # dist/ → copy to Unity Assets/StreamingAssets/factory/
```

- `src/sim/` — pure simulation, no Phaser: `defs.ts` (items, recipes, machines, speeds: balance here),
  `levels.ts` (one map per site: balance targets here), `world.ts` (one site), `campaign.ts` (progression, sales).
- `src/render/` — Phaser renderer and DOM HUD; all art is drawn procedurally in `textures.ts`.
- `src/bridge/` — JSON messages with the Unity shop, see `docs/unity-bridge.md`.
- `scripts/shot.mjs` — headless screenshot of the running game.

## Claude Code skills

### `gauntlet-loop`

Skill de [RoboNuggets](https://github.com/robonuggets/gauntlet-loop) installé dans `.claude/skills/gauntlet-loop/`. Il transforme un objectif en un prompt court qui oblige l'agent à se fixer une référence de qualité réelle, à découper le travail, à faire tourner des paires constructeur / critique sévère, à comparer à l'aveugle avec la référence, et à boucler jusqu'à ce que le résultat gagne.

```
/gauntlet-loop une page de tarifs pour mon SaaS
```

Technique de [Matt Shumer](https://github.com/mshumer), skill par Jay E (RoboNuggets), sous licence CC BY 4.0 — voir `.claude/skills/gauntlet-loop/NOTICE.md`.
