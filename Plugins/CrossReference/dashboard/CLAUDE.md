# CLAUDE.md

Guidance for working on this repository with Claude Code. Read README.md first for what the dashboard does; this file covers how it is built, the decisions behind it, and what is next.

The canonical development location is `Plugins/CrossReference/dashboard/` in
the ELD repository. The exporter is `../CrossReference.cpp`; commit producer,
schema and consumer changes together. This directory was imported from the
standalone `image_analysis` repository at `eec6d70` using Git subtree.
The exporter/consumer check is `../test/dashboard_test.py`, driven through
`tools/check-export.js`. See `../README.md` for CMake commands. No submodule,
npm packages, browser launch or screenshot capture is required for those checks.

## Context

- The target is a monolithic C/C++ firmware image built with clang and linked with **ELD** (Qualcomm's embedded linker, which has a C++ plugin API). The system is **RAM-only** (no ROM), several hundred MiB, with a few hundred subsystems delineated by the source hierarchy. About 20% of the pre-link input is removed by `--gc-sections`.
- The processor can store code and data **compressed in RAM**. Eligibility is decided by placing sections in specially named output sections. Exact compressed sizes are not known per section, so the dashboard uses one scale factor for code and one for data.
- The audience for the dashboard is partly high-level: views lead with a one-sentence takeaway computed from the data, and avoid jargon in visible copy.
- The CrossReference plugin defaults to columnar JSON, demangled names, DWARF symbol details, data initializer metadata and unary directory coalescing. Object JSON and text remain explicit options; gzip is optional. `../CrossReference.template.yaml` documents every option and provides a multiline configuration. It also exports final addresses/alignment, C++ scopes and optional build metadata; current ELD APIs provide evaluated regions and explicit symbol roots, with explicit options for older SDKs. The dashboard is developed against synthetic data and real exports; see docs/export-format.md for the shared schema.

## Commands

```sh
npm run build                      # src/* -> dist/image-anatomy.html
npm run check                      # node tools/check.js: format equivalence, planted stories, build-system paths, layout (~5 s)
npm run lint                       # optional ESLint check; run npm install once first
cmake --build /path/to/build-plugins --target check-crossreference-dashboard
node tools/check.js --sections 150000
node tools/gen-sample.js --sections 60000 [--format objects] [--no-gzip] [--no-details] [--out FILE]
node tools/build.js --d3 path/to/d3.min.js --out /tmp/x.html     # inline D3 for offline/headless use
python3 tools/browser_smoke.py [--d3 path/to/d3.min.js] [--screenshots DIR]   # needs Python Playwright
```

After changing `src/core.js`, run `npm run check`. For exporter/schema changes,
run the combined CMake check in a standalone build with `BUILD_TESTING=ON`.
Use lightweight Node analysis and build checks by default. Run focused
Playwright checks when actual browser behavior needs verification; use the
full desktop/mobile, light/dark smoke suite for broad UI changes. Capture or
review screenshots only when the user asks. Always rebuild `dist/` before
committing; regenerate `samples/sample-20k.columnar.json.gz`
(`node tools/gen-sample.js --sections 20000 --out samples/sample-20k.columnar.json.gz`)
when the generator changes.

## Architecture

Single self-contained HTML file. `tools/build.js` replaces the `/*CORE*/`, `/*RELATIONSHIPS*/` and `/*UI*/` markers in `src/page.html` with scripts (using function replacements so `$&` in the sources is not interpreted). It also inserts `src/explorer.js` at `/*EXPLORER*/` inside the UI closure. `src/relationships.js` provides the DOM-free model and is covered by `tools/check-relationships.js`.

### src/core.js (no DOM; also `require`-able from Node)

- `generateSample({symbols, seed, details})`: synthetic object-format export. Deterministic for a given seed (default 11). Sizes are rescaled at the end so the image is about 332 MiB regardless of section count. Node `path` is the **object path**; unless `details:false`, `sampleSymbolDetails` adds DWARF-style `symbolDetails` (one symbol per section, declaration files and lines, linkage names, symbol-level refs) with the **source paths**. Live sections also get link-time `addr` and `align`. See the planted stories below.
- Ingestion: `isColumnar`, `ingestClassic` (object format), `ingestColumnar` (columnar format v1). Both return `{nodes, S, D, W, m}`: internal node objects plus reference arrays. `makeNode` derives `file`, `dir`, `dom` (first directory) and `mod` (first two directories). `layoutField` validates the optional `addr` (-1 when unknown or eliminated) and `align` (0 when unknown). `ingestSymbolDetails` maps sections to a single source file and, with `pathMode:'source'`, rebuilds nodes from source paths (keeping `objectPath`). `toColumnar(objectDoc)` converts everything, including details and layout, for tools and tests.
- `analyze(data, {pathMode, excludeOutput})` returns the analysis object `A`. Pipeline:
  1. live-to-live forward adjacency `succ` (compressed sparse rows via `csr`), roots (flagged, else zero in-degree), dominators (`dominatorsCSR`, Cooper–Harvey–Kennedy with a virtual root at index `N`), retained raw size `ret`;
  2. directories `doms` and subsystems `mods` with per-kind byte totals (`k`: 8 slots, live kinds 0–3, eliminated kinds 4–7), subsystem matrix `mm` and directory matrix `dm` of live reference weights;
  3. undirected live graph `U` and `computeClusters(excludeMask)` (Louvain, seed 42). It **mutates** `mods[].cluster/per/perCode/share`; the UI calls it again to recluster with shared infrastructure hidden;
  4. startup plumbing mask `isPlumb` (roots, `main`, names ending `init`/`start`, anything retaining more than 20% of the image), `mmLayer` (subsystem matrix without plumbing-sourced references, used for layering), and `groupMetrics` for subsystems (`roleSub`) and directories (`roleDom`): breadth (share of other directories referencing it), interface sections and bytes, `privateShare`, cohesion, callers, uses, and the single non-plumbing owner from the dominator tree;
  5. misplaced files, fully dropped files, unused islands (union-find over eliminated-to-eliminated references), template families, `regions` (each `{name, start, size}`; `start` is null for size-only regions), `capacity`, `addressed` (live sections with an address), `communities(n, src, dst, w)` (deterministic Louvain over a small symmetric graph, used by the explorer), and `removalImpact(groupIndex, 'mod'|'dom')`, which returns the freed node list so the UI can re-sum it at stored size.

### src/ui.js

- Global `A` (analysis), `TREE` (directory/file/scope/section tree with per-node `k` totals; keys prefixed `f:`, `c:`, `s:` for files, scopes, sections), `C` (compression model), `state` (all view settings).
- `recomputeCompression()` builds `C` from `state.comp` and `state.whatIf`: per-section stored and projected sizes, per-subsystem and per-directory totals, tree aggregates (`st`, `pj`, `eg`, `cp`) and retained size at stored size. Call it after anything that changes compression settings or the selection, then `renderAll()`.
- `renderAll()` calls every view: `renderHero`, `renderTreemap`, `renderComp`, `renderInspector`, `renderDead`, `renderRetained`, `renderRoles` (+`renderBlobs`), `renderLayers`, `renderDSM` (canvas, `bindDSM`), `renderSankey`, `renderMisplaced`, `renderAddrMap`, `renderExplorer`. Views read `state.selected` (a subsystem name) to stay linked. A `ResizeObserver` on `#mainCol` re-renders the size-dependent views.
- Settings: `applySetting(k, v)` is the single path for `[data-set="key:value"]` buttons, selects and radios, so they behave identically (tree rebuilds, busy overlay, re-render). `syncControls` sets `aria-pressed`; `syncTreemapControls` mirrors state into the treemap's selects, radios and changed-structure dot.
- Measures: `stored` (default, compressed size), `live` (raw), `dead`, `pre` (linker input). `V(node, measure)` reads a tree node. Removal, retained and ownership figures use stored size.
- Loading: `readExport` sniffs gzip magic bytes and uses `DecompressionStream`, then `JSON.parse`, then validates either format; `load()` runs `analyze`, `buildTree`, resets settings from the export's `compression` block, and renders. Long steps go through the `busy()` overlay with `await tick()` so the overlay paints. The app opens directly in Footprint. New exports default to DWARF ownership paths when mapped sources exist and to unique initializer attachment; manual ownership and initializer choices survive reanalysis of the same export.
- Treemap (`renderTreemap`): sits in `.tm-stage`. The header has the breadcrumb (`#crumbs`), search and the `#tmTree` popover of radio groups (`pathMode`, which re-analyzes the export; `treeMode`; `fragmentView`) with the source-coverage and initializer notes. A dot on the Tree button marks structure that differs from what a new export starts with. The footer has `#tmMeasure` (mirrors the page-wide measure) and `#tmColor` beside the legend.
- Address map (`renderAddrMap`, Footprint "Where things sit"): `addressLayout()` caches live sections sorted by `addr`, alignment padding within output sections, page gaps between them, and the containing region; `addressAt` binary-searches an address. The canvas samples one section per point at the middle of the bytes that point covers; rows are a power-of-two number of bytes, at most 160 rows. Color follows `state.addrColor`; the selected subsystem uses the accent. Exports without `addr` show an explanation instead. The output-section table is the accessible equivalent of the canvas.
- Shared frame and popover patterns: the treemap and explorer each sit in a bordered frame with a header row (navigation, search, menus) and a footer row (legend and display choices). Popovers (`.ex-pop` menus and `.ex-chip` chips) anchor to their header or footer row rather than their button, so they stay on screen at 390 px, and close on an outside click or Escape anywhere on the page (handler in explorer.js).

### Relationship explorer (src/relationships.js, src/explorer.js)

Model (`RelationshipModel`, DOM-free):

- `query(options)` projects the image at directory, subsystem or symbol level, walks the neighborhood of the focus up to `hops`, keeps `maxNodes` candidates (focus first, then distance, then volume), and prunes drawn edges to the strongest per item and `maxEdges`. Caller shares always use full-image denominators.
- `seeds` skips groups with no live bytes (`liveItem`), so fully eliminated subsystems such as `drivers/flexray` never appear; `result.omitted` names them for the takeaway.
- `displayedLinks(result)`: every qualifying relationship among the displayed items, before edge pruning, with `share` and `mutual`. The layout, dependency depth and the highlight overlay all use it; it is cached on the result.
- `communities(result)`: Louvain (`A.communities`, seed 42) over the same undirected pair weights as the layout (larger caller share). Groups are ordered by size and named after their most strongly tied member.
- `radial(result)` ranks items for seeding: focus first, then distinct incoming dependents, incoming reference count and name, using all incoming relationships of the selected type in the projection, including hidden callers, without double counting self references or duplicate caller pairs. `depths(result)` condenses directed cycles and ranks longest chains.

Rendering (`renderExplorerGraph` and friends):

- Frame `.explorer-stage`: header with Graph/Matrix/Depth tabs, breadcrumb from `EX.trail`, search with suggestions as you type, Display popover `#exSettings` (arrangement, color, weight, motion, release, rearrange) and Expand `#exMax`; the chart with a floating zoom stack; a footer with the node-type key `#exShapes`, legend and coverage chips. Filters for what to show and the path finder sit in a sticky rail on desktop and a collapsible panel above the graph on mobile; do not reset the panel's open state on every render. `renderExplorer` adds `.layout.is-wide` to hide the inspector while the explorer is visible. The graph height follows the window.
- Expanded mode (`EX.maximized`) makes the workbench `position:fixed`, locks page scroll and measures the chart's top after layout. Keep `align-content:start` on it, or the momentarily empty grid stretches its rows and the graph is measured too short. Escape exits expanded mode unless focus is on a graph node, where it releases the node.
- Node type is encoded by shape (`EX_TYPES`, `exType`): hexagon top-level directory, diamond subsystem, circle function, square data symbol, hollow outline for a section without symbol information. Shapes are SVG paths scaled by `EX_SHAPE_SCALE` so they read as equal size; `extent` (not `radius`) drives edge endpoints, labels, collision and fit. The key lists only the types present, nodes carry `data-type`, and each accessible name ends with its type.
- Arrangements (`EX.arrange`). `links` (default): one undirected spring per related pair from `displayedLinks`, strength `0.6 × (0.15 + 0.85 × √(share / max share))`, charge −600, centering 0.04 (0.25 for items with no spring so they stay beside the graph), `forceCenter`, a `group` force pulling members toward their community centroid (`GROUP_PULL` 0.3), collision at `extent + 10`, and a final `lead` force holding the leading item at the center unless dragged. `rings`: the original radial bands (pull 0.2, hub 1.0), pruned arrows as links, label-sized collision; radius then means breadth of use. Both seed from `radial` bands. Changing the arrangement or Rearrange clears saved positions.
- Color (`EX.color`): connected group by default (`PALETTE` by group id, ungrouped in `--ink-3`), or top-level directory. A legend under the graph names the groups.
- Labels (`placeLabels`) keep a constant screen size (font scaled by 1/k) and are placed greedily without overlap: highlighted item, its neighbors, focus/center, then by dependents. It runs on every tick and zoom; zooming in reveals more.
- Interaction: click toggles persistent highlighting of a node and its arrows (dependencies magenta, dependents teal) and draws its hidden relationships as thin `.rel-edge-extra` arrows; double-click expands directories into subsystems and subsystems into symbols (Shift+Enter on the keyboard); drag holds a position, Escape releases it, arrow keys move a focused node. Ignore the second click of a double-click and refresh selection without rebuilding the graph so double-click and keyboard focus stay intact. Drag reheats the simulation only after the 4-pixel click threshold, so clicks don't move the layout.
- State: preserve `graphIndex` when matching model links (D3 overwrites `node.index`). Stop and save the simulation (`exStopGraph`) before redrawing, hiding the explorer, or replacing its analysis. Held positions are stored normalized and survive redraws.
- Tests: hover and click `.rel-shape`, not the node group, because labels extend a node's box. Open `#exSettings` before using its controls (`display()` in browser_smoke.py); for the treemap use `tree()` and `checked()`.

## Constraints

- **One self-contained HTML file.** The only external resources are D3 7.9.0 from `cdnjs.cloudflare.com` and the Archivo font from Google Fonts. The page is also published as a claude.ai artifact, whose content-security policy allows scripts only from cdnjs, cdn.jsdelivr.net/npm, cdn.tailwindcss.com and code.jquery.com, and blocks other network requests, remote images, and download links. Keep it that way unless the hosting changes: no npm frameworks, no build step beyond `tools/build.js`, no downloads (the linker rules use a copyable textarea for this reason). Icons are inline SVG. Expanded mode is CSS, not the Fullscreen API, which embedded pages may block.
- No persistence is required or used. The page must work entirely offline once D3 is available.
- Performance envelope: about 300k sections analyze in roughly 8 s in the browser. Beyond that, memory and JSON parsing fail first; the planned answer is offline analysis (see backlog), not micro-optimizing the browser path. The in-page sample (150k sections with symbol details) opens in about 1.8 s.

## Design system

- Type: Archivo (variable width axis) for everything; headline at `font-stretch:125%`; tabular figures. Sentence case everywhere. No all-caps labels, no `A · B` meta strings, no em-dash label constructions, no arrows appended to links.
- Color tokens in `:root` with a dark variant under `prefers-color-scheme` and `[data-theme]`: `--paper`, `--surface`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--accent` (magenta `#C0186A`, used only for selection and emphasis). Directories and explorer groups use the 22-color `PALETTE` in ui.js. Compression ramp amber `#D99A2B` to teal `#2A8C7E`; eliminated ramp `#D5DDE5` to rust `#8A3412`.
- Each view: an `h2`, a one-line description of the encoding (`.q`), then a computed takeaway sentence (`.take`). Keep takeaways specific, with numbers.
- Controls are grouped by how often they change: settings that rebuild an analysis go in a menu (Tree, Display), everyday choices such as size and color sit next to the legend they change, and filters that decide what is shown sit in the explorer's rail.
- Responsive down to 390 px with no sideways page scrolling (wide charts scroll inside `.scroll-x`). Segmented controls wrap.

## Synthetic data: planted stories

`tools/check.js` asserts these, with **source paths** (`pathMode:'source'`), which the dashboard selects for this sample; the dashboard's takeaways rely on them. Keep them when changing the generator.

- 20 top-level directories, 302 subsystems; directories have layers (apps 6 … base and third_party 0) and subsystems mostly depend on earlier siblings, so the layer view shows deep but mostly acyclic stacks.
- About 19% of linker input eliminated: unused functions in live files, whole dead object files, partially used third-party libraries (`DEADRATE`), and fully dead subsystems (`ml/models_legacy`, `apps/demo_mode`, `media/codec_vp9`, `net/ppp`, `drivers/flexray`, `bluetooth/mesh`, `third_party/lua`).
- Single-owner features (`LAZY`): `ml/models_vision` only through `apps::camera_app::Scene::loadModels`; `third_party/icu` only through `ui::text::Shaper::shapeComplex`; `apps/factory_test` and `tools/kunit` through `services::diag::enterFactoryMode`; `tools/gdbstub` and `tools/tracer` through `services::diag::enableDebugger`.
- `services/telemetry`: a feature that became infrastructure (used from about 15 directories, mostly private body). `base/*` and a few kernel and platform services: thin infrastructure with wide APIs. `radio/`: an isolated stack reachable from outside only through `radio/nas`.
- About 16 files placed in the wrong subsystem (`affinity` in the generator).
- Large objects: frame buffers, GPU carveout, kernel heap, model weights, ICU data, DSP firmware image, Wi-Fi firmware blob, plus dead blobs in dead subsystems.
- Compression: about 12% of compressible bytes already in `.z` output sections (apps, media codecs, diagnostics, fonts, speech model and others); vision weights, ICU data and the DSP image are deliberately left uncompressed as the big opportunities. Hot sections: scheduler, interrupts, timers, parts of libc and allocators, radio physical layer, IRQ handlers.
- Build system and DWARF: object paths follow build targets while DWARF records source locations. First-party subsystems are one GN-style target each (`kernel/mm/alloc/page_alloc.c` builds `kernel/mm/mm.page_alloc.o`); vendored libraries keep upstream sources and a CMake object tree (`third_party/icu/source/...` and `third_party/icu/CMakeFiles/icu.dir/...o`); template instantiations are weak symbols in their first user's object but declared in base headers, so `base/protobuf_rt` is about 5.5 MiB by source and 0.3 MiB by object; misplaced files that the other subsystem calls into heavily (`affMode` "in") are compiled by that subsystem's target, so fewer files look misplaced by object path; boot assembly and objcopy firmware blobs (`*.bin.o`) have no DWARF and fall back to object paths. About 30% of plain lowercase C functions are `static`; about 2% of code references resolve only to the nearest function and 0.5% go through trampolines. Source paths reproduce the original layout, so the stories above hold with source paths. `sampleSymbolDetails` uses its own random stream so details never change the image.
- Layout: live sections have link-time addresses from `0x80000000` in a `{start, size}` 512 MiB RAM region: output sections in linker-script order (`.vectors`, `.text`, `.text.z`, `.rodata`, `.rodata.z`, `.data`, `.data.z`, `.bss`), each page aligned, input sections by object path. Alignment is 128 for the vector table, 4096 for objects of 1 MiB or more, 16 for hot code, 4 for other code and 8 for data. Eliminated sections have `addr` -1. The image ends about 65% into the region.

## Decisions worth knowing

- **Subsystem = first two path directories.** Many views depend on it; making the depth configurable is a reasonable future change but touches `makeNode` and the tree.
- **Retained size and ownership come from the dominator tree** of live sections. Startup plumbing is excluded as an owner; otherwise everything is "owned" by `main`.
- **Clustering ignores reference direction** and is weighted by relocation count; the Sankey uses code bytes for widths so large buffers don't swamp structure.
- **Interface narrowness** (bubble map y-axis) is the share of a group's bytes referenced from outside, on a log scale; cohesion was tried and did not separate the roles.
- **Compression** applies only to live, non-bss sections whose output section matches a glob. What-if projections never compress hot sections. A fixed decompression buffer is subtracted from savings when anything is compressed.
- **Source paths are the default ownership when DWARF maps them.** A section uses its source file only when all mapped symbols agree; otherwise it keeps its object path. Object paths are what the linker sees and what linker scripts select on; source paths are where engineers own code. The sample is built so the two differ in realistic ways, and both are one Tree-menu choice apart.
- **Addresses are link-time and optional.** They describe the uncompressed layout (a `.z` output section spans its raw size). The address map samples one section per point, so it shows structure at a glance; exact figures come from hover and the table.
- **Explorer layout encodes connectivity, not popularity.** The ring layout put the most widely used item in the middle with a pull stronger than the links, so position showed rank rather than relationships, and it only saw the pruned arrows (about 30% of relationships among the shown items). The connection layout uses every relationship among the displayed items, weighted by caller share rather than raw count so large items don't decide which pairs sit together. Rings remain as an option.
- **Explorer tuning was measured, not guessed.** The metric: for each item, the share of its three strongest partners (by share and by count, over all displayed relationships) that are among its six nearest neighbors on screen; random placement scores about 0.12. On the 30k sample the current settings score about 0.47 (directories), 0.32 (subsystems), 0.25 (focus on `services/telemetry`) and 0.53 (subsystems at 390 px), against 0.47, 0.21, 0.22 and 0.36 for rings. Dividing spring strength by degree, linear weights, smaller collision without group pull, and keeping only the top three springs per item all scored worse. Re-measure before retuning forces.
- **Explorer groups are computed per view.** Whole-image clusters (`mods[].cluster`) split 50 displayed subsystems into about 35 clusters; Louvain over the displayed relationships gives 5–7 meaningful groups and matches the layout's weights.
- **Labels declutter instead of reserving space.** Label-sized collision spread nodes so far apart that fit zoomed to about 0.5 and labels shrank to 5 px. Constant-size labels with greedy placement let nodes pack by circle size and reveal more labels on zoom.
- **Node shape shows type; color shows group or directory.** Captions are hidden whenever their label is, so type needed an encoding that never disappears.
- **Fully eliminated subsystems are excluded from explorer neighborhoods** and named in the takeaway: with no live references they would float unconnected.

## Backlog

Roughly in priority order:

1. **ELD plugin export** in the columnar format, gzipped, including `addr`/`align` and region starts. Validate on a real image; check counts, totals and addresses against the linker map.
2. **Calibrated compression ratios**: compress each eligible output section of the final image with the real algorithm, and accept per-output-section ratios in the `compression` block.
3. **Hot data from profiling** (`hot` flag) instead of the infrastructure stand-in.
4. **Offline analysis for millions of sections**: run the core under Node, or reimplement the heavy parts (dominators via Lengauer–Tarjan, Leiden clustering, per-subsystem removal impact in parallel) in C++ inside the plugin or with Python + igraph, and export precomputed results; keep only cheap recalculation (compression, thresholds, rendering) in the browser.
5. Per-object-file merging option in the export for very large images, with the dashboard degrading gracefully.
6. **Treemap usability**: click selects and shows details, double-click or Enter zooms in, Escape or Backspace and an "Up one level" button zoom out, with a short zoom animation; focusable tiles or a sortable "Show as list" table of the current level; tap-to-inspect on touch devices; search that suggests as you type and steps through matches; size to the window with an Expand button; shares in group labels; a one-sentence description with the mechanics in a disclosure.
7. **Explorer follow-ups**: a details drawer inside the graph (bottom sheet on mobile) instead of the panel below it; quick actions next to a clicked node (focus, expand, find path from here, show in Footprint); simpler rail controls (segmented direction, hop stepper); type glyphs in the Matrix and Depth views; rename the remaining "Components" wording to "directories".
8. **Address map**: zoom into an address range to see individual sections and padding.
9. Smaller items: configurable subsystem depth; Leiden instead of Louvain; an "export sample" control if the hosting allows downloads; persisting settings per export.
