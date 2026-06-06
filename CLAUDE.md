# Editorial Map Studio

A web-based cartography tool that renders clean, publication-style editorial maps.
Keep this project **light and simple**.

## Tech Stack
- **Vite + React + TypeScript**
- **MapLibre GL JS v5.24.0** — vector map renderer
- **Protomaps** — vector tiles via API (key: `0a52651ea40e292b`, CORS origins: localhost:5173 and :5176)
- **AWS Terrain Tiles** — hillshade/relief rendering

## Architecture

### Data Stores (command-pattern undo/redo)
All four stores follow the same pattern: snapshot-based undo/redo stack, `subscribe()` for React, `add/update/remove/getAll/undo/redo`.

- `src/annotations.ts` — **AnnotationStore** for text labels
- `src/shapes.ts` — **ShapeStore** for rectangles, ellipses, lines, polygons. Includes `StrokeStyle` type (`'solid' | 'dashed' | 'dotted'`). Shapes have a `rotation` field and vertices store the already-rotated coordinates.
- `src/markers.ts` — **MarkerStore** for map markers. Also exports `createMarkerIcons()` which generates 4 SDF icon ImageData objects (32x32 white-on-transparent) for MapLibre's `icon-color` support.
- `src/arrows.ts` — **ArrowStore** for freeform arrows. Uses `points: [number, number][]` array (first=start, last=end, middle=bend points). **Catmull-Rom spline** through all points for smooth curves. Key functions: `sampleSpline()`, `findClosestPointOnSpline()`, `arrowToFeatures()`. Arrowheads are filled polygon triangles sized at 8% of arrow length (min 0.008°). Shaft is trimmed to end at arrowhead midpoint; direction derived from shaft's last segment for perfect alignment.

### Arrow System (Freeform Bezier)
The arrow tool uses a **click-on-shaft-to-add-bend-points** UX (inspired by soccer tactics apps):
- Draw by click-dragging → creates a straight 2-point arrow
- Click anywhere on a selected arrow's shaft → inserts a new bend point at that location and immediately starts dragging it
- Drag any handle (start, end, or intermediate bend points) to reshape
- No mode toggle — arrows start straight and become curved when bend points are added
- **Catmull-Rom spline** passes through all points (intuitive — curve goes where you click)
- For 2 points: renders as a straight line. For 3+ points: samples the spline into 16 segments per span
- **Arrowhead alignment**: shaft is trimmed to end at the arrowhead midpoint (not the tip — avoids ugly curve bulging); arrowhead direction is derived from the shaft's last segment (not the spline tangent) so the triangle is always perfectly centered on the line
- **Arrowhead sizing**: 8% of arrow length with min 0.008° floor — proportional but never invisible
- `findClosestPointOnSpline()` finds which segment a shaft-click is closest to, for correct point insertion order

### Hit Testing
- Arrow shaft and CP handle hit tests use **bounding box with tolerance** (`hitBbox()` with 8px pad for shafts, 10px for handles) instead of single-pixel queries — thin lines (2px) are impossible to click otherwise
- `map.queryRenderedFeatures([[x-pad, y-pad], [x+pad, y+pad]], { layers })` pattern

### Tool System
- **ActiveTool** state lifted to `Sidebar.tsx` — ensures mutual exclusion between `text | marker | arrow | rectangle | ellipse | line | null`
- Each tool component receives `activeTool` and `setActiveTool` props
- **Spacebar hand tool** (`src/spacebar.ts`): global keydown/keyup tracker with `isSpaceHeld()` and `subscribeSpace()` — all tools check and yield to map panning
- **Cross-tool selection** (`src/crossSelect.ts`): clicking on an element from a different tool auto-switches to that tool and selects the element in one click. Each tool's mousedown checks `hitTestAllTools()` before falling through to empty-space behavior. On activation, each tool calls `consumePending()` to pick up the selection. Layer→tool mapping: annotation layers→'text', marker layer→'marker', arrow layers→'arrow', shape layers→'rectangle'
- **Text label auto-select**: when placing a new label, the default "Label" text is auto-selected (`onFocus → e.target.select()`) so users can immediately type without backspacing

