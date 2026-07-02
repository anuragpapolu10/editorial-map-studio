# Editorial Map Studio

A web-based cartography tool that renders clean, publication-style editorial maps.
Keep this project **light and simple**.

**Live:** [editorialmapstudio.com](https://editorialmapstudio.com)
**Repo:** [github.com/anuragpapolu10/editorial-map-studio](https://github.com/anuragpapolu10/editorial-map-studio)

## Tech Stack
- **Vite + React + TypeScript**
- **react-colorful** — lightweight color picker component (~2KB)
- **MapLibre GL JS v5.24.0** — vector map renderer
- **Protomaps** — vector tiles via API (key: `0a52651ea40e292b`, CORS origins: localhost, editorialmapstudio.com, editorial-map-studio.vercel.app)
- **AWS Terrain Tiles** — hillshade/relief rendering
- **Deployed on Vercel** — auto-deploys from GitHub on push to master
- **Domain**: `editorialmapstudio.com` via Cloudflare Registrar (WHOIS privacy included by default). DNS: A record → `76.76.21.21`, CNAME www → `cname.vercel-dns.com`, both proxy OFF (DNS only) so Vercel can issue SSL.

## Architecture

### Data Stores (command-pattern undo/redo)
All four stores follow the same pattern: snapshot-based undo/redo stack, `subscribe()` for React, `add/update/remove/getAll/undo/redo`.

- `src/annotations.ts` — **AnnotationStore** for text labels
- `src/shapes.ts` — **ShapeStore** for rectangles, ellipses, lines, polygons. Includes `StrokeStyle` type (`'solid' | 'dashed' | 'dotted'`). Shapes have a `rotation` field and vertices store the already-rotated coordinates.
- `src/markers.ts` — **MarkerStore** for map markers. Also exports `createMarkerIcons()` which generates 4 SDF icon ImageData objects (32x32 white-on-transparent) for MapLibre's `icon-color` support.
- `src/arrows.ts` — **ArrowStore** for freeform arrows. Uses `points: [number, number][]` array (first=start, last=end, middle=bend points). **Catmull-Rom spline** through all points for smooth curves. Key functions: `sampleSpline()`, `findClosestPointOnSpline()`, `arrowToFeatures()`. Arrowheads are filled polygon triangles sized at `arrowLen * 0.08 * headScale`. Shaft is trimmed to end at arrowhead midpoint; direction derived from shaft's last segment for perfect alignment. Supports `bidirectional` (arrowheads on both ends) and `headScale` (0.2x–3x multiplier).

### Arrow System (Freeform Bezier)
The arrow tool uses a **click-on-shaft-to-add-bend-points** UX (inspired by soccer tactics apps):
- Draw by click-dragging → creates a straight 2-point arrow
- Click anywhere on a selected arrow's shaft → inserts a new bend point at that location and immediately starts dragging it
- Drag any handle (start, end, or intermediate bend points) to reshape
- No mode toggle — arrows start straight and become curved when bend points are added
- **Catmull-Rom spline** passes through all points (intuitive — curve goes where you click)
- For 2 points: renders as a straight line. For 3+ points: samples the spline into 16 segments per span
- **Arrowhead alignment**: shaft is trimmed to end at the arrowhead midpoint (not the tip — avoids ugly curve bulging); arrowhead direction is derived from the shaft's last segment (not the spline tangent) so the triangle is always perfectly centered on the line
- **Arrowhead sizing**: `arrowLen * 0.08 * headScale` — purely proportional to arrow length, no absolute minimum (was `Math.max(arrowLen * 0.08, 0.008)` but that caused giant arrowheads at street-level zoom)
- **Bidirectional**: optional second arrowhead at the start point, toggle in the UI
- **Head scale slider**: 0.2x to 3x, default 1x
- `findClosestPointOnSpline()` finds which segment a shaft-click is closest to, for correct point insertion order

### Hit Testing
- Arrow shaft and CP handle hit tests use **bounding box with tolerance** (`hitBbox()` with 8px pad for shafts, 10px for handles) instead of single-pixel queries — thin lines (2px) are impossible to click otherwise
- `map.queryRenderedFeatures([[x-pad, y-pad], [x+pad, y+pad]], { layers })` pattern

### Tool System
- **ActiveTool** state lifted to `Sidebar.tsx` — ensures mutual exclusion between `text | marker | arrow | rectangle | ellipse | line | null`
- Each tool component receives `activeTool` and `setActiveTool` props
- **Keyboard handlers MUST guard with `if (!active) return`** — otherwise copy/paste and undo/redo fire across tools simultaneously
- **Spacebar hand tool** (`src/spacebar.ts`): global keydown/keyup tracker with `isSpaceHeld()` and `subscribeSpace()` — all tools check and yield to map panning
- **Cross-tool selection** (`src/crossSelect.ts`): clicking on an element from a different tool auto-switches to that tool and selects the element in one click. Each tool's mousedown checks `hitTestAllTools()` before falling through to empty-space behavior. On activation, each tool calls `consumePending()` to pick up the selection. Layer→tool mapping: annotation layers→'text', marker layer→'marker', arrow layers→'arrow', shape layers→'rectangle'
- **Text label auto-select**: when placing a new label, the default "Label" text is auto-selected (`onFocus → e.target.select()`) so users can immediately type without backspacing
- **Copy/paste** (Ctrl+C / Ctrl+V): all four tools support copying the selected element and pasting with a 0.005° offset. Each tool has its own `clipboardRef`.
- **Alt+drag duplicate**: all four tools support hold Alt while dragging to create a duplicate and drag the copy, leaving the original in place.

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
- **Globe sky disappears on canvas resize**: MapLibre v5 has a bug where the sky/atmosphere doesn't re-render after `map.resize()`. Workaround: never resize the map canvas for aspect ratio framing — use overlay letterbox bars instead (see Aspect Ratio section).

## Key Files
- `src/App.tsx` — wires stores, aspect ratio state, letterbox bar computation, passes to Sidebar and MapView
- `src/components/MapView.tsx` — map initialization, tile sources, all MapLibre layers (shapes, markers, arrows, annotations), compass/scale bar/legend live previews, inset minimap (second MapLibre instance with viewport indicator)
- `src/components/Sidebar.tsx` — ActiveTool type definition, tool layout and orchestration
- `src/components/DrawingTools.tsx` — text label tool (place, select, double-click edit, style, copy/paste, alt+drag duplicate)
- `src/components/ShapeTools.tsx` — rectangle/ellipse/line/polygon tool (draw, select, drag, style, rotation, copy/paste, alt+drag duplicate)
- `src/components/MarkerTools.tsx` — marker placement tool (place, select, drag, style, copy/paste, alt+drag duplicate)
- `src/components/ArrowTools.tsx` — freeform arrow tool (click-drag to draw, click-shaft to add bends, drag handles to reshape, bidirectional toggle, head scale slider, copy/paste, alt+drag duplicate)
- `src/components/SearchBar.tsx` — place search (Photon geocoder), temporary pin with dismiss, "Add boundary" button (fetches polygon from Nominatim and adds to ShapeStore)
- `src/components/LayerToggles.tsx` — layer visibility toggles with sub-groups
- `src/components/ExportTools.tsx` — all export logic (JPG, PNG, SVG, GeoJSON), title/subtitle overlay, scale bar, compass, legend, inset minimap rendering, aspect ratio crop, DPR scaling, Save As dialog
- `src/components/ColorPickerPopover.tsx` — reusable custom color picker popover using react-colorful (HexColorPicker + hex text input, fixed positioning to escape sidebar overflow)
- `src/components/LegendBuilder.tsx` — sidebar legend builder UI
- `src/annotations.ts` — text label data store with undo/redo
- `src/shapes.ts` — shape data store with undo/redo, geometry helpers (getCentroid, rotateVertices, translateVertices, makeRectVertices, makeEllipseVertices)
- `src/markers.ts` — marker data store with undo/redo, SDF icon generation
- `src/arrows.ts` — arrow data store with undo/redo, Catmull-Rom spline math, GeoJSON generation
- `src/dataStore.ts` — data tab state, CSV parsing, column auto-detection, geocoding (Nominatim), GeoJSON generation
- `src/components/DataTools.tsx` — data tab UI, MapLibre circle+symbol layer management, geocode flow, label repositioning
- `src/crossSelect.ts` — cross-tool selection: `hitTestAllTools()`, `setPending()`, `consumePending()`
- `src/snap.ts` — Shift-key constraint helpers: `snapTo45()`, `snapSquare()`, `snapCircle()`. All functions correct for lng/lat distortion using `cos(latitude)` so shapes look correct on screen
- `src/spacebar.ts` — global spacebar state tracker
- `src/editorial-style.ts` — editorial color palette (Protomaps Flavor). Island labels use `kind: "island"` from the `earth` source-layer, styled with `subplace_label` color in italic.
- `src/App.css` — all styling, including letterbox bar styles and CSS variable-based control repositioning
- `src/scalebar.ts` — scale bar computation (metric/imperial/nautical unit systems, round-number snapping)
- `src/legend.ts` — legend entry data model (`LegendEntry`, `LegendSymbol`, `createLegendEntry`)
- `src/components/MapSettings.tsx` — (unused, can be deleted) was a sidebar projection control, replaced by GlobeControl in MapView

## Map Controls (top-right, MapLibre IControl pattern)
- **NavigationControl** — built-in zoom/compass. Compass icon replaced via DOM override after mount: custom SVG with monochrome needle (dark north, light south, wider/shorter triangles with gap) + rotation ring with arrow tips hinting drag-to-rotate. Tooltips added: compass = "Drag to rotate & tilt the map. Click to reset north."
- **GlobeControl** — custom toggle button with globe SVG icon. Switches between `map.setProjection({ type: 'mercator' })` and `map.setProjection({ type: 'globe' })`. Auto-tilts to 45° pitch on globe, resets to 0° on flat. Icon darkens (#333) when active, lighter (#888) when inactive.
- **Important**: MapLibre v5 `setProjection` takes an object `{ type: 'globe' }`, NOT a string.

## Completed Features
- [x] Editorial map styling
- [x] Layer toggles (water, roads, buildings, boundaries, parks, terrain, labels)
- [x] Label sub-toggles (neighborhoods, cities, states, islands, countries, water, roads)
- [x] Hillshade terrain relief
- [x] **Text labels**: click-to-place, double-click-to-edit, bold/italic, rotation, background box, 7 colors, copy/paste, alt+drag duplicate
- [x] **Markers**: 4 shapes (circle, square, triangle, pin), 7 colors, size slider 0.5x-2x, drag-to-move, copy/paste, alt+drag duplicate
- [x] **Shapes**: rectangle, ellipse, line/polygon with stroke color, fill color, fill opacity, stroke width, solid/dashed/dotted, rotation slider (-180° to 180°), copy/paste, alt+drag duplicate
- [x] **Freeform arrows**: click-drag to draw, click-shaft to add bend points, drag any handle to reshape, Catmull-Rom spline curves, bidirectional toggle, arrowhead size slider (0.2x–3x), stroke color/width/dash styles, copy/paste, alt+drag duplicate
- [x] **Polygon drawing**: click to add points, Delete removes last point, right-click to finish, click first point to close
- [x] **Spacebar hand tool** (Photoshop-style) across all tools
- [x] **Deselect UX**: "Done" button AND click-empty-map to deselect — consistent across all tool types
- [x] **Keyboard shortcuts**: Ctrl+Z/Y undo/redo, Delete removes selected, Escape deselects, Ctrl+C/V copy/paste (all tools), all guarded by `if (!active)` to prevent cross-tool firing
- [x] **Alt+drag duplicate**: all tools — hold Alt while dragging to create a duplicate and drag the copy
- [x] **Cross-tool selection**: click any element while a different tool is active → auto-switches tool and selects it in one click
- [x] **Text label auto-select**: new labels have "Label" pre-selected so you can type immediately
- [x] **Shift-constrain**: hold Shift while drawing for perfect squares, perfect circles, and 45°-snapped lines/arrows/polygon segments. Uses `cos(lat)` correction for visual accuracy. Live preview snaps while dragging.
- [x] **Tooltips**: all tools show modifier hints and shortcuts. Selected-state tooltips emphasize "Click Done to deselect" prominently.
- [x] **Globe projection**: toggle button (top-right controls) switches between flat Mercator and globe view with auto-tilt. Sky/atmosphere configured with warm off-white (`#f0efeb` sky, `#e8e5de` horizon) so globe background isn't black in exports.
- [x] **Satellite imagery**: Esri World Imagery raster tiles (free, no API key). Toggle + opacity slider in Layer Toggles. Default opacity 20%. Layer sits below hillshade and all vector layers. Slight desaturation (`raster-saturation: -0.3`) for editorial tone.
- [x] **Per-layer opacity**: every layer group has a chevron dropdown with an opacity slider (0–100%). Sets appropriate paint property per layer type (`fill-opacity`, `line-opacity`, `text-opacity`, `hillshade-exaggeration`, `raster-opacity`).
- [x] **Search with pin**: searching for a place drops a temporary red pin with dismiss ×. Pin clears on next search or dismiss.
- [x] **Add boundary from search**: when a search result has an OSM boundary (cities, countries, states, parks), an "Add boundary" button appears on the pin. Clicking it fetches the polygon from Nominatim (`polygon_geojson=1`) and adds it to ShapeStore as a polygon. Handles MultiPolygon (multiple rings). Auto-switches to Line/Polygon tool with the shape selected for immediate styling.
- [x] **Custom color picker**: rainbow conic-gradient circle on all 7 color swatch rows. Opens a react-colorful HexColorPicker popover with hex text input. Uses `position: fixed` to escape sidebar overflow.

### Aspect Ratio Presets
- Presets: Free (no crop), 3:2 (landscape), 1:1 (square), 3:4 (portrait), 9:16 (phone/stories)
- **Implementation**: the map canvas stays full size always (never resized). Dark overlay bars (`#2a2a2a`, `z-index: 3`, `pointer-events: none`) are positioned absolutely over the edges to create the letterbox effect. This avoids a MapLibre v5 bug where globe sky disappears after `map.resize()`.
- CSS custom properties (`--bar-top`, `--bar-bottom`, `--bar-left`, `--bar-right`) are set on the `.map-area` div and used to offset all positioned elements: MapLibre controls (`.maplibregl-ctrl-*`), coords display, title overlay, scale bar, legend, and compass.
- Bar dimensions computed via `ResizeObserver` on the `.map-area` container.
- **Export**: `cropToAspectRatio()` in ExportTools.tsx crops the captured canvas to match the letterboxed area before compositing overlays. Applied to both JPG and PNG exports.

### Export System
- [x] **JPG export** — full canvas screenshot with all overlays composited (title, scale bar, compass, legend, attribution). Canvas captured as PNG first, composited onto `#f0efeb` background, then converted to JPEG.
- [x] **PNG export** — layered export: `map-background.png` (basemap only), `map-features.png` (shapes/arrows/markers on transparent), plus optional `map-title.png`, `map-scalebar.png`, `map-legend.png`, `map-inset.png` as standalone transparent layers. All same canvas size for perfect stacking in Photoshop/Illustrator. Button shows dynamic file count (2–6 files). Uses `map.once('idle')` for capture (not `render`) to ensure text/symbols are fully placed.
- [x] **Title/subtitle overlay** — live preview on map viewport (DOM overlay, top of map). Playfair Display serif title + Inter sans-serif subtitle. Controls: left/center alignment toggle, title size slider (16–72px), subtitle size slider (10–48px). Composited onto JPG; separate transparent PNG for layered export.
- [x] **Scale bar** — toggle in Export section with unit selector (metric km/m, imperial mi/ft, nautical nmi). Live preview bottom-right on map, updates on zoom/pan. U-shaped bar with text halo. Round-number snapping per unit system. Composited onto JPG; separate transparent PNG for layered export. **Bug fix**: `showScaleBar` added to effect dependency array so scale bar appears immediately on toggle (was only appearing after unit change).
- [x] **Compass / north arrow** — toggle in Export section. Live preview top-right on map. Compass rose with dark north pointer, light south pointer, center dot, "N" label. Rotates with map bearing. Rendered in JPG (canvas `drawCompass()`) and SVG (vector `<g id="compass">` with rotation transform) exports.
- [x] **Legend builder** — manual legend (NOT auto-generated). Each entry: symbol (circle/square/triangle/pin/line), fill color (6 swatches), fill opacity, stroke width, stroke color, stroke opacity, text label. Reorder (↑↓) and delete per entry. Live preview bottom-left on map. Composited onto JPG; separate transparent PNG for layered export.
- [x] **SVG export** — raster basemap as embedded `<image>` (with `xlink:href` for Illustrator compat) + all features as vector SVG elements. Named groups: `basemap`, `features`, `title-overlay`, `scale-bar`, `compass`, `legend` — each becomes a layer in Illustrator. All coordinates scaled by `devicePixelRatio`. No `rgba()` in SVG attributes (Illustrator renders them as black) — uses separate `fill`/`stroke` + `fill-opacity`/`stroke-opacity` instead. **Experimental**: text bg boxes don't render, font warnings in Illustrator, marker sizes may differ.
- [x] **GeoJSON export** — dumps all features as a standard `FeatureCollection`. Shapes → Polygon/LineString, arrows → LineString (sampled spline curve, not raw control points), markers → Point, annotations → Point. All properties (colors, sizes, styles) preserved in feature properties. **Experimental**: arrowheads, colors, fills, and text don't render in most GeoJSON viewers.
- [x] **Save As dialog** — uses File System Access API (`showSaveFilePicker`) for native Save As dialog on Chrome/Edge. Falls back to blob URL download on Firefox/Safari (handles large files reliably). User gesture may expire during long async export pipeline, in which case falls back to direct download gracefully. All export functions use `async downloadDataUrl()`.
- [x] **Export attribution** — "Editorial Map Studio | Esri, Maxar, Earthstar Geographics | Protomaps | OpenStreetMap" in bottom-right of all exports.
- [x] **DPR-aware export overlays** — all export drawing functions (title, subtitle, scale bar, compass, legend, attribution, inset minimap) scale by `window.devicePixelRatio` so overlays render at correct size on retina displays.
- [x] **Aspect ratio export cropping** — JPG and PNG exports crop the captured canvas to the selected aspect ratio (3:2, 1:1, 3:4, 9:16) before compositing overlays. PNG overlay layers (title, scale bar, legend, inset) are also rendered at the cropped dimensions.
- [x] **Inset minimap** — a second MapLibre GL instance positioned bottom-right above the scale bar. Shows the same editorial basemap zoomed out 5 levels, synced to main map center. Blue rectangle shows the main map's viewport bounds. Toggle in Export panel ("Inset map"), on by default. Requires `preserveDrawingBuffer: true` for export capture. Composited onto JPG exports; saved as separate `map-inset.png` in PNG export. Custom implementation (no plugin) using the same maplibre-gl instance to avoid version conflicts.

### Data Tab (Phase 1 — Points, Bubbles & Heatmaps)
- [x] **CSV paste import** — textarea, "Load data" button, "Clear data" with confirmation, "Try sample" pre-fills example CSV
- [x] **Column auto-detection** — auto-picks lat/lng/value/label columns from common names (lat, latitude, lng, longitude, value, count, population, name, city, county, etc.)
- [x] **Point visualization** — MapLibre circle layer with configurable color (custom color picker), size, opacity
- [x] **Bubble visualization** — proportional circles sized by value column, with min/max radius sliders
- [x] **Heatmap visualization** — MapLibre heatmap layer with configurable radius (5–100px), intensity (0.1–5.0, default 2.0), and opacity. Four color ramps: inferno, magma, plasma, viridis. Semi-transparent rgba colors at low density stops fade smoothly from transparent → warm/hot colors, avoiding stroke-like outlines. When a value column is selected, `heatmap-weight` is normalized from raw values to 0–1 range using `['interpolate', ['linear'], ..., min, 0, max, 1]` so different values produce visibly different-sized hotspots.
- [x] **Heatmap legend** — auto-generated gradient legend that appears in the regular legend overlay on the map. Shows editable title (defaults to value column name), a CSS gradient bar matching the selected color ramp, and min/max value range. Legend visibility is tied to heatmap mode — appears when heatmap is active with a value column, disappears when switching to points/bubbles. State flows via callback chain: DataTools → Sidebar → App → MapView.
- [x] **Labels & values** — toggle-able text labels and formatted values on each point. Uses MapLibre symbol layer with `text-radial-offset` for positioning. Click a label on the map to cycle its anchor position (top/right/bottom/left).
- [x] **Dynamic bubble label offset** — in bubble mode, `text-radial-offset` scales proportionally with bubble radius (`radius_px / label_size + 0.4`) so labels clear big bubbles without floating too far from small ones
- [x] **Value formatting** — commas toggle (1000 → 1,000), prefix input (e.g. "$", "£"), suffix input (e.g. " km²", "%"). Applied via pre-computed `formattedValue` in GeoJSON properties since MapLibre expressions can't do `toLocaleString`.
- [x] **Auto-geocoding** — when CSV has no lat/lng columns, prompts "Geocode using the {column} column?" with a "Narrow search" text field for region bias (e.g. "UK", "Brazil"). Uses Nominatim (OpenStreetMap) with 1.1s delays between requests. Deduplicates location names to minimize API calls. Shows progress bar during geocoding. Skipped rows shown with "invalid coordinates" badge.
- [x] **Zoom to data** — auto-fits map bounds after loading points or geocoding
- [x] **Row count indicator** — "10 points loaded" or "9 points loaded, 1 skipped" with details on skipped rows
- [x] **Tab preservation** — Drawing and Data tabs use `display: none` (not conditional rendering) so component state persists when switching tabs

Key files:
- `src/dataStore.ts` — DataState interface, CSV parsing, column auto-detection, `pointsToGeoJSON()`, `extractPoints()`, geocoding (`geocodeLocations()`, Nominatim API). Also exports `HeatmapLegendInfo` interface for legend data flow.
- `src/components/DataTools.tsx` — Data tab UI, MapLibre layer management (circle + heatmap + symbol layers), label click-to-reposition, geocode flow. Contains `HEATMAP_RAMPS` color definitions and `HEATMAP_LAYER_ID`. Reports legend info via `onHeatmapLegend` callback.
- `src/components/Sidebar.tsx` — Tab switching (Drawing/Data), ActiveTool management, passes `onHeatmapLegend` through to DataTools
- `src/components/MapView.tsx` — renders heatmap gradient legend in the legend overlay card using `HEATMAP_GRADIENTS` CSS gradients

### Overlay State Architecture
- `OverlaySettings` interface in `App.tsx` holds title, subtitle, sizes, alignment, scale bar toggle, scale unit, compass toggle, minimap toggle — all lifted to App level
- `AspectRatio` type: `null | '3:2' | '1:1' | '3:4' | '9:16'` — also in App.tsx with `RATIO_VALUES` lookup
- `LegendEntry[]` state also in App, passed down to Sidebar (LegendBuilder) and MapView (live preview)
- MapView renders DOM overlays (title band, scale bar, compass, legend card) via props — these are `pointer-events: none` and don't interfere with map interaction
- ExportTools reads overlay settings + legend entries for compositing onto exports

### SVG Export Gotchas
- **No `rgba()` in SVG attributes** — Illustrator renders them as black. Always use `fill="#ffffff" fill-opacity="0.82"` instead of `fill="rgba(255,255,255,0.82)"`.
- **Use `xlink:href`** alongside `href` on `<image>` elements — Illustrator requires the xlink namespace.
- **Scale by `devicePixelRatio`** — `map.project()` returns CSS pixels but the canvas is at DPR resolution (e.g. 2x). All coordinates, stroke widths, font sizes must be multiplied by `window.devicePixelRatio`.
- Font warning in Illustrator ("Inter: An unknown problem occurred") is expected — dismiss it. Inter is a web font not installed locally.

### Export Attribution
- All exports (JPG, PNG background, SVG) include attribution text at bottom-right: "Editorial Map Studio | Esri, Maxar, Earthstar Geographics | Protomaps | OpenStreetMap"
- Drawn as a small semi-transparent white pill with grey text via `drawAttribution()` (canvas) or `<g id="attribution">` (SVG)
- Scale bar is nudged up 20px above the attribution box to avoid overlap
- JPG export composites onto `#f0efeb` background before converting (fixes black globe background since WebGL canvas may not capture sky/atmosphere)

### UI Notes
- Sidebar header: "Editorial Map Studio" / "CLEAN & SIMPLE MAPS"
- Sidebar footer: "Designed by Anurag Papolu · Feedback · GitHub" — feedback link (muted green `#6b9a7b`) opens Tally form, GitHub link (purple `#8b5cf6`) opens [github.com/anuragpapolu10/editorial-map-studio](https://github.com/anuragpapolu10/editorial-map-studio)
- Favicon: folded map icon (tri-fold paper with red location dot) in editorial palette
- Legend colors: 6 swatches + custom color picker (rainbow circle) — matches marker palette
- **Custom color picker**: rainbow conic-gradient circle next to every color swatch row (7 locations across 5 files). Opens a `react-colorful` HexColorPicker popover with hex text input. Uses `position: fixed` + `getBoundingClientRect()` to escape sidebar's `overflow-y: auto`. Reusable `ColorPickerPopover` component.
- Scale bar unit selector: km / mi / nmi toggle buttons with a thin separator line after nmi
- PNG export button shows dynamic file count based on active overlays
- Export section order: aspect ratio presets → title input → subtitle input → alignment → title size → subtitle size → scale bar toggle/units → compass toggle → inset map toggle → export buttons → experimental section (SVG, GeoJSON with hover tooltips)
- Layer Toggles: satellite at top with opacity slider (default 20%), then all vector groups each with chevron dropdown containing opacity slider
- Default map center: Brooklyn, NYC (`[-73.95, 40.65]`, zoom 10)
- `MapSettings.tsx` exists but is unused (was replaced by GlobeControl in MapView) — can be deleted

### Globe Projection
- Sky/atmosphere: `sky-color: #f0efeb`, `horizon-color: #e8e5de`, `fog-color: #f0efeb` — warm off-white so globe background isn't black
- JPG export captures as PNG first, then composites onto `#f0efeb` fill before converting to JPEG (WebGL canvas doesn't always capture sky rendering)
- `setProjection({ type: 'globe' })` — NOT a string, must be an object
- **Do not call `map.resize()` when aspect ratio changes** — causes globe sky to disappear (MapLibre v5 bug). Use letterbox overlay bars instead.

### Layer Order in MapView
1. Background + earth fill (protomaps slice 0–1)
2. Satellite imagery (raster, opacity 0 by default)
3. Hillshade terrain relief
4. All vector layers: parks, water, roads, buildings, boundaries, labels (protomaps slice 2+)
5. User-drawn features (shapes, arrows, markers, annotations)
6. DOM overlays: title band, scale bar, compass, legend card (pointer-events: none)
7. Inset minimap (separate MapLibre instance, bottom-right, above scale bar)

### Per-Layer Opacity
- Every layer group has a chevron dropdown with an opacity slider (0–100%)
- Sets the appropriate paint property per layer type: `fill-opacity`, `line-opacity`, `text-opacity`, `hillshade-exaggeration` (scaled by 0.7), `raster-opacity`
- Satellite has its own dedicated opacity slider that appears when toggled on, default 20%

## Tile Sources
- Vector tiles: Protomaps API — `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=0a52651ea40e292b` (sponsor required for commercial use). **CORS origins must include the deployment domain** — add new domains at protomaps.com dashboard (no trailing slash).
- Terrain DEM: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
- Satellite: Esri World Imagery — `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (free, no API key, attribution required: "Esri, Maxar, Earthstar Geographics")

## Deployment
- **Hosting**: Vercel (free tier, auto-deploys from GitHub on push to master)
- **Domain**: `editorialmapstudio.com` via Cloudflare Registrar. DNS managed by Cloudflare (A record `76.76.21.21`, CNAME www `cname.vercel-dns.com`, proxy OFF). Old Vercel URL (`editorial-map-studio.vercel.app`) redirects to new domain.
- **Protomaps API key**: domain-restricted. When adding new deployment domains, add them to CORS origins at protomaps.com (no trailing slash).
- **Workflow**: make changes → let user test locally on `localhost:5173` → commit and push only when confirmed working.

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
Opens at `http://localhost:5173`.
