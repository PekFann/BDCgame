# Breaking Demon's Contract — HTML5

Web version of the cooperative card game **Breaking Demon's Contract**.

## Features

- **Solo mode** — 1 human player with AI teammates (`/solo.html`)
- **TV + phones** — Host creates a room with QR codes; TV shows the board; phones hold private hands (`/host.html`, `/tv.html`, `/play.html`)
- **Core rules** — Action, Event, Diurnal Cycle decks; Possessed; Demon; Energy & Friendship

## Quick start

```bash
npm install
npm run dev
```

Open:

- Landing: http://localhost:5173/
- Solo: http://localhost:5173/solo.html
- Host: http://localhost:5173/host.html

The game server runs on **port 3000**. Vite proxies `/api` and `/ws` to it during development.

For LAN play (phones joining via QR), use your computer's LAN IP shown in the host page (server listens on `0.0.0.0`).

## Production

```bash
npm run build
npm start
```

Serves built client and API from port 3000.

## Project layout

- `data/cards.json` — Card definitions and effect IDs
- `data/dnc.json` — Diurnal Cycle phase configs
- `public/assets/` — Card PNG artwork
- `server/game/` — Authoritative game engine
- `client/` — Vite frontend pages

## Playing TV + phones

1. On the TV/laptop, open **Host TV Game** and note the QR codes.
2. Open **Open TV View** on the TV browser.
3. Each player scans their slot QR on their phone.
4. Host selects Possessed and player count, then **Start Game**.
5. Phones show hands; TV shows shared board state.

## Notes

- Heroes and Pilgrim Map are not included in v1.
- AI teammates use simple heuristics; check the action log on the board.
