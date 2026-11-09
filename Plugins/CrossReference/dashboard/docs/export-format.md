# Export format

The dashboard reads a JSON description of the linked image: every input section the linker saw, its size and placement, whether garbage collection kept it, and every reference between sections. Two formats are accepted, plain or gzip-compressed (`.json.gz`, detected by its magic bytes, not the file name):

- **Columnar** (`"format": "fia-columnar"`): the recommended format. String tables plus one array per attribute. About a quarter of the size of the object format and faster to parse.
- **Object**: one object per section and per reference. Simpler to write by hand and to read when debugging.

Both produce identical analysis results (`tools/check.js` verifies this). `samples/sample-20k.columnar.json.gz` is a reference file; `node tools/gen-sample.js` writes others in either format.

## What a section is

One node per **input section** as the linker sees it. With `-ffunction-sections -fdata-sections` that is roughly one function or one variable. Include:

- every input section that reaches the image, and
- every input section that `--gc-sections` discards, marked as eliminated. They feed the eliminated-code views and are excluded from everything about the image.

Sizes are in bytes. Linker-generated content (veneers, trampolines, padding, merged string pools) can be emitted as extra sections under a synthetic path such as `(linker)/generated/veneers` so totals reconcile with the output image.

## Fields common to both formats

| Field | Required | Meaning |
|---|---|---|
| `title` | No | Shown under the heading; defaults to the file name. |
| `regions` | No | Memory regions, each either a size in bytes, e.g. `{ "RAM": 536870912 }`, or `{ "start": 2147483648, "size": 536870912 }` with its start address. Sizes are summed into the capacity the RAM bar is drawn against; a start lets the address map show the whole region, including unused space. If omitted, the next power of two above the image size plus 15% is used. |
| `compression` | No | Starting values for the compression settings, all editable in the page: `patterns` (comma- or space-separated output-section globs, `*` and `?`), `codeRatio` and `dataRatio` (stored size as a fraction of raw size), `decompressBufferBytes` (fixed RAM overhead). Defaults: `.*clade*`, 0.30, 0.50, 0 B. |

## Columnar format (version 1)

```json
{
  "format": "fia-columnar", "version": 1,
  "title": "soc-fw r1234",
  "regions": { "RAM": 536870912 },
  "compression": { "patterns": ".*clade*",
                   "codeRatio": 0.30, "dataRatio": 0.50, "decompressBufferBytes": 0 },
  "strings": {
    "dirs":   [[-1, "net"], [0, "tcp"], [1, "core"], [-1, "platform"], [3, "boot"], [4, "core"]],
    "files":  [[2, "tcp_out.c"], [5, "start.c"]],
    "scopes": [[-1, "net"], [0, "Socket"]],
    "outs":   [".text", ".text.z", ".rodata", ".rodata.z", ".data", ".data.z", ".bss"]
  },
  "sections": {
    "count": 4,
    "size":  [312, 188, 940, 132],
    "file":  [0, 0, 0, 1],
    "out":   [0, 1, 0, 0],
    "kind":  [0, 0, 0, 0],
    "flags": [4, 0, 1, 2],
    "scope": [-1, 1, -1, -1],
    "name":  ["tcp_output", "send", "tcp_debug_dump", "Reset_Handler"]
  },
  "refs": {
    "offsets": [0, 0, 1, 2, 2],
    "targets": [0, 0],
    "counts":  [2, 1]
  }
}
```

### `strings`

| Table | Entry | Meaning |
|---|---|---|
| `dirs` | `[parent, name]` | Directory tree. `parent` is an index into `dirs`, `-1` for a top-level directory. Each directory appears once. |
| `files` | `[dir, basename]` | Source files. `dir` is an index into `dirs` (`-1` for a file at the top level). |
| `scopes` | `[parent, name]` | C++ namespaces and classes, as a tree like `dirs`. |
| `outs` | string | Output section names. |

Parents do not have to appear before their children; the reader resolves chains recursively and caches them.

### `sections`

