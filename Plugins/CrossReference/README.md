# CrossReference Linker Plugin

CrossReference builds a reference graph while ELD is linking and writes it to
an output file. Unlike the linker's traditional `--cref` table, which records
referencing input files, this plugin attempts to identify the symbol containing
each individual reference.

The plugin runs from `ActBeforeWritingOutput`, after garbage collection and
linker-generated stubs/trampolines have been created. It reads ELF input files;
bitcode/LTO inputs are not inspected.

## Build as part of ELD

Configure ELD/LLVM normally, then build the plugin target:

```sh
cmake --build build-eld --target CrossReference
```

The plugin-local tests are registered with ELD's normal `llvm-lit`
configuration. They cover text output, both JSON formats, DWARF lookup,
demangling, filters, garbage collection, gzip output, and multithreaded and
serial linking paths.

## Build standalone against an installed ELD package

Use the top-level Plugins directory, which can be copied outside the ELD
and LLVM source trees. A compatible host C++ compiler, the ELD public
development package, and zlib development files are required:

```sh
cmake -S /path/to/Plugins -B build-crossreference \
  -DBUILD_STANDALONE_PLUGINS=ON \
  -DELD_PACKAGE_ROOT=/path/to/target_tools \
  -DCMAKE_CXX_COMPILER=/path/to/host-clang++ \
  -DCMAKE_CXX_FLAGS="-stdlib=libc++" \
  -DELD_PLUGINS=CrossReference
cmake --build build-crossreference
```

