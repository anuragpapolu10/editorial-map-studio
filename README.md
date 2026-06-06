# Editorial Map Studio

A free, browser-based tool for making clean, simple maps — the kind you see in newspapers and magazines.

No account needed. No data leaves your browser. Just open it and start making maps.

## Why this exists

I'm Anurag Papolu. I'm a designer, not a developer. I work in newsrooms.

I've always admired the clean, beautiful maps you see in the New York Times — the restrained colors, the thoughtful typography, the way they make complex geography feel immediately readable. That style is what inspired me to build this. I wanted to make a tool that gives newsrooms and journalists access to that kind of cartographic quality without needing to hire technical people or learn GIS software. The tools that exist are either too complicated, too expensive, or designed for GIS professionals rather than storytellers.

I mostly have no idea what I'm doing on the code side, and I suspect a lot of it is needlessly complicated. But I tried to make informed decisions where I could. For example, I chose [Protomaps](https://protomaps.com/) for map tiles because they're open-source, fast, and don't lock you into a proprietary platform.

This was built almost entirely with [Claude Code](https://claude.ai/code) (Anthropic's AI coding tool). I described what I wanted, iterated on the design, and Claude wrote the code. It's a weird way to build software, but it worked.

## A note on good map practice

Whether you use the built-in tools or not, every map benefits from a few things:

- **A title** that explains what the map is showing. Don't make people guess.
- **A scale bar** so readers can judge distances. A map without a scale bar is just a shape.
- **A legend** if anything on the map isn't immediately obvious. Colors, symbols, and lines should be explained.

These aren't decorations — they're what separates a useful map from a confusing one.

## What it does

- **Basemap** — clean, publication-ready cartography with Protomaps vector tiles. Toggle satellite imagery, terrain relief, water, roads, buildings, boundaries, parks, and labels independently.
- **Text labels** — place, style, and rotate text annotations on the map. Bold, italic, font size, color, background toggle.
- **Markers** — drop pins, circles, squares, triangles, and diamonds with customizable color and size.
- **Arrows** — curved arrows with draggable bezier control points, adjustable stroke and arrowhead style.
- **Shapes** — rectangles, ellipses, lines, and polygons with stroke color/width/dash, fill color/opacity, and rotation. Drag corner/edge handles to resize, drag vertices to reshape.
- **Copy/paste & duplicate** — Ctrl+C/V to copy and paste shapes. Alt+drag to duplicate and place in one gesture.
- **Legend builder** — add labeled entries with customizable symbols and colors.
- **Title & subtitle** — overlay text with adjustable size and alignment.
- **Scale bar** — automatic scale bar in miles or kilometers.
- **Globe view** — toggle between flat Mercator and 3D globe projection.
- **Export** — save your map as PNG or SVG.
- **Undo/redo** — full undo/redo history for all drawing tools.
- **Keyboard shortcuts** — spacebar to pan, Shift for 45-degree snap, Delete to remove, Escape to deselect.

## Planned features

Based on feedback, I'm planning to add:

- **Inset maps** — small overview maps showing where the main map is located
- **More projections** — beyond Mercator and globe
- **More basemap styles** — different visual treatments for different story types

If you have ideas or feedback, I'd genuinely love to hear it — there's a feedback link in the app.

## Running locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Building for production

```bash
npm run build
```

Output goes to `dist/`. Deploy it anywhere that serves static files — Vercel, Netlify, Cloudflare Pages, or just a plain web server.

## How it's built

| What | Why |
|---|---|
| [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | UI framework and type safety |
| [Vite](https://vite.dev/) | Fast dev server and build tool |
| [MapLibre GL JS](https://maplibre.org/) | Open-source map rendering engine (fork of Mapbox GL) |
| [Protomaps](https://protomaps.com/) | Open-source vector tile basemap — no API key lock-in |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite imagery layer |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Elevation data for hillshading and 3D terrain |

Everything runs client-side. There is no backend, no database, no server. The "heavy lifting" — tile rendering, satellite imagery — comes from the tile providers listed above.

## License

MIT