Every array has exactly `count` entries. **The section number is the array position**; there are no ids.

| Array | Required | Meaning |
|---|---|---|
| `size` | Yes | Bytes. |
| `file` | Yes | Index into `strings.files`. |
| `kind` | No | 0 code, 1 read-only data, 2 initialized data, 3 zero-initialized data (bss). Default 0. |
| `flags` | No | Bitfield: 1 eliminated by garbage collection, 2 root (entry point, vector table or `KEEP` section), 4 hot (frequently executed). Default 0, meaning a live, ordinary section. Roots are ignored on eliminated sections. |
| `out` | No | Index into `strings.outs`, `-1` for none. Matched against the compression patterns. |
| `scope` | No | Index into `strings.scopes`, `-1` for none. The full name is the scope chain joined with `::`, then `::`, then `name`. The scope is also the class level in the treemap. |
| `name` | No | Leaf name. An empty string is allowed for small sections to save space; the dashboard then shows `<file> #<index>`. Template arguments (`<…>`) in names are used to group template families, so keep them. |
| `addr` | No | Final link-time address of the section, `-1` when unknown. Ignored for eliminated sections. See [Addresses and alignment](#addresses-and-alignment). |
| `align` | No | Alignment in bytes, `0` when unknown. |

### `refs`

References are grouped by source section (compressed sparse rows):

| Array | Required | Meaning |
|---|---|---|
| `offsets` | Yes | `count + 1` entries. Section `i` refers to `targets[offsets[i]]` up to, but not including, `targets[offsets[i+1]]`. |
| `targets` | Yes | Target section numbers. |
| `counts` | No | Relocation count per target, used as the edge weight. Omit when every count is 1. |

Merge duplicate source–target pairs into one entry with a count. Self-references and out-of-range targets are ignored.

### Size guidance

Measured on the synthetic data at 150k sections: 8.8 MB of columnar JSON (1.8 MB gzipped) against 31.4 MB of object JSON (3.4 MB gzipped). Expect roughly 50 bytes per section with names (about 25 without most names) and about 10 bytes per reference before compression.

Writing tips for the plugin:

- Write `count` and the string tables first, then the section arrays, then `refs`; each array can be streamed.
- Plain integers only: no floats, exponents or padding. Don't pretty-print the large arrays.
- Keep `format` and `version`; the reader rejects versions it doesn't know.

## Object format

```json
{
  "title": "soc-fw r1234",
  "regions": { "RAM": 536870912 },
  "nodes": [
    { "id": 1, "name": "tcp_output", "path": "net/tcp/core/tcp_out.c",
      "kind": "code", "size": 312, "out": ".text", "hot": true },
    { "id": 2, "name": "net::Socket::send", "path": "net/sockets/api/socket.cpp",
      "kind": "code", "size": 188, "class": "net::Socket", "out": ".text.z" },
    { "id": 3, "name": "tcp_debug_dump", "path": "net/tcp/util/tcp_dbg.c",
      "kind": "code", "size": 940, "live": false },
    { "id": 4, "name": "Reset_Handler", "path": "platform/boot/core/start.c",
      "kind": "code", "size": 132, "root": true }
  ],
  "edges": [
    { "src": 2, "dst": 1, "count": 2 },
    { "src": 3, "dst": 1, "count": 1 }
  ]
}
```

| Node field | Required | Meaning |
|---|---|---|
| `id` | Yes | Number or string, unique; compared as text. Duplicates after the first are ignored. |
| `size` | Yes | Bytes. |
| `path` | Yes, effectively | Source path, `/`-separated. Missing paths are filed under `(unknown)/`. |
| `name` | No | Display name; defaults to the id. |
| `kind` | No | `code`, `rodata`, `data` or `bss`; anything else counts as `code`. |
| `live` | No | Default `true`; `false` means eliminated by garbage collection. |
| `root` | No | Entry point, vector table or `KEEP` section. |
| `out` | No | Output section name. |
| `hot` | No | Frequently executed. |
| `class` | No | Enclosing C++ class, adds a class level in the treemap. |
| `addr` | No | Final link-time address; omit or use `-1` when unknown. Ignored for eliminated sections. |
| `align` | No | Alignment in bytes; omit or use `0` when unknown. |

| Edge field | Required | Meaning |
|---|---|---|
| `src`, `dst` | Yes | Section ids. Unknown ids and self-references are skipped. |
| `count` | No | Relocation count, default 1. |
| `kind` | No | Accepted and ignored (`call`, `addr`, `data`, `ptr`). |

## Addresses and alignment

Both formats can carry where each live section ended up: `addr` is the section's
final address after layout and relaxation (its virtual address in the linked
image), and `align` its alignment. They are optional, per section, and old
exports need no conversion. With them, the dashboard draws an address map of
each region and measures alignment padding and gaps between output sections.

- Addresses are link-time addresses. When output sections are compressed after
  linking, they describe the uncompressed layout, so a `.z` output section
  spans its raw size.
- Eliminated sections have no address; `-1` (or an omitted field) is expected.
- JSON numbers are exact up to 2^53, which covers 32-bit addresses and realistic
  64-bit firmware addresses. Larger addresses are rejected rather than rounded.
- Section order in the export does not need to follow addresses.
- A region with a `start` (see `regions` above) bounds the map; without one, the
  map spans the lowest to the highest placed byte.

In columnar JSON the two arrays sit beside the others in `sections`, for example
`"addr": [2147483648, 2147483664, -1, 2147418112], "align": [16, 16, 0, 4]`.
They add roughly 10 bytes per section before compression.

## Optional symbol and source details

CrossReference's `symbol_details=elf` adds `symbolDetails` to either format.
`symbol_details=dwarf` additionally includes declaration source locations. If
it recovers none, it falls back to the `elf` detail schema and omits the empty
source table and source columns. The ordinary section graph is unchanged, and
old exports need no conversion. Symbol IDs are export-local and distinct from
section IDs. The dashboard keeps section-based accounting; overlapping symbol
ranges and aliases are never summed.

An object-format extension looks like:

```json
{
  "symbolDetails": {
    "version": 1,
    "sourceFiles": ["src/app/main.cpp"],
    "symbols": [
      {"id": 0, "section": 1, "chunk": 0, "name": "entry", "linkageName": "entry",
       "offset": 0, "size": 32, "flags": 4, "sourceFile": 0, "sourceLine": 12}
    ],
    "refs": [
      {"sourceSection": 1, "targetSection": 1, "src": 0, "dst": 0,
       "count": 1, "flags": 0}
    ]
  }
}
```

This fragment must accompany a section graph containing section 1.
For columnar input, use parallel arrays instead of record objects:

```json
{
  "symbolDetails": {
    "version": 1,
    "sourceFiles": ["src/app/main.cpp"],
    "symbols": {
      "count": 1, "section": [0], "chunk": [0], "name": ["entry"],
      "linkageName": ["entry"], "offset": [0], "size": [32], "flags": [4],
      "sourceFile": [0], "sourceLine": [12]
    },
    "refs": {
      "sourceSection": [0], "targetSection": [0], "src": [0], "dst": [0],
      "count": [1], "flags": [0]
    }
  }
}
```

This fragment accompanies a columnar section graph containing section 0.
The outer `fia-columnar` version stays 1. All symbol arrays have `count` entries;
reference arrays have equal lengths. Unlike outer `refs`, these are plain
parallel arrays, not CSR adjacency.

| Fields | Meaning |
|---|---|
| `section`, `sourceSection`, `targetSection` | IDs in the ordinary section graph. |
| `chunk`, `offset`, `size` | Export-local chunk identity, offset within that chunk, symbol size. Not a final address. |
| `name`, `linkageName` | Display name and raw ELF symbol name. |
| Symbol `flags` | Bit mask: 1 local, 2 weak, 4 function, 8 object/data. |
| `sourceFiles`, `sourceFile`, `sourceLine` | Interned paths, path index and declaration line. Object records omit missing locations; columnar records use -1 and 0. Source tables/columns are omitted when no DWARF locations are recovered. |
| `src`, `dst` | Symbol IDs (consecutive from zero), or -1 for an unavailable symbol. Section endpoints remain required. |
| Reference `count`, `flags` | Positive static relocation count; flags: 1 nearest source symbol, 2 unattributed source, 4 trampoline, 8 nearest target function. Multiple tags can coexist. |

Same-section and self-symbol references are retained here even though the
ordinary section graph omits them. A missing location is not proof of missing
source: aliases, optimized debug information and ambiguous names can lack a
usable declaration DIE. Locations do not identify exact relocation call sites.
For a target expressed as a code-section symbol plus relocation addend,
CrossReference may fill `dst` from a containing ELF function range in that same
input chunk. A target with flag 8 is only a nearest-preceding function and must
be presented as approximate. The raw section edge remains authoritative in both
cases.

### Optional initializer fragments

When CrossReference is invoked with `fragment_details=data` (or `all`),
`symbolDetails.initializerFragments` is an independently versioned extension.
Its `refs` are objects in object JSON and parallel arrays in columnar JSON:
`container` is a symbol ID, `targetSection` is a section ID, `class` is 1
string literal, 2 numeric constant, 3 const data, 4 relocatable const data, 5
read/write data, or 6 zero-init data; `count` is the aggregated relocation use
count; and `ownerCount` is the number of distinct known containers for that
target section.

The dashboard always preserves the physical section graph and byte totals. Its
optional logical treemap view attaches only a uniquely owned fragment to a
known data container; shared or ambiguous fragments stay at their physical
location. These relationships are containment candidates, not fabricated ELF
symbols or proof of byte-range ownership.

The ownership selector uses a section's source file when all **mapped** symbols
agree; mixed or missing source mappings fall back to its original object path.
That includes sections with a mapped symbol and unmapped aliases. Original
object ownership is retained in the inspector. Output-section exclusion applies
to metadata navigation too. The browser keeps columnar records and a compact
section-to-symbol index, materializes at most 40 inspector rows per table, and
caches only the current reference query rather than a second full object graph.

## What the dashboard derives

- **Top-level directory**: the first directory of the path. **Subsystem**: the first two. Treemap levels follow the full directory path, then file, then class or scope, then section.
- **Roots**: if none are marked, every live section no other live section refers to.
- **Startup plumbing**: roots, `main`, names ending in `init` or `start`, and any section keeping more than a fifth of the image alive. Their references are left out of dependency layering, and they never count as the single owner of a blob.
- **Hot code**: if no section is marked hot, shared infrastructure stands in for it in the compression view.
- **Eliminated code** comes only from the eliminated flag; it is never inferred from reachability.
- **Compressed**: a live, non-bss section whose output section matches the compression patterns. Stored size is raw size times the code or data ratio; bss is always stored at full size.

## Where the plugin gets each field (ELD)

- **Sections, sizes, kinds, source paths**: the input sections of each input file. Paths should be relative to the source root so the first two directories are the subsystem. Archive members can use `libfoo.a/member.o` style paths if no source path is known, though subsystem grouping is then by archive.
- **References**: the relocations of each input section, resolved to their target section. Section-relative relocations (section symbol plus addend) should be resolved to the section that actually holds the addend. References from discarded sections are still useful (they feed unused-island detection).
- **Eliminated flag**: read after garbage collection. Discarded COMDAT duplicates can be left out or emitted as eliminated.
- **Output section and final size**: read as late as possible, after layout and relaxation, so trampolines and relaxed sizes are final.
- **Roots**: the entry symbol, vector tables, and sections kept by `KEEP` in the linker script.
- **Addresses and alignment**: each input section's output address and alignment, read after layout at the same point as final sizes. Region starts and sizes come from the linker script's `MEMORY` block.
- **Hot**: not known to the linker. Add it from profiling or trace data if available, or from a list of hot functions.