CMAKE_CXX_COMPILER builds the host plugin, not the target test inputs.
Choose a compiler and C++ runtime compatible with the installed ELD ABI.
On Linux, the standalone framework automatically selects the package's host libc++
libraries for compiler probes and plugin links, avoiding accidental system
runtime selection. The host's default libc++ can introduce ABI or unwinder
dependencies incompatible with the ELD linker's packaged runtime, even if the
plugin links successfully. The framework does not select headers or embed
RPATH/RUNPATH; the loading environment must supply runtime library paths. See the
[runtime configuration guide](../README.md#package-c-runtime-libraries-linux).
CMAKE_CXX_FLAGS also applies during CMake's compiler checks. Both conventional
include/lib/bin installations and packages containing a Tools directory
are supported. See [the framework README](../README.md) for discovery
overrides and host platform limitations.

Tests are disabled by default. Enable package-only Python smoke tests in
the same build directory:

```sh
cmake -S /path/to/Plugins -B build-crossreference -DBUILD_TESTING=ON
cmake --build build-crossreference
ctest --test-dir build-crossreference --output-on-failure
```

This reuses the cached package and compiler settings. Test setup discovers
ELD_TARGET_CC, ELD_TARGET_CXX, and ELD_TARGET_LD in the package's bin directory,
preferring clang/clang++ with hexagon-clang/hexagon-clang++ fallbacks. Override
those paths when the target tools are elsewhere. ELD_TARGET_TRIPLE selects
the target architecture, ELD_TARGET_CXX_FLAGS adds flags for both target
compiler drivers, and ELD_TARGET_LD_FLAGS adds linker flags. CMake parses these
strings with the host's command-line syntax; quote paths with spaces and double
literal backslashes on Unix. These settings do not affect compilation of the
host plugin. Direct smoke runs accept repeatable `--target-cxx-arg=...` and
`--target-ld-arg=...` options without further shell splitting. See the
[framework test documentation](../README.md#standalone-tests) for JSON argument
arrays in direct lit invocations and platform validation limits.

The reference-count fixtures depend on target code generation. For ARM, use
`ELD_TARGET_TRIPLE=armv7a-none-eabi`; for Hexagon, use
`ELD_TARGET_CXX_FLAGS=-G0`. Older ARM instruction sets and Hexagon small-data
addressing can produce different relocation counts. For direct lit invocations,
the corresponding parameters are `-Dtarget_triple=armv7a-none-eabi` and
`-Dtarget_cxx_flags=-G0`. Also supply `-Dpython_executable=/path/to/python3`
when invoking lit directly; CMake supplies this automatically.

### Run the tests with an external llvm-lit

Add lit testing to the same build:

```sh
cmake -S /path/to/Plugins -B build-crossreference \
  -DBUILD_TESTING=ON \
  -DELD_ENABLE_LIT_TESTS=ON \
  -DELD_TARGET_TRIPLE=riscv64-unknown-elf \
  -DELD_LLVM_LIT=/path/to/llvm-package/bin/llvm-lit
cmake --build build-crossreference
ctest --test-dir build-crossreference --output-on-failure
```

Select a triple supported by the target tools. Plugins/lit.cfg derives the
lit architecture from ELD_TARGET_TRIPLE; ELD_TEST_TARGET overrides that
architecture if necessary. The configuration does not load eld/test/lit.cfg.
ELD_LLVM_LIT may be omitted when llvm-lit or lit is on PATH. FileCheck and not
must be in ELD_LLVM_TOOLS_DIR (default: beside the runner). LLVM libraries
default to the sibling lib directory; ELD_LLVM_LIBS_DIR overrides that path.
These tests do not require llvm-readelf.

The smoke test is ELDStandalone.CrossReference; the lit suite is
ELDStandaloneLit.CrossReference. Use `ctest -R` to select either.
For multi-configuration generators, build with `--config Release` and run
CTest with `-C Release`. The smoke script is kept at test/standalone_test.py.

When loading the plugin manually, include its output directory and the ELD
runtime library directory in LD_LIBRARY_PATH on Linux, DYLD_LIBRARY_PATH
on macOS, or PATH on Windows. CTest arranges these paths automatically.

## Configuration

The plugin is configured through a colon-delimited `key=value` option string.
The `file` option is required.

`symbol_details` controls optional symbol metadata.

```yaml
GlobalPlugins:
  - Type: LinkerPlugin
    Name: CrossReference
    Library: CrossReference
    Options: file=xref.txt:format=text:cpp_demangle=yes
```

The supported options are:

| Option | Default | Description |
| --- | --- | --- |
| `file=<path>` | required | Output file. Existing contents are replaced. |
| `format=text\|json\|json_columnar` | `text` | Selects the output format. |
| `gzip=yes\|no` | `no` | Compresses the selected output format as gzip and appends `.gz` to the output path. |
| `source_root=<path>` | unset | Removes this complete path prefix from object-file paths, DWARF paths, and dashboard paths. |
| `strip_prefix=<glob>` | unset | Removes the longest complete path prefix matching an LLVM glob. Mutually exclusive with `source_root`. |
| `coalesce_dirs=none\|unary` | `none` | In JSON formats, folds empty single-child directory chains after the first two path components. |
| `show_gc=yes\|no` | `no` | Includes garbage-collected symbols and edges in text output. |
| `cpp_demangle=yes\|no` | `no` | Demangles C++ names in output and name-pattern matching. |
| `symbol_details=none\|elf\|dwarf` | `none` | `elf` adds symbol records and attributed reference pairs to JSON. `dwarf` additionally looks up function and variable declaration locations in DWARF, and adds source locations to JSON and text. Text always emits its compact symbol catalog and edge table. |
| `fragment_details=none\|data\|all` | `none` | JSON-only logical initializer-fragment metadata. `data` records anonymous data-like targets referenced by data symbols; `all` also records known function containers. Requires `symbol_details=elf` or `dwarf`. |
| `exclude_symbols=<globs>` | unset | Comma-delimited name patterns. Matching symbols and their edges are omitted. |
| `exclude_files=<globs>` | unset | Comma-delimited patterns matched against resolved object-file paths. |
| `include_symbols=<globs>` | unset | If present, only symbols matching at least one pattern are retained. |
| `exclude_local=yes\|no` | `yes` | Omits local symbols, including static functions/data and generated labels. |
| `exclude_functions=yes\|no` | `no` | Omits `STT_FUNC` symbols and their edges. |
| `exclude_data=yes\|no` | `no` | Omits `STT_OBJECT` symbols and their edges. |
| `min_size=<bytes>` | `0` | Omits symbols smaller than this size and their edges. |
| `min_refs=<n>` | `0` | Omits symbols with fewer than this many incoming references and their edges. |
| `exclude_intra_file=yes\|no` | `no` | Omits edges whose caller and target have the same resolved input-file path. |

`yes`/`no` values are case-sensitive. Unknown options, duplicate `file`
options, malformed numbers or globs, missing `file`, and simultaneous
`source_root`/`strip_prefix` options are errors.

When `gzip=yes`, the plugin writes the serialized text or JSON output to
`<file>.gz`; the uncompressed file is not created. This applies to all three
output formats. For example, `file=xref.json:format=json:gzip=yes` writes
`xref.json.gz`.

### Path cleanup

`source_root` removes only a complete path component. For example,
`source_root=/build` removes `/build/` from `/build/project/a.o`, but does not
alter `/builder/project/a.o`. `source_root=/` removes a leading slash.

`strip_prefix` treats the value as an LLVM glob and tries path-component
prefixes, retaining the longest matching prefix. For example,
`strip_prefix=*/build/*` can remove a variable build-root prefix. The cleanup
is applied consistently to object paths, DWARF source paths, dashboard paths,
file-filter matching, and intra-file comparisons.

`coalesce_dirs=unary` is applied only to dashboard JSON paths. It preserves the
first two directory components, then folds a directory when it has no object
file directly beneath it and exactly one child directory. Folded components
are joined with `⟫`, so a path such as `modem_proc/core/a/b/c.o` may be emitted
as `modem_proc/core/a⟫b/c.o`. The JSON root also contains
`"coalesce_dirs":"unary"` so consumers can identify the display-oriented
path mode. Text output is unchanged.

### Filtering

Name patterns match the demangled name when `cpp_demangle=yes`, otherwise the
raw symbol-table name. A symbol is retained only if it passes all applicable
filters: it must satisfy `include_symbols` when specified, match no exclusion
pattern, not be excluded by its file, binding, type, size, or reference count.
Filtered symbols are also removed from text edges.

`min_refs` counts individual recorded relocations targeting a symbol, not the
number of distinct callers. The count is computed from the complete graph
before the other text filters are applied.

`exclude_intra_file` affects only text edges; both symbols remain in the symbol
catalog. An unattributed edge has no caller and is not considered intra-file.

The dashboard JSON formats are section-oriented and intentionally do not apply
the symbol filters, `show_gc`, or `exclude_intra_file`. They contain the
section graph independently of the text dump filters. `cpp_demangle` and path
cleanup still affect dashboard names and paths.

## C++ demangling

`cpp_demangle=yes` is independent of the selected `symbol_details` level. It changes
display names but preserves raw ELF names in `symbolDetails.linkageName` and
does not change DWARF name matching. Demangling adds CPU/allocation cost and
usually increases output size, especially for template-heavy C++. Results are
not cached across uses: section naming, symbol serialization, and text name
filtering can demangle the same symbol again. Section naming runs in parallel;
serialization is serial. Keep the default `cpp_demangle=no` for lowest overhead.

## Parallel work

When ELD is multithreaded, the plugin uses the Plugin API thread pool for
independent input-file work: symbol collection, dashboard section discovery,
relocation/reference walking, and per-file DWARF indexing. Stub discovery and
per-chunk symbol sorting are also partitioned into independent tasks. The pool
is reused across phases and uses a bounded number of worker tasks that claim
work dynamically, which avoids creating one scheduler task per input item.
Each worker builds private results, which are merged deterministically, so text
and JSON output remains stable. With `--no-threads` (or a single configured
thread), the same code executes directly without creating a worker pool.

The plugin avoids symbol-level attribution for JSON unless `symbol_details=elf`
or `symbol_details=dwarf` is selected. No DWARF reader is constructed unless
`symbol_details=dwarf` is selected.
Repeated references are aggregated while they are walked, and repeated
dashboard file paths and output-section names are interned. JSON serializers
stream directly to the output stream; gzip output avoids an additional complete
copy of the compressed payload. Text edge aggregation uses compact integer IDs,
and the referrer index is stored as one contiguous symbol array with per-chunk
ranges instead of one separately allocated vector per chunk. When DWARF is
enabled, only names belonging to exported symbols are indexed (with text filters
applied in text mode). Reference walking and DWARF work use batches bounded by
twice the worker count. Each DWARF worker owns and releases its object reader and
temporary name index; debug contexts are not accumulated in the linker cache.
Source paths are interned and symbol locations store numeric file IDs. The
optional symbol/reference tables necessarily add memory proportional to their
exported records; use ordinary JSON when only section accounting is needed.

The plugin records timers for each major phase. They are visible when ELD
timing statistics are enabled, for example with `--emit-timing-stats` and an
appropriate `--time-region` selection.

## Reference graph construction

For every usable relocation/`Use`, the plugin identifies the source chunk and
the target symbol. The source reference is attributed as follows:

1. If the relocation offset is within a symbol's
   `[symbol_offset, symbol_offset + symbol_size)` range, the attribution is
   exact.
2. Otherwise, the nearest preceding symbol in the same chunk is selected and
   marked approximate. This handles symbols with missing or unreliable size
   information, such as hand-written assembly without `.size` directives.
3. For a relocation in a non-code section, if no preceding symbol exists but
   the section has a primary object symbol, that data symbol is used and the
   reference is marked approximate. This covers data structures such as
   vtables whose relocation can precede the symbol's recorded range.
4. If no usable source symbol exists, the reference is unattributed.

Every relocation contributes one reference. Repeated references between the
same endpoints are aggregated and reported with a count.

References through linker-generated branch-island/stub symbols are rewritten to
the real target and receive the `trampoline` flag. The synthetic stub itself is
not reported as an intermediate edge.

The plugin does not require `-ffunction-sections` or `-fdata-sections` for the
symbol-level text graph. Those options are useful when the dashboard's
input-section nodes should correspond closely to individual function and data
symbols.

Garbage-collected sections are still scanned so the pre-GC connectivity graph
can be recovered. In text output, they are omitted by default. With
`show_gc=yes`, they are included and their address is printed as `?` because
they never received a final address. Dashboard JSON always retains dead input
sections and marks them as not live.

## Text output schema

The text format is tab-delimited and contains a symbol catalog followed by an
edge table. The header comments are also a legend:

```text
# Symbols: <id>\t<name>\t<file>\t0x<size>\t<address>\t<output-section>
#   '?' address means garbage-collected; section is the linked output section.
#   with symbol_details=dwarf, source appears after the name as (file:line).
<id>\t<name>\t<object-file>\t0x<size>\t<address>\t<output-section>

# Edges: <src-id>\t<dst-id>\t<count>\t<flags>
#   '-' source means unattributed; '-' flags means none; flags: approx, unattributed, trampoline.
<src-id>\t<dst-id>\t<count>\t<flags>
```

Symbol IDs are local to the dump. The symbol name may be followed by
`(source-file:line)` when DWARF lookup succeeds. A `-` source ID denotes an
unattributed reference. Multiple flags are comma-delimited; flags are combined
when references aggregate into the same edge.

Example:

```text
# Symbols: <id>\t<name>\t<file>\t0x<size>\t<address>\t<output-section>
#   '?' address means garbage-collected; section is the linked output section.
#   with symbol_details=dwarf, source appears after the name as (file:line).
0\tmain\tapp.o\t0x20\t0x1000\t.text
1\tfoo\tlib.o\t0x10\t0x1020\t.text
# Edges: <src-id>\t<dst-id>\t<count>\t<flags>
#   '-' source means unattributed; '-' flags means none; flags: approx, unattributed, trampoline.
0\t1\t2\t-
```

## Dashboard object JSON (`format=json`)

This format contains one node for each allocatable, non-discarded ELF input
section. If a section has a suitable function or object symbol, that symbol is
used as the node name; otherwise the input section name is used.

When enabled, the JSON root also contains `"coalesce_dirs":"unary"`. Node
`path` values use `⟫` inside a directory component to show folded path levels.

```json
{
  "nodes": [
    {
      "id": 0,
      "name": "main",
      "path": "app.o",
      "kind": "code",
      "size": 32,
      "out": ".text"
    },
    {
      "id": 1,
      "name": "constants",
      "path": "data.o",
      "kind": "rodata",
      "size": 16,
      "live": false
    }
  ],
  "edges": [
    {"src": 0, "dst": 1, "count": 2}
  ]
}
```

Node fields:

- `id`: numeric node ID.
- `name`: primary symbol name or input-section name.
- `path`: cleaned input object-file path.
- `kind`: one of `code`, `rodata`, `data`, or `bss`.
- `size`: input-section size in bytes.
- `out`: linked output-section name, when available.
- `live`: present as `false` for garbage-collected sections; omitted for live sections.
- `root`: present as `true` for live sections retained by a linker-script `KEEP` rule.

Each JSON edge contains `src`, `dst`, and `count`. It represents aggregated
references between two different input sections. Section-level edges include
dead sections and are independent of text symbol filtering.

## Dashboard columnar JSON (`format=json_columnar`)

The columnar format has this top-level shape:

```json
{
  "format": "fia-columnar",
  "version": 1,
  "strings": {
    "dirs": [[-1, "build"], [0, "src"]],
    "files": [[1, "app.o"]],
    "outs": [".text"]
  },
  "sections": {
    "count": 1,
    "size": [32],
    "file": [0],
    "out": [0],
    "kind": [0],
    "flags": [0],
    "name": ["main"]
  },
  "refs": {
    "offsets": [0, 0],
    "targets": [],
    "counts": []
  }
}
```

With `coalesce_dirs=unary`, the top-level object additionally contains
`"coalesce_dirs":"unary"`, and folded directory components in
`strings.dirs` use `⟫` between their original names.

`strings.dirs` contains `[parent_directory_id, name]` entries, with `-1`
meaning no parent. `strings.files` contains `[directory_id, basename]` entries.
`strings.outs` is the output-section string table.

The arrays in `sections` are parallel and indexed by section ID:

- `count`: number of sections.
- `size`: section sizes in bytes.
- `file`: IDs into `strings.files`.
- `out`: IDs into `strings.outs`; `-1` means no output-section name.
- `kind`: numeric kind, `0=code`, `1=rodata`, `2=data`, `3=bss`.
- `flags`: bit mask: bit `0x1` means dead/not live; bit `0x2` means linker-script root.
- `name`: node names.

The `refs` arrays use compressed sparse-row adjacency. For source section `i`,
the entries from `offsets[i]` through `offsets[i+1]` refer to target IDs in
`targets` and matching reference counts in `counts`. `offsets` therefore has
`sections.count + 1` entries.

## DWARF source locations

With `symbol_details=dwarf`, the plugin reads both `DW_TAG_subprogram` and
`DW_TAG_variable` DIEs using an object-aware public Plugin API reader that
resolves debug relocations. Ordinary `-g`, including DWARF 4 and 5, is supported;
inline debug strings are not required. Linkage names identify C++ symbols;
plain names provide the fallback for C. Name matching is scoped to each input
file. Equal-rank conflicting declaration locations are omitted, not guessed.
Missing debug info or an alias without its own matching DIE yields no location.
If no declaration locations are recovered, `symbol_details=dwarf` falls back
to the `symbol_details=elf` JSON schema: it emits no empty source table or
source columns.

Locations are **declarations, not instruction/call-site lines**. They appear
after the text symbol name as `(file:line)` and in JSON `symbolDetails`.
`source_root` and `strip_prefix` clean both object and DWARF paths. DWARF cannot
reconstruct arbitrary names removed by obfuscation. Containing-symbol and
nearest-symbol attribution still describe static relocations, not dynamic calls.

## Optional JSON symbol details (version 1)

`symbol_details=elf` adds a top-level `symbolDetails` object without changing
section nodes, sizes, or aggregated section edges. `symbol_details=dwarf`
additionally includes source locations when they are recovered; otherwise its
JSON output falls back to the `elf` detail schema. For example:

```yaml
Options: file=xref.json:format=json_columnar:symbol_details=dwarf:strip_prefix=*/src/:gzip=yes
```

Both JSON formats use the following fields:

| Table / field | Meaning |
|---|---|
| `version` | Extension version, currently 1; outer columnar version stays 1. |
| `sourceFiles` | Interned, cleaned source paths, present only when `symbol_details=dwarf` recovers at least one location. |
| `symbols.id` | Export-local symbol ID (implicit array index in columnar format). |
| `symbols.section` | Owning section ID from the ordinary section graph. |
| `symbols.chunk` | Export-local chunk ID; symbols in the same chunk share it. |
| `symbols.name`, `linkageName` | Display name (honors `cpp_demangle`) and raw ELF name. |
| `symbols.offset`, `size` | Chunk-relative offset and symbol size in bytes. Not a section-relative offset or final address. |
| `symbols.flags` | Bit mask: 1 local, 2 weak, 4 function, 8 object/data. |
| `symbols.sourceFile`, `sourceLine` | Index into `sourceFiles` and declaration line; omitted when no DWARF locations are recovered. |
| `refs.sourceSection`, `targetSection` | Section IDs, retained even when an endpoint symbol is unavailable. |
| `refs.src`, `dst` | Symbol IDs, or -1 when unavailable. |
| `refs.count` | Aggregated static relocation count for this section/symbol pair. |
| `refs.flags` | Bit mask: 1 nearest source-symbol approximation, 2 unattributed source, 4 trampoline, 8 nearest target-function approximation. Tags are unioned when aggregating. |

In `format=json`, `symbols` and `refs` are arrays of objects with these fields.
Missing source locations omit `sourceFile` and `sourceLine`. In
`format=json_columnar`, both are objects of parallel arrays; `symbols.count`
gives the number of symbols. Source columns are present only when
`symbol_details=dwarf` recovers at least one location; then missing individual
locations use `sourceFile=-1`, `sourceLine=0`.

Detailed references include same-section and self-symbol pairs, unlike the
section graph. For a relocation that names a code section instead of a function,
the plugin combines its target symbol offset and relocation addend, then searches
only that target chunk's ELF function ranges. A containing range fills `dst`
exactly; a preceding function is retained only with flag 8. Negative, overflowed,
or otherwise unresolvable target offsets remain `dst=-1`. This is ELF-only
attribution: DWARF declaration locations enrich the resolved function under
`symbol_details=dwarf`, but ambiguous DWARF PCs never fabricate a target symbol.
Symbol records include locals and GC'd sections independently of text filtering
options. Aliases can share ranges: **never sum symbol sizes to calculate
footprint**. Continue using section sizes, and treat symbol details as inspection
metadata. Neither IDs nor the chosen alias for range attribution are persistent
identities across builds.

### Optional initializer fragments

`fragment_details=data` adds `initializerFragments` inside `symbolDetails`.
It records anonymous data-like target sections referenced by known data symbols
without changing the section graph or pretending that a target has an ELF
symbol. `fragment_details=all` additionally records references from known
function symbols. Both JSON formats use a version-1 `refs` table with
`container` (symbol ID), `targetSection` (section ID), `class`, relocation
`count`, and `ownerCount`. Classes are 1 string literal, 2 numeric constant, 3
const data, 4 relocatable const data, 5 read/write data, and 6 zero-init data.
A target with `ownerCount > 1` is shared; consumers must retain its physical
bytes only once. This option requires JSON output and
`symbol_details=elf` or `symbol_details=dwarf`.