### Shape Rotation
- Shapes use incremental delta rotation: slider tracks `rotation` state, computes `newRot - oldRot`, rotates vertices around centroid by delta using `rotateVertices()` from `shapes.ts`
- Vertices store the already-rotated coordinates; `rotation` field tracks the cumulative angle for the UI slider
- Rotation value restores correctly when reselecting a shape (`loadStyleFromShape` reads `shape.rotation`)

### MapLibre Gotchas
- **`line-dasharray` is NOT data-driven** in MapLibre — solved by splitting one stroke layer into 3 filtered layers (solid/dashed/dotted) for both shapes and arrows
- **SDF marker icons**: canvas-drawn white shapes added with `{ sdf: true }` enable `icon-color` data-driven coloring
- `MARKER_LAYER_ID = 'markers-symbol'`, `SHAPE_LAYER_IDS`, `ARROW_SHAFT_LAYER_IDS`, and `ARROW_CP_HANDLE_LAYER_ID` are exported from `MapView.tsx`
- **Tooltip conflict rule**: only the active tool manages the shared `.map-tooltip` DOM element; inactive tools must `return` early without touching it
- **Hit testing thin lines**: MapLibre's `queryRenderedFeatures` at a single pixel point misses thin (2px) lines — use bounding box queries with padding instead

## Key Files
- `src/App.tsx` — wires stores and passes to Sidebar
- `src/components/MapView.tsx` — map initialization, tile sources, all MapLibre layers (shapes, markers, arrows, annotations)
- `src/components/Sidebar.tsx` — ActiveTool type definition, tool layout and orchestration
- `src/components/DrawingTools.tsx` — text label tool (place, select, double-click edit, style)
- `src/components/ShapeTools.tsx` — rectangle/ellipse/line/polygon tool (draw, select, drag, style, rotation)
- `src/components/MarkerTools.tsx` — marker placement tool (place, select, drag, style)
- `src/components/ArrowTools.tsx` — freeform arrow tool (click-drag to draw, click-shaft to add bends, drag handles to reshape)
- `src/components/LayerToggles.tsx` — layer visibility toggles with sub-groups
- `src/annotations.ts` — text label data store with undo/redo
- `src/shapes.ts` — shape data store with undo/redo, geometry helpers (getCentroid, rotateVertices, translateVertices, makeRectVertices, makeEllipseVertices)
- `src/markers.ts` — marker data store with undo/redo, SDF icon generation
- `src/arrows.ts` — arrow data store with undo/redo, Catmull-Rom spline math, GeoJSON generation
- `src/crossSelect.ts` — cross-tool selection: `hitTestAllTools()`, `setPending()`, `consumePending()`
- `src/snap.ts` — Shift-key constraint helpers: `snapTo45()`, `snapSquare()`, `snapCircle()`. All functions correct for lng/lat distortion using `cos(latitude)` so shapes look correct on screen
- `src/spacebar.ts` — global spacebar state tracker
- `src/editorial-style.ts` — editorial color palette (Protomaps Flavor)
- `src/App.css` — all styling
- `src/scalebar.ts` — scale bar computation (metric/imperial/nautical unit systems, round-number snapping)
- `src/legend.ts` — legend entry data model (`LegendEntry`, `LegendSymbol`, `createLegendEntry`)
- `src/components/LegendBuilder.tsx` — sidebar legend builder UI (add/remove/reorder entries, symbol/color/opacity/stroke controls)
- `src/components/ExportTools.tsx` — all export logic (JPG, PNG, SVG, GeoJSON), title/subtitle overlay, scale bar, legend rendering
- `src/components/MapSettings.tsx` — (unused, can be deleted) was a sidebar projection control, replaced by GlobeControl in MapView

