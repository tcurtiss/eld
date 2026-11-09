# Image Proctologist

This dashboard is maintained with its CrossReference exporter in the ELD
repository at `Plugins/CrossReference/dashboard/`. Make exporter, schema,
and dashboard changes together here. See the [plugin development guide](../README.md#develop-the-exporter-and-dashboard-together)
for the combined CMake build and producer/consumer checks. The original
`image_analysis` repository was imported at commit `eec6d70` and remains a
reference snapshot.

An interactive, single-file HTML dashboard for understanding a large, monolithic firmware image from the linker's point of view: where the bytes go, what compression saves, what garbage collection throws away, what keeps the rest in the image, how subsystems depend on each other, and which code belongs together.

It is built for a RAM-only system of several hundred MiB with a few hundred subsystems, linked with the [ELD](https://github.com/qualcomm/eld) linker. A linker plugin exports every input section, its size and output section, whether it survives garbage collection, and every reference between sections. The dashboard does all analysis in the browser. Nothing is uploaded.

Without an export, it generates a realistic synthetic image (about 332 MiB in 302 subsystems across 20 top-level directories, 19% of the linker input eliminated, with DWARF-style source details and a link-time address layout) so every view can be explored and demonstrated.

## Quick start

Open `dist/image-anatomy.html` in a current browser. It opens the Footprint treemap with the synthetic sample (see [Synthetic sample](#synthetic-sample)). Use **Load linker export** to open your own `.json` or `.json.gz` file, or try `samples/sample-20k.columnar.json.gz`. Loaded exports default to DWARF ownership paths when mapped sources are available, with unique initializer fragments attached to their data container.

The page needs network access for D3 (from cdnjs) and the Archivo font (from Google Fonts; it falls back to system fonts). For fully offline use, build with a local D3 copy (see below).

While a linker export is loaded, the browser asks for confirmation before leaving, reloading or closing the page so you can keep your analysis context. Restoring the synthetic sample removes the warning.

## What the dashboard shows

- **Memory bars**: RAM use by top-level directory at stored (compressed) size, the decompression buffer, what compression saved, and free space; below it, the linker input with the eliminated part hatched.
- **Where the bytes are**: a zoomable treemap of the image by top-level directory, subsystem, object file and section, sized by stored, raw, eliminated or linker-input bytes.
- **Where things sit**: an address map of the RAM region showing where every live section was linked, with alignment padding, gaps between output sections and unused space.
- **What compression saves**: compression eligibility from output-section patterns, separate code and data scale factors and a decompression buffer, all adjustable. The same panel can remove comma-delimited output-section patterns from the analysis and reference graph; it defaults to `overlay_mem_dump, QSR_4_0_STR, QSR_4_0_MSG`. Subsystems ranked by untapped saving, candidate lists (rarely used code, large uncompressed data, and poor candidates that are shared or hot), a what-if projection, and generated linker-script rules for the selection.
- **What the linker throws away**: subsystems by eliminated input, unused islands (dropped code that only refers to itself, typically a whole unused feature) and object files dropped entirely.
- **What you could cut**: sections ranked by retained size from the dominator tree: everything only reachable through them. Template families with many instantiations.
- **Shared versus isolated**: subsystems or directories placed by how widely they are used and how narrow their interface is, with an adjustable threshold for "shared". Cards for isolated blobs (entry points, users, dependence on shared code, size removable as a unit). Dependency layers stacked above the shared floor, with cycles identified.
- **How subsystems depend on each other**: a dependency structure matrix at directory or subsystem level, in source-tree order or ordered by community detection, with shared infrastructure optionally hidden. It can show raw reference count, the caller's external-reference share, or reciprocal coupling density. Selecting a cell opens both directions of that relationship; a linked table ranks reciprocal subsystem pairs as collocation candidates, including their reference shares, evidence volume, footprint and community/source-tree signals.
- **Relationship explorer**: an interactive force-directed graph, focused matrix and dependency-depth view of top-level directories, subsystems, functions and data, for following who uses what.
- **How a directory naturally groups**: a flow from the subsystems of one directory to the groups the reference graph suggests, and files that talk more to another subsystem than to their own.
- **Side panel**: everything about the selected subsystem, including its role, compression, what would go without it, and who uses it.

Every view is linked: clicking a subsystem anywhere selects it everywhere.

The page is organized around two workflows. **Footprint** contains the layout,
address, compression, eliminated-content, and retained-size views. **Connectivity**
contains shared-versus-isolated analysis, subsystem dependencies, natural
grouping, and the Relationship explorer. The memory bars summarize the image above
the two workspace selectors. The selected subsystem and global controls persist while
switching views, so a large object or subsystem can be followed from its
memory cost into its dependency and refactoring context without scrolling
through unrelated analyses.

## How the views are designed

### Conventions

- Every view has a heading, a one-line description of what its encoding means, and a takeaway sentence computed from the data, with numbers. Visible copy avoids linker jargon where a plain phrase works.
- Magenta is reserved for the selection and emphasis. The selected subsystem is magenta in every view that can show it.
- Controls are grouped by how often they change. Settings that rebuild an analysis sit in a menu (the treemap's **Tree** menu, the explorer's **Display** menu); everyday choices such as size and color sit next to the legend they change; filters that decide what the explorer shows sit in its side rail.
- Large views sit in a frame: navigation, search and menus in a header row; legend and display choices in a footer row. Menus and chips open as popovers that stay on screen at phone width and close on an outside click or Escape.
- Everything works down to 390 px wide without sideways page scrolling, in light and dark themes, and with the keyboard.

### Where the bytes are (treemap)

Each view shows three levels at a time: by default top-level directory, subsystem and object file, or, with **Grouping: Code and data first**, section type, then directory, subsystem and object file. Click a block to zoom in; the breadcrumb returns to any level. Search finds and zooms to a directory, object file, output section or symbol, and highlights matching raw sections.

- Singleton object-file layers (fewer than two visible sections for the selected measure) are omitted in either hierarchy. In the source-tree view, a kind layer is kept only when it has at least two visible sections from at least two object files; otherwise its sections go directly to the nearest useful parent.
- When one symbol takes at least 95% of a file, the file is flattened at the subsystem view into that symbol plus an interactive "Other symbols" tile; focusing the file gives the same split. Very large groups show the largest sections plus an explicit "other sections" bucket.
- The **Tree** menu holds the three settings that change the tree's structure, each with a one-line explanation: **Ownership paths** (build paths or source files from debug information; changing it analyzes the export again, and mapping coverage is shown here), **Grouping**, and **Initializer data** (count anonymous initializer data with the one symbol that uses it, or keep it where the linker placed it). A dot on the button marks a structure that differs from what a new export starts with.
- The footer holds **Size** (stored, raw, eliminated or linker input; linked to the page-wide measure) and **Color** (directory, section type, compression share or eliminated share) beside their legend.

### Where things sit (address map)

The RAM region is drawn as rows of addresses, read left to right and top to bottom like text. Each row covers a power-of-two number of bytes, and each point shows the section at the middle of the bytes it covers, so at 1440 px a point is about 4 KiB: the map shows structure at a glance, while hover and the table give exact figures.

- Color by top-level directory, output section or compression state; the selected subsystem is magenta, padding is grey and unused space is blank. Output-section starts are marked.
- Hovering names the section, its address range, alignment, object and subsystem, or the alignment padding, gap between output sections or unused space at that point. Clicking selects the subsystem.
- The summary measures how much of the region the image fills, alignment padding (with the largest gap), page gaps between output sections and unused space. A table lists each output section's start, end, size, padding and section count.
- Addresses are link-time addresses, before any post-link compression, so a compressed output section spans its raw size. The view needs the optional `addr` (and `align`) fields; see [Addresses and alignment](docs/export-format.md#addresses-and-alignment).

### Relationship explorer

The explorer starts with top-level directories and one strongest incoming and outgoing relationship per item. Its default budgets are 50 nodes (30 on mobile) and 150 drawn relationships; the coverage chip reports omitted relationships and the share of eligible reference volume displayed. Subsystems with no code or data left after linking are left out and named in the takeaway.

- **Layout.** By default the graph is arranged by connections: every relationship among the displayed items pulls the pair together, not only the drawn arrows, and items that make up a larger share of each other's external references sit closer. The leading item (the focus, or the most widely used item) is held at the center, and items with no relationship in view stay close by. **Arranged by number of users**, items with more distinct dependents stay in inner bands instead, so distance from the center shows breadth of use. Both start from those bands. Ranking counts incoming relationships across the full image at the current detail level and reference type, including hidden callers, so display limits never change an item's score.
- **Groups.** Nodes are colored by connected group: natural groups found among the displayed items from the same relationship weights, with a legend naming each group after its most strongly tied member. A gentle pull keeps each group together. **Color by** switches to top-level directory colors.
- **Node types.** Shape shows what each node is: a hexagon is a top-level directory, a diamond a subsystem, a circle a function, a square a data symbol, and a hollow outline a section without symbol information. A key under the graph lists the types shown; screen readers hear the type with each name. Shared items have dashed outlines.
- **Labels** keep a constant size on screen and never overlap. The highlighted item and its neighbors are labeled first, then the focus and the most widely used items; zooming in reveals more.
- **Highlighting.** Click a node, or press Enter, to toggle its highlight: dependencies in magenta, dependents in teal, and its relationships hidden by display limits as thin arrows. Clicking an arrow shows the reference evidence.
- **Navigation.** Double-click a directory to expand its subsystems, then a subsystem to show its functions and data (Shift+Enter on the keyboard). The breadcrumb in the graph's header returns to any step, and search suggests matches as you type. Drag nodes to hold their positions, press Escape to release them, use the arrow keys to move a focused node, and pan or zoom. The **Display** menu holds the arrangement, colors, weight, motion, release and rearrange; **Expand** fills the window and Escape returns. The page's side panel is hidden while the explorer is open so the graph gets its width, and the graph follows the window height.
- **Filters** for detail level, direction, neighborhood depth (up to four hops), reference type, display limits and shared infrastructure sit in a rail beside the graph on desktop and in a collapsible panel above it on mobile, together with the directed path finder.
- **Matrix and dependency depth.** The Matrix tab shows the same items and relationships as cells. Dependency depth groups items into cycle groups, ranks them by longest dependency chain and shows a heatmap of references between depths; it uses every eligible relationship between the displayed items, not only the drawn arrows, and hidden items can still extend chains or connect cycles.
- **Accuracy rules.** Caller shares always use the full image's references as the denominator. Both displays show direct references only; more hops add related items without inventing indirect edges. Exports without symbol details use physical sections with explicit section-only labels, and approximate code targets are drawn dashed.

### Synthetic sample

Without an export, the page generates a deterministic image that exercises every view: about 332 MiB of live sections in 302 subsystems across 20 top-level directories, with 19% of the linker input eliminated. It plants recognizable stories, including fully dead subsystems, features reachable through a single call, infrastructure that grew out of a feature, an isolated radio stack, misplaced files, template families, large buffers and firmware blobs, and partly compressed output sections. `CLAUDE.md` lists them; `tools/check.js` checks them.

The sample also models what a real build adds:

- **DWARF-style symbol details** whose source paths differ from the object paths the way a build system places objects: first-party subsystems are one build target each, so `kernel/mm/alloc/page_alloc.c` builds `kernel/mm/mm.page_alloc.o`; vendored libraries keep their upstream sources and a CMake object tree; template instantiations are compiled into their users' objects but declared in shared headers; some misplaced files are already compiled by the subsystem they belong with; boot assembly and firmware blobs have no debug information. Switch **Ownership paths** in the Tree menu to compare: for example, `base/protobuf_rt` is 5.5 MiB by source file and 0.3 MiB by build path.
- **A link-time layout** from `0x80000000` in a 512 MiB RAM region, with output sections in linker-script order, page-aligned output sections and per-section alignment.

## Exporting from the linker

See [docs/export-format.md](docs/export-format.md). In short:

- one record per input section, including the ones `--gc-sections` discards (flagged as eliminated);
- the object/build path (subsystem = first two directories), size, kind (code, read-only data, initialized data, bss) and output section; optional DWARF metadata enables source ownership;
- optionally each live section's final address and alignment, and region start addresses, for the address map;
- roots (entry point, vector tables, `KEEP` sections) and optionally hot sections;
- references from relocations, merged per source–target pair with a count.

Prefer the **columnar** format: about a quarter of the size of the object format, and faster to load. Gzip it. The treemap uses object-file and kind aggregates by default, and materializes raw section tiles only when requested, but graph analysis still retains every section. For millions of sections, move the heavy analysis offline or provide a pre-aggregated summary export (see the backlog in `CLAUDE.md`).

### Source and symbol inspection

CrossReference exports can include optional symbol metadata:

```yaml
Options: file=xref.json:format=json_columnar:symbol_details=dwarf:gzip=yes
```

Use `symbol_details=elf` when symbol names and reference pairs are sufficient
and debug parsing is not wanted. `symbol_details=none` is the default; existing
exports without symbol details remain supported.

Add `fragment_details=data` to identify anonymous string, const, read/write,
and bss input sections referenced by named data symbols. In the treemap's Tree menu,
**Initializer data: Count with the symbol that uses it** defaults on and presents unambiguous fragments below
their data container without changing physical byte accounting; shared and
ambiguous fragments remain at their original location.

For code references with symbol details, the export resolves a relocation to
the target function when its target section and addend identify a containing
function. A nearest preceding function is retained as an explicitly labeled
approximation; unresolved destinations remain section-only. The dashboard
shows all three categories so dependency analysis never silently treats an
approximation as an exact call target.

In **Where the bytes are**, search for a symbol (including aliases), linkage
name, or source path to focus its section. The selected-section panel lists
symbols, declaration locations, and the highest-count incoming/outgoing
reference pairs, including pairs inside one input section. Click an endpoint
to inspect the corresponding section. Counts measure static relocations, not
runtime traffic; approximate/unattributed edges are labeled.

Switch **Ownership paths** in the treemap's Tree menu between build paths and DWARF source paths.
A newly loaded export selects DWARF paths when mapped source ownership is available;
otherwise it uses object/build paths. Manual path and initializer choices survive
reanalysis of the same export.
A section uses source ownership only when its mapped symbols agree on one file;
mixed or unmapped sections retain object ownership. Mapping coverage is shown
in the Tree menu. This changes subsystem grouping throughout the analysis, not
section bytes or reference totals. Aliases never add memory. DWARF locations
are declaration sites, not exact call-site lines. See the
[extension schema](docs/export-format.md#optional-symbol-and-source-details).

## Repository layout

```
src/page.html        page markup and CSS, with script markers for the single-file build
src/core.js          synthetic generator, both ingestion paths, all graph analysis (no DOM; also runs in Node)
src/relationships.js  directed neighborhoods, bounded projections, evidence and path queries (also runs in Node)
src/explorer.js      graph/matrix rendering and relationship exploration, included inside the UI closure
src/ui.js            rendering and interaction (D3, SVG, canvas)
dist/                built single-file dashboard (committed so it can be opened directly)
docs/export-format.md  the export formats, field by field
samples/             small reference export (20k sections, with symbol details and addresses)
tools/build.js       assembles dist/image-anatomy.html
tools/gen-sample.js  writes synthetic exports in either format, with DWARF details unless --no-details
tools/check.js       fast Node checks of the analysis and the planted sample stories
tools/check-relationships.js  direction, neighborhood, path, attribution and filtering checks
tools/check-details.js  symbol detail, alias, source grouping and validation checks
tools/check-build.js  verifies that the committed HTML matches its sources
tools/check-export.js  verifies real plugin exports from ../test/dashboard_test.py
tools/browser_smoke.py  headless browser test of every view (Playwright)
tools/capture.py     captures the key views and takeaways for a presentation (Playwright)
tools/make-deck.js   builds a draft PowerPoint deck from the captures
```

## Development

Requires Node.js 18 or later. Building and the checks need no npm packages.

```sh
npm run build          # dist/image-anatomy.html
npm run check          # analysis checks, both formats, about 5 s
npm run lint           # optional: ESLint (run npm install once first)
npm run sample         # samples/sample-150k.columnar.json.gz
node tools/gen-sample.js --sections 300000 --format objects --no-gzip
node tools/build.js --d3 path/to/d3.min.js --out /tmp/offline.html   # inline D3 for offline use
```

`npm run lint` is an optional checker that needs ESLint, which is not installed by default. Install it once with `npm install` (it is listed in `devDependencies`); this needs Node.js 20.19 or later.

The browser smoke test needs Python Playwright (`pip install playwright && playwright install chromium`):

```sh
python3 tools/browser_smoke.py                    # needs network for D3
python3 tools/browser_smoke.py --d3 path/to/d3.min.js --screenshots /tmp/shots
```

Edit the files in `src/`, then rebuild. Don't edit `dist/` by hand.

For combined development, configure and build the parent Plugins project as
described in [CrossReference's README](../README.md), then run:

```sh
cmake --build /path/to/build-plugins --target check-crossreference-dashboard
```

With standalone `BUILD_TESTING=ON`, this also verifies real CrossReference
exports through this dashboard's analyzer and leaves small exports under
`/path/to/build-plugins/CrossReference/dashboard/exports/` for manual exploration.
The built page is beside that directory. CMake discovers Node.js when available;
it does not require npm packages or launch browsers. Run Playwright explicitly
when a change needs browser interaction checks.

## Presentation (optional)

Two scripts turn the dashboard into a draft PowerPoint deck for a high-level audience: one slide per message, with the dashboard's computed takeaway as the slide title and the matching view as its picture.

```sh
pip install playwright && playwright install chromium   # once, as for the smoke test
npm install                                             # once: installs pptxgenjs (a dev dependency)

python3 tools/capture.py                                # synthetic sample
python3 tools/capture.py --export my-image.columnar.json.gz
node tools/make-deck.js                                 # presentation/image-anatomy-draft.pptx
```

`tools/capture.py` loads the export in a headless browser, sets each view up the same way every time and writes `presentation/`:

- `images/*.png`: each view at twice screen resolution in the light theme (`--scale 3` for sharper images);
- `images/*.svg`: vector copies of the treemap and the shared-versus-isolated map, with styles inlined, for editing in PowerPoint;
- `takeaways.json`: each view's takeaway sentence and its top rows.

Other options: `--highlight SUBSYSTEM` picks the subsystem highlighted in the shared-versus-isolated map (default `services/telemetry`), `--d3 path/to/d3.min.js` works offline, and `--out DIR` writes somewhere else.

`tools/make-deck.js` builds ten slides from that directory: at a glance, where the RAM goes, what the linker throws away, compression today and what more it could save, what you could cut, shared versus isolated, next steps, and the dependency matrix as an appendix. The full takeaway sentences are in the speaker notes. Decks built from the synthetic sample say so on every slide; capture from a real export before presenting. The deck is a draft: edit the wording in PowerPoint. `presentation/` is not tracked by git.

## Technology

Plain JavaScript, HTML and CSS in one self-contained file. [D3](https://d3js.org) v7 for the treemap layout, force simulation, scales, axes and SVG rendering; HTML canvas for the dependency matrix and the address map. The graph algorithms are hand-written on typed arrays: compressed sparse row adjacency, the Cooper–Harvey–Kennedy dominator algorithm, Louvain community detection, Tarjan's strongly connected components with longest-path layering, and union-find.

## Status

A working prototype supporting ELD CrossReference section graphs and optional symbol/source metadata, validated with synthetic and real image exports. Refactoring and compression suggestions remain hypotheses to validate against the code and runtime behavior; see `CLAUDE.md` for the backlog and the design decisions behind each view.