## Map Controls (top-right, MapLibre IControl pattern)
- **NavigationControl** — built-in zoom/compass. Compass icon replaced via DOM override after mount: custom SVG with monochrome needle (dark north, light south, wider/shorter triangles with gap) + rotation ring with arrow tips hinting drag-to-rotate. Tooltips added: compass = "Drag to rotate & tilt the map. Click to reset north."
- **GlobeControl** — custom toggle button with globe SVG icon. Switches between `map.setProjection({ type: 'mercator' })` and `map.setProjection({ type: 'globe' })`. Auto-tilts to 45° pitch on globe, resets to 0° on flat. Icon darkens (#333) when active, lighter (#888) when inactive.
- **Important**: MapLibre v5 `setProjection` takes an object `{ type: 'globe' }`, NOT a string.

## Completed Features
- [x] Editorial map styling
- [x] Layer toggles (water, roads, buildings, boundaries, parks, terrain, labels)
- [x] Label sub-toggles (neighborhoods, cities, states, countries, water, roads)
- [x] Hillshade terrain relief
- [x] **Text labels**: click-to-place, double-click-to-edit, bold/italic, rotation, background box, 7 colors
- [x] **Markers**: 4 shapes (circle, square, triangle, pin), 7 colors, size slider 0.5x-2x, drag-to-move
- [x] **Shapes**: rectangle, ellipse, line/polygon with stroke color, fill color, fill opacity, stroke width, solid/dashed/dotted, rotation slider (-180° to 180°)
- [x] **Freeform arrows**: click-drag to draw, click-shaft to add bend points, drag any handle to reshape, Catmull-Rom spline curves, fixed-size arrowheads, stroke color/width/dash styles
- [x] **Polygon drawing**: click to add points, Delete removes last point, right-click to finish, click first point to close
- [x] **Spacebar hand tool** (Photoshop-style) across all tools
- [x] **Deselect UX**: "Done" button AND click-empty-map to deselect — consistent across all tool types
- [x] **Keyboard shortcuts**: Ctrl+Z/Y undo/redo, Delete removes selected, Escape deselects, Ctrl+C/V copy/paste shapes (paste offsets by 0.005°)
- [x] **Alt+drag duplicate**: hold Alt while dragging a shape to create a duplicate and drag the copy, leaving the original in place
- [x] **Cross-tool selection**: click any element while a different tool is active → auto-switches tool and selects it in one click
- [x] **Text label auto-select**: new labels have "Label" pre-selected so you can type immediately
- [x] **Shift-constrain**: hold Shift while drawing for perfect squares, perfect circles, and 45°-snapped lines/arrows/polygon segments. Uses `cos(lat)` correction for visual accuracy. Live preview snaps while dragging.
- [x] **Tooltips**: all tools show modifier hints (Shift for square/circle/snap) in both the map overlay tooltip and sidebar hint bar
- [x] **Globe projection**: toggle button (top-right controls) switches between flat Mercator and globe view with auto-tilt. Sky/atmosphere configured with warm off-white (`#f0efeb` sky, `#e8e5de` horizon) so globe background isn't black in exports.
- [x] **Satellite imagery**: Esri World Imagery raster tiles (free, no API key). Toggle + opacity slider in Layer Toggles. Layer sits below hillshade and all vector layers. Slight desaturation (`raster-saturation: -0.3`) for editorial tone.
- [x] **Per-layer opacity**: every layer group has a chevron dropdown with an opacity slider (0–100%). Sets appropriate paint property per layer type (`fill-opacity`, `line-opacity`, `text-opacity`, `hillshade-exaggeration`, `raster-opacity`).

### Export System
- [x] **JPG export** — full canvas screenshot with all overlays composited (title, scale bar, legend)
- [x] **PNG export** — layered export: `map-background.png` (basemap only), `map-features.png` (shapes/arrows/markers on transparent), plus optional `map-title.png`, `map-scalebar.png`, `map-legend.png` as standalone transparent layers. All same canvas size for perfect stacking in Photoshop/Illustrator. Button shows dynamic file count (2–5 files).
- [x] **Title/subtitle overlay** — live preview on map viewport (DOM overlay, top of map). Playfair Display serif title + Inter sans-serif subtitle. Controls: left/center alignment toggle, title size slider (16–72px), subtitle size slider (10–48px). Composited onto JPG; separate transparent PNG for layered export.
- [x] **Scale bar** — toggle in Export section with unit selector (metric km/m, imperial mi/ft, nautical nmi). Live preview bottom-right on map, updates on zoom/pan. U-shaped bar with text halo. Round-number snapping per unit system. Composited onto JPG; separate transparent PNG for layered export.
- [x] **Legend builder** — manual legend (NOT auto-generated). Each entry: symbol (circle/square/triangle/pin/line), fill color (6 swatches), fill opacity, stroke width, stroke color, stroke opacity, text label. Reorder (↑↓) and delete per entry. Live preview bottom-left on map. Composited onto JPG; separate transparent PNG for layered export.
- [x] **SVG export** — raster basemap as embedded `<image>` (with `xlink:href` for Illustrator compat) + all features as vector SVG elements. Named groups: `basemap`, `features`, `title-overlay`, `scale-bar`, `legend` — each becomes a layer in Illustrator. All coordinates scaled by `devicePixelRatio`. No `rgba()` in SVG attributes (Illustrator renders them as black) — uses separate `fill`/`stroke` + `fill-opacity`/`stroke-opacity` instead.
- [x] **GeoJSON export** — dumps all features as a standard `FeatureCollection`. Shapes → Polygon/LineString, arrows → LineString (raw control points), markers → Point, annotations → Point. All properties (colors, sizes, styles) preserved in feature properties.

### Overlay State Architecture
- `OverlaySettings` interface in `App.tsx` holds title, subtitle, sizes, alignment, scale bar toggle, scale unit, all lifted to App level
- `LegendEntry[]` state also in App, passed down to Sidebar (LegendBuilder) and MapView (live preview)
- MapView renders DOM overlays (title band, scale bar, legend card) via props — these are `pointer-events: none` and don't interfere with map interaction
- ExportTools reads overlay settings + legend entries for compositing onto exports

### SVG Export Gotchas
- **No `rgba()` in SVG attributes** — Illustrator renders them as black. Always use `fill="#ffffff" fill-opacity="0.82"` instead of `fill="rgba(255,255,255,0.82)"`.
- **Use `xlink:href`** alongside `href` on `<image>` elements — Illustrator requires the xlink namespace.
- **Scale by `devicePixelRatio`** — `map.project()` returns CSS pixels but the canvas is at DPR resolution (e.g. 2x). All coordinates, stroke widths, font sizes must be multiplied by `window.devicePixelRatio`.
- Font warning in Illustrator ("Inter: An unknown problem occurred") is expected — dismiss it. Inter is a web font not installed locally.

### Export Attribution
- All exports (JPG, PNG background, SVG) include attribution text at bottom-right: "Esri, Maxar, Earthstar Geographics | Protomaps | OpenStreetMap"
- Drawn as a small semi-transparent white pill with grey text via `drawAttribution()` (canvas) or `<g id="attribution">` (SVG)
- Scale bar is nudged up 20px above the attribution box to avoid overlap
- JPG export composites onto `#f0efeb` background before converting (fixes black globe background since WebGL canvas may not capture sky/atmosphere)

### UI Notes
- Sidebar header: "Editorial Map Studio" / "CLEAN & SIMPLE MAPS"
- Sidebar footer: "By Anurag Papolu · I really want feedback" — feedback link (muted green `#6b9a7b`) opens Tally form at `https://tally.so/r/Ek6xeN` in new tab. Footer pinned to bottom with `margin-top: auto`.
- Legend colors: 6 swatches only (black, grey, white, red, green, blue) — matches marker palette
- Scale bar unit selector: km / mi / nmi toggle buttons with a thin separator line after nmi
- PNG export button shows dynamic file count based on active overlays
- Export section order: title input → subtitle input → alignment → title size → subtitle size → scale bar toggle/units → export buttons (18px gaps between sections)
- Layer Toggles: satellite at top with opacity slider, then all vector groups each with chevron dropdown containing opacity slider
- Default map center: Brooklyn, NYC (`[-73.95, 40.65]`, zoom 10)
- `MapSettings.tsx` exists but is unused (was replaced by GlobeControl in MapView) — can be deleted

### Globe Projection
- Sky/atmosphere: `sky-color: #f0efeb`, `horizon-color: #e8e5de`, `fog-color: #f0efeb` — warm off-white so globe background isn't black
- JPG export captures as PNG first, then composites onto `#f0efeb` fill before converting to JPEG (WebGL canvas doesn't always capture sky rendering)
- `setProjection({ type: 'globe' })` — NOT a string, must be an object

### Layer Order in MapView
1. Background + earth fill (protomaps slice 0–1)
2. Satellite imagery (raster, opacity 0 by default)
3. Hillshade terrain relief
4. All vector layers: parks, water, roads, buildings, boundaries, labels (protomaps slice 2+)
5. User-drawn features (shapes, arrows, markers, annotations)
6. DOM overlays: title band, scale bar, legend card (pointer-events: none)

### Per-Layer Opacity
- Every layer group has a chevron dropdown with an opacity slider (0–100%)
- Sets the appropriate paint property per layer type: `fill-opacity`, `line-opacity`, `text-opacity`, `hillshade-exaggeration` (scaled by 0.7), `raster-opacity`
- Satellite has its own dedicated opacity slider that appears when toggled on

## Tile Sources
- Vector tiles: Protomaps API — `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=0a52651ea40e292b` (sponsor required for commercial use)
- Terrain DEM: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
- Satellite: Esri World Imagery — `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (free, no API key, attribution required: "Esri, Maxar, Earthstar Geographics")

## Deployment Plan
- **Hosting**: Vercel (free tier, auto-deploys from GitHub, custom domain support, HTTPS)
- **Domain**: buy from Cloudflare Registrar (cheapest, at-cost). Ideas: `editorialmaps.com`, `mapstudio.app`
- **Steps**: push to GitHub → connect repo to Vercel → add custom domain → done
- **Future commercial**: sponsor Protomaps, consider self-hosting tiles on Cloudflare R2

### Shape Handle System
- [x] **Shape resize handles** — rectangles show 4 corner handles; dragging a corner resizes while the opposite corner stays fixed. Ellipses show 4 cardinal handles (N/S/E/W); dragging adjusts rx or ry while keeping center fixed. Both handle rotation correctly (unrotate → resize → re-rotate).
- [x] **Line endpoint dragging** — every vertex on a selected line shows a handle; drag any to reshape
- [x] **Polygon vertex dragging** — every vertex on a selected polygon shows a handle; drag any to reshape. Closing vertex auto-updates when first vertex is dragged.
- [x] **Cross-tool selection interference fix** — for rect/ellipse tools, cross-tool selection is deferred to mouseup (only fires when draw gesture was too small to produce a shape). This means drawing always takes priority over auto-selecting nearby foreign elements. Line tool unchanged (cross-tool only fires when no drawing in progress).
- Handle rendering: `shape-handles` GeoJSON source + circle layer in MapView. Handles sync via useEffect on selectedId/shapes changes. During drag (body or handle), handles update in real-time via direct source manipulation.
- Resize math: `resizeRectCorner()` and `resizeEllipseCardinal()` in `shapes.ts`. Rectangle uses vertex-group constraints (shared x/y groups) to maintain rectangular shape. Ellipse extracts center+radii from bounding box of unrotated vertices.

## Running
```
npm install
npm run dev
```
