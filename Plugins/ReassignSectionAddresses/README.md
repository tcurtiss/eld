# ReassignSectionAddresses

ReassignSectionAddresses is an `OutputSectionIteratorPlugin` example that
assigns an absolute address to every object symbol in selected output
sections. It is intended for bookkeeping sections such as `DSECT`, `COPY`,
`INFO`, or `OVERLAY`; the assigned range is not loaded as ordinary image data.

Address assignment runs after layout, when output sections and symbol contents
are known. On Hexagon, relocation callbacks first identify and claim references
to selected strings, before ELD allocates GOT entries or dynamic relocations.
Callbacks run in ELD's serial prepass. Either operand's callback validates and
claims a complete immediate pair; the other callback does not repeat that work.

## References to assigned IDs on Hexagon

When code passes a string's assigned address as an ID, a function-local
`static const char fmt[]` in `.dedup` can be used in either C or C++ without an
assembly macro. Its bytes must not be dereferenced at the assigned address.
`-Wa,--reloc-section-sym=none` is no longer required: the plugin records original
object-symbol extents and resolves section-symbol-plus-offset references to
their containing string. Ordinary, non-mergeable named arrays with nonzero ELF
symbol sizes are required for this attribution; stripping the input symbol
table prevents it. The preservation flag remains supported when desired.
Select output sections through explicit linker-script rules (as with `DSECT`),
so their membership is known before relocation scanning. Late orphan-section
assignment is diagnosed if the original symbols could not be indexed.
For section-relative references, the offset must lie inside a sized object.
Preserve named-symbol references when one-past or otherwise out-of-object
offsets are intentional: a section offset alone cannot distinguish such an
expression from a reference to an adjacent object.

For shared-library code, retain `-fpic` or `-fPIC`. PIE executables can use
`-fpie` or `-fPIE` and link with `--pie`. The plugin recognizes the
immediate-extender plus `Rd = add(pc, ...)` sequence referencing a non-preemptible
selected symbol and rewrites it to `Rd = ##assigned_value`. The two-word sequence
remains eight bytes, with no additional GOT entry, runtime relocation,
or memory load. Genuine symbol offsets are preserved. This prevents the
library's load bias from being added to the ID. No additional plugin option is
needed; the same rewrite also works in fixed-address executables.

The same mechanism converts supported `immext + memw(...@GOT)` address loads
to immediate transfers, avoiding the selected string's GOT slot. `R_HEX_32`
pointer initializers receive the assigned value plus their genuine interior
offset directly, with no dynamic relocation or load-bias adjustment. A global,
default-visible array of such pointers keeps its own GOT references and
interposition behavior; its entries do not require GOT slots for the strings.
Unrelated GOT entries and dynamic relocations are unchanged.

This requires the public `LinkerWrapper::claimUse`, `isSymbolPreemptible`, and
`setSymbolAddress` APIs in both the build SDK and the runtime ELD package.
The SDK and runtime must implement the updated ownership contract: serial
pre-scan callbacks, claims outside a use's own callback, and validation that
every surviving claim receives replacement data before relocation application.
There is no compatibility path for the earlier callback-only ownership behavior.
The standalone CMake checks verify API declarations, not these runtime semantics.
`claimUse` is generic; section selection, symbol attribution, instruction
validation and byte encoding reside in this plugin. Claimed operands are omitted
from `--emit-relocs`, because their final bytes no longer need relocation.
GC dependencies are preserved and debug relocations are not claimed.
Each claimed Use receives its own final replacement bytes after layout. A
failed claim or replacement write fails the link. Claims need not be made from
that Use's own callback, but must finish before ELD starts target scanning;
the output-section `BeforeLayout` hook is already too late to claim.

Supported instruction forms include extended transfers, immediate stores,
`combine` with an extended first immediate, register/immediate `combine`, and
upper-half duplex transfers, as well as the PC/GOT forms above. Unsupported
selected-target relocations, malformed or overlapping pairs, ambiguous symbol
extents, missing symbols, and address-plus-offset overflow are errors rather
than silently incorrect IDs. Selected strings must be non-interposable (local,
hidden, protected, or otherwise locally bound). Plugin-enabled partial links
(`-r`) are rejected on every target, before address assignment or artifact
generation. Perform partial links without this plugin, then enable it only at
the final link. Other targets retain their existing relocation behavior; they
do not gain Hexagon's instruction rewrite or its protection against relaxation
based on placeholder addresses. Disable relaxation for affected address-taking
code where necessary. This does not dereference or execute IDs.

## Options

Options are colon-delimited `key=value` pairs. When an option accepts more
than one value, its value list remains comma-delimited:

| Option | Default | Description |
| --- | --- | --- |
| `section=<name>[,<name>...]` | required | Output sections to process. |
| `hash=md5\|sha1\|seq` | `md5` | Address assignment mode. |
| `seq_start=<value>` | `0` | Starting address for `hash=seq`; accepts a complete unsigned 32-bit decimal, hexadecimal, or octal integer. |
| `exclude_range=<low>-<high>[,<low>-<high>...]` | none | Inclusive ranges of assigned IDs to reserve. Bounds are unsigned 32-bit decimal or hexadecimal values, with `low <= high`. Sequential IDs skip ranges; MD5/SHA1 try overlapping 32-bit digest slices in 8-bit steps. |
| `output_format=csv\|json[,csv\|json...]` or `output_format=none` | `none` | Selects one or both mapping formats, e.g. `output_format=csv,json`. Writes one `.<output_suffix>.csv` and/or `.<output_suffix>.json` per image containing all modified sections. `none` disables mapping output. |
| `output_suffix=<name>` | `reassign` | Filename component used for every mapping/debug output: `<output-file>.<output_suffix>.csv`, `.json`, or `.debug.json`. |
| `gzip=yes\|no` | `no` | Compresses every generated mapping and debug file and appends `.gz`; does not create the uncompressed files. |
| `debug=yes\|no` | `no` | Writes one `<output-file>.<output_suffix>.debug.json`, grouping every modified symbol's assigned/original address, name, raw bytes, and relocation provenance by output section. Independent of mapping output and linker tracing; compressed when `gzip=yes`. |
| `clean_strings=yes\|no` | `no` | In CSV/JSON mapping string fields only, retains printable ASCII and tabs, removes CR/LF and other control/non-ASCII bytes, and trims trailing whitespace. Tab runs are not collapsed. |

Example plugin configuration:

```yaml
GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.dedup:hash=md5:output_format=csv,json:gzip=yes:debug=yes
```

ELD plugin configuration files are YAML and accept `#` comments on their own
lines or after a value. Keep comments outside the quoted `Options` string;
the plugin receives it as a single colon-delimited string, not individual YAML
option keys. Both in-tree and standalone builds copy the fully annotated
[`ReassignSectionAddresses.yaml`](ReassignSectionAddresses.yaml) beside the
built plugin library. Copy it elsewhere before customizing it, since rebuilding
refreshes the build-directory copy. Replace its `.dedup` section with your
linker-script output section name, and load it with:

```sh
ld.eld ... -L <plugin-directory> --plugin-config <your-config.yaml>
```

In sequential mode (`hash=seq`), identical symbol contents share one address
across all selected sections. In MD5 and SHA1 modes, the address is derived from the
symbol bytes. The plugin still leaves the original bytes in the output; it
does not physically merge sections or symbols.

Repeated `section=` keys append names in their first-seen order; duplicate names
are processed once, and empty names are errors. Other repeated keys use their
last value. Unknown hash names select MD5; unknown keys and malformed fields
are ignored, with details printed when plugin tracing is enabled.

MD5 and SHA1 hash the full symbol bytes, including a trailing NUL. Sequential
deduplication omits one trailing NUL, as the mapping string does, and its 32-bit
counter wraps after `0xffffffff`, skipping excluded ranges after wrapping too.
Every mode checks assigned IDs across all selected sections in this plugin
invocation. Identical contents may share an ID. A hash collision with different
original symbol bytes tries higher-order slices of the same digest, while
sequential reuse for different normalized contents fails the link. Mapping
deduplication therefore never hides distinct-content ID collisions. Cleaning
rendered strings does not affect identity or address selection.

### Reserved ID ranges

For example:

```text
section=.dedup:hash=md5:exclude_range=0x1234-0x4567,100-200,0xffff0000-0xfffffff0
```

Both endpoints are excluded; a single value can be reserved with `100-100`.
Decimal bounds with leading zeros remain decimal, and hexadecimal bounds accept
`0x` or `0X`. Bounds may have surrounding whitespace. Empty, malformed, reversed,
negative, or greater-than-32-bit bounds fail the link. Lists can be unsorted;
overlapping and adjacent ranges are merged. Repeated `exclude_range=` keys use
the last list. A list covering all `0` through `0xffffffff` values is an error.

With `hash=seq`, the next distinct content gets the next non-excluded ID. If the
counter is inside a range, it jumps directly to one past the inclusive high
bound, wrapping to zero when necessary. Identical normalized contents still
reuse their first assigned ID across all selected sections. Exclusions reduce
the number of available distinct sequential IDs. Wrapping is permitted while
the next non-excluded ID has not yet been assigned; trying to reuse an assigned
ID for new content fails the link. Repeated contents remain valid after wrap.

MD5/SHA1 first try their existing lower-32-bit ID. If excluded or assigned to
different original bytes, the plugin slides a 32-bit window toward higher-order
bits in **8-bit increments**, without rehashing the contents:

```text
candidate_i = (digest_value >> (8 * i)) & 0xffffffff
```

For MD5, the 16 digest bytes are interpreted little-endian: the windows cover
bytes `[0:4]`, `[1:5]`, ... `[12:16]`, each decoded little-endian. This gives
13 candidate positions at bit offsets 0, 8, ... 96. For SHA1, the 20 digest
bytes are interpreted big-endian: windows cover `[16:20]`, `[15:19]`, ... `[0:4]`,
each decoded big-endian. This gives 17 positions at offsets 0, 8, ... 128.
Windows overlap; repeated candidate values are possible. No window wraps around
or reads beyond the digest. This preserves existing first-choice IDs when they
are neither excluded nor conflicting. If every slice is
excluded or belongs to different contents, the link fails with a symbol-specific
diagnostic rather than inventing an ID or silently accepting a collision.
Identical bytes reuse the same chosen ID, including after fallback. Selection
is deterministic in final section/rule/chunk/symbol order and independent of
thread count. When distinct contents collide, whichever is encountered first
keeps the earlier usable slice, so changing input or section order can change
collision-resolved IDs. The scope is one plugin invocation, not separate images
or independently configured plugin instances.

Exclusions apply to assigned symbol IDs, not to an interior-reference offset
subsequently added to an ID. Rewritten references and CSV/JSON/debug outputs all
use the selected ID; file formats and output naming are unchanged.

### Combined CSV and JSON mappings

All output paths retain the full linker output filename, including its
extension. `output_suffix=reassign` is the default. Set, for example,
`output_suffix=string_ids` to produce `image.so.string_ids.csv`,
`image.so.string_ids.json`, and `image.so.string_ids.debug.json` when enabled.
`gzip=yes` appends `.gz` to each. The suffix must be nonempty and contain no
path separators or control bytes; it changes filenames only, not file contents.
Repeated `output_suffix=` keys use the last value.

`output_format=csv` writes one `image.so.reassign.csv` beside linker output
`image.so`, containing all modified sections. The first column is the original
output section name (including a leading dot, if present). CSV includes a
header, CRLF record endings, and addresses formatted as `0xXXXXXXXX` (eight
zero-padded uppercase hexadecimal digits). Section and string fields are quoted;
embedded double quotes are doubled, and commas, CR/LF, and other bytes are
preserved unless string cleaning is enabled. One trailing NUL is omitted from
each mapping string.

```csv
section,address,string
".dedup",0x00000100,"format string"
".other_strings",0x00000101,"a comma, and ""quotes"""
```

`output_format=json` writes one `image.so.reassign.json`. The version-1 object
contains `schema_version`, `plugin`, `output_file`, and a `sections` array.
Each section has its original `section` name and an `entries` array containing
the same address/string pairs as CSV. JSON addresses are decimal numbers,
not strings:

```json
{
  "schema_version": 1,
  "plugin": "ReassignSectionAddresses",
  "output_file": "image.so",
  "sections": [
    {
      "section": ".dedup",
      "entries": [{"address": 256, "string": "format string"}]
    }
  ]
}
```

Both formats follow configured section order and symbol assignment order.
Duplicate addresses are written once **within each section**; a shared address
in two sections appears in both sections' mappings. Absent sections and sections
with no modified object symbols are omitted. No mapping file is created when
there are no modified symbols. `output_format=none` (the default) disables mapping
output without disabling address assignment or detailed debug JSON.

Use `output_format=csv,json` (or `output_format=json,csv`) to generate both
mappings in the same link. Duplicate formats are ignored. `none` must appear
alone; unknown formats and empty list items are errors. Repeated
`output_format=` keys replace the previous selection, as with other non-list
options.

`gzip=yes` applies to **every generated file**, including debug JSON. For
`output_format=csv,json:debug=yes:gzip=yes`, the files are:

- `image.so.reassign.csv.gz`
- `image.so.reassign.json.gz`
- `image.so.reassign.debug.json.gz`

Gzip does not create uncompressed files or remove existing ones. Both mappings
are emitted from the same assignment pass. Mapping entries and debug JSON are
streamed; each compressed file uses a fixed-size 64 KiB output buffer rather
than buffering the entire document.

Set `clean_strings=yes` when mapping content may contain terminal control
characters or non-ASCII bytes. Leading/internal spaces and tabs are preserved
exactly, including tab runs. CR/LF and other non-printable bytes (except tabs)
are removed; trailing spaces and tabs are trimmed, including those preceding
removed bytes. For example, `"\tA\t\tB \t\r\n"` becomes `"\tA\t\tB"`.
This affects CSV/JSON mapping strings only: address assignment and detailed
debug JSON continue to use original bytes.
Without cleaning, CSV may contain non-text bytes; read it using a byte-preserving
encoding. JSON escapes controls and non-ASCII bytes as `\u00XX`, mapping each
byte to U+0000–U+00FF rather than assuming UTF-8. Encoding a decoded JSON string
as Latin-1 recovers the same bytes as the CSV field. Section names are never
cleaned.

### Combined symbol and relocation debug JSON

Set `debug=yes` to inspect every modified symbol and the work performed on
its plugin-owned relocations, even when `output_format=none`:

```yaml
    Options: section=.dedup:hash=md5:debug=yes
```

For output `image.so`, this writes one `image.so.reassign.debug.json`
containing all modified sections (or `.reassign.debug.json.gz` with
`gzip=yes`). The version-3 JSON object contains `schema_version`, `plugin`,
`output_file`, and
a `sections` array. Each section entry has its original `section` name and
a `symbols` array. Section names are preserved exactly, without filename
normalization; names such as `.dedup` and `dedup` remain distinct. Sections
without modified symbols are omitted, and no debug file is created if no
symbols were modified.

Each symbol has `symbol`, `input_file`,
`input_section`, `assigned_address`, `original_address`, `raw_bytes`, and
`relocations`. Raw bytes are hexadecimal and include any trailing NUL;
original addresses are captured before reassignment. All modified symbols are
included, including duplicate-content symbols and symbols whose relocation
arrays are empty. Same-named local symbols from different inputs are kept
separate. Section entries follow the configured section order.

Each nested relocation array contains one record per claimed use associated
with that symbol (both halves of an immediate-extender pair have separate
records). Each record contains:

- `source`: input file/section, chunk-relative byte offset, final source
  address, and output section.
- `original`: compiler relocation type/name, symbol, signed addend, and
  original four-byte operand data.
- `target`: original input file/section and output section, resolved object
  symbol, signed interior offset, and assigned absolute address.
- `transformation`: `pc-relative-to-absolute`, `got-load-to-absolute`,
  `absolute-immediate-update`, or `absolute-pointer-initializer`.
- `value`: assigned address plus the interior offset; `replacement_data`:
  the encoded four-byte operand supplied to ELD.

Numeric fields are JSON integers; offsets are bytes and operand data is decoded
little-endian. Symbols follow assignment order, and each symbol's relocation
records are sorted deterministically across serial/parallel linking. Debug
JSON replaces neither the ELF relocation table nor the CSV; it documents why
the consumed uses are absent from `--emit-relocs`.
Unchanged relocations and debug-information relocations are not included.

Mapping and debug outputs default to off and leave existing artifacts untouched
when disabled. Absent sections or sections with no modified object symbols produce
no artifacts. With `debug=yes`, files are replaced after address assignment
and reference encoding. Failure to open/write/close any enabled artifact fails
the link. A later link failure can leave diagnostic artifacts, so their
presence alone does not prove that ELF output completed successfully.

## Threading and memory usage

The plugin honors ELD's thread count; `--no-threads` keeps plugin work serial.
On Hexagon final links, reference attribution builds one original extent index.
Final assignment reads each relevant input's live symbol table once and validates
the selected objects against that index. This final read is required to catch
objects defined or moved into an already-indexed chunk by another plugin;
iterating only cached entries would silently omit them. Once attribution has
begun, late additions, moves into selected chunks, and extent changes are errors.
Surviving references whose target is no longer selected also fail the link.
Discarded sources do not require rewrites. Sequential IDs retain final
section/rule/chunk order and input local-before-global symbol order, not sorted
extent order. Other targets keep their normal final-assignment enumeration.
Symbol address changes and replacement-data submission remain serial in this
plugin. ELD now supports thread-safe replacement submission, including map
logging, but that guarantee does not extend to `setSymbolAddress` or all other
plugin APIs.

MD5/SHA1 process borrowed input blocks with a fixed 128-byte padding buffer,
without allocating or copying a symbol's contents. Sequential deduplication
also borrows content keys. Hash jobs share one lazily created pool at ELD's
configured capacity. Work is batched (up to 32 symbols per batch); fewer than
256 symbols totaling less than 64 KiB are hashed serially to avoid scheduling
overhead. These are conservative thresholds, not a guarantee of speedup for
every image or host. Hash workers retain the full digest words for the current
section; global collision checks and ID reservations run serially in assignment
order, without rehashing contents or adding worker locks. The ID-to-content
registry borrows original byte views, and sequential mode also retains a
content-to-ID index. Both registries and their buckets are released once all
sections are assigned, before reference rewriting and output.

Relocation callbacks discard non-runtime sources and unselected targets before
initializing the target inventory, after symbol resolution and GC. Source-use
indices are built once per relevant chunk. Pair validation checks both storage
fields for duplicates and overlaps before either is claimed. Collection needs
no mutexes, atomics or once-flags because callbacks are serial. Extent, direct
symbol, pair and source-use indices are released, including their hash-table
buckets, after final validation and before hashing/output. No relocation
workers are launched. Runtime code size and generated instruction forms are
unchanged.

After assignments and reference encoding, enabled CSV, JSON and debug files
can be rendered/compressed concurrently, with exactly one writer per file.
Writers consume frozen metadata and borrowed symbol bytes, not mutable linker
state. Memory scales with compact per-symbol/per-relocation indices and mapping
entries, rather than rendered file sizes. Debug records share original
file/section snapshots per chunk and names per symbol; they do not copy those
strings per relocation. Final output membership and relocation-type names are
also snapshotted once per chunk/type before writers start. Each gzip writer
has a fixed 64 KiB buffer. Raw debug bytes are streamed as hex without an
intermediate full-size hex string. All writers finish before errors are reported
in deterministic format-list order. File content and address assignment order
are unchanged by thread count.

`ReassignHashBoundaries.test` checks binary contents, an empty symbol, MD5/SHA1
padding boundaries and large symbols against Python's hashes.
`ReassignExcludeRanges.test` checks range syntax, inclusive endpoints,
normalization, every byte-shifted slice and exhaustion, sequential
skips/wraparound, deduplication, symbol values and mapping/debug consistency.
`ReassignExcludeRangesThreading.test` forces two-slice hash fallback across
1,024 symbols and verifies rewritten references and all output formats with
serial/parallel hashing and gzip.
`ReassignCollisions.test` uses real MD5/SHA1 collisions at word/byte boundaries
and the final slice to check
within/cross-section fallback, excluded alternatives, duplicate reuse, reversed
section order, disabled outputs and exhaustion. It also checks sequential wrap
with unused IDs, duplicate reuse after wrap and cross-section exhaustion.
`ReassignCollisionsThreading.test` checks real lower-word collisions and repeated
contents across input files/sections, including rewritten references, gzip and
all outputs under serial/parallel hashing.
Binary CSV checks compare exact encoded records rather than using
`csv.reader`, so embedded NUL bytes remain covered on Python 3.10 and older.
`ReassignThreading.test` uses 16 independent inputs, repeated local names,
1,024 selected symbols, selected and unrelated relocations, and two sections.
It compares serial and 1/2/4/8-thread images, CSV/JSON/debug contents, and gzip
output for all three hash modes, and checks replacement bytes in the ELF.
`ReassignReferenceRewrite.test` additionally checks low-first PC-relative,
absolute and GOT pairs, missing/overlapping partner operands, and sequential
assignment whose input symbol order differs from its offset order.
`ReassignSymbolInventory.test` uses a test-only cooperating plugin to define
objects through `resetSymbol()`: early definitions participate in reassignment,
while late definitions in populated or initially empty indexed chunks are
diagnosed before any mapping/debug output. `ReassignPartialLink.test` checks
rejection of plugin-enabled `-r` and the supported partial-then-final workflow.

## Build as part of ELD

Configure ELD/LLVM normally, then build the plugin target:

```sh
cmake --build build-eld --target ReassignSectionAddresses
```

The plugin-local tests cover sequential, MD5, SHA1, duplicate-content,
diagnostic, and gzip behavior. Run them with the configured ELD `llvm-lit`
driver, or run the plugin test target provided by the ELD build.

### Hexagon local-string address tests

`ReassignSectionAddressesHexagonPIC.test` provides a small, explicit
disassembly example. The six `ReassignLocalStrings*.test` cases add a broader
C/C++ matrix, driven by `test/Inputs/check_address_patterns.py`:

| Output | Compilation | Optimization levels |
| --- | --- | --- |
| Fixed-address executable (`--static`) | `-fno-pic` | `-O0`, `-O2`, `-Oz` |
| Fixed-address executable (`--static`) | `-fpic`, `-fPIC` | `-O0`, `-O2`, `-Oz` |
| Shared library (`--shared`) | `-fpic`, `-fPIC` | `-O0`, `-O2`, `-Oz` |
| PIE executable (`--pie`) | `-fpie`, `-fPIE` | `-O0`, `-O2`, `-Oz` |

Each combination runs with sequential, MD5, and SHA1 assignment, two layout
addresses, and serial/parallel linking: 504 links across both languages.
Sequential cases include zero, crossing the high-bit boundary, and wrapping
from `0xffffffff` to zero. The source fixtures exercise:

- Array decay, `&array`, `&array[0]`, interior addresses, pointer and integer
  returns, pointer and integer call arguments, and two strings in one call.
- Variadic calls, indirect calls through a function pointer, and passing the
  string address as a stack argument after exhausting the argument registers.
- Repeated logging macros, GNU statement expressions, nested scopes reusing
  a local name, repeated references to one string, and volatile pointer-value
  stores. Strings are never dereferenced at their assigned addresses.
- Duplicate contents across translation units and two `(DSECT)` sections,
  empty strings, embedded NULs, inline functions, and C++ templates/lambdas.

The checker reads the original object symbols and bytes, independently checks
hash values, and locates every address operand using the input relocations.
It checks linked immediate values, omission of claimed relocation records,
unchanged function sizes, and byte-identical serial/parallel images. A normal
non-DSECT string is a negative control. DSECT sections must be non-allocated
and outside every `PT_LOAD` file range, with no dynamic relocations in these
self-contained images. Non-PIC immediate stores, `combine`, and duplex
instruction forms are checked as well as the PIC rewrite.

The fixtures also check `__PIC__`/`__PIE__` at compile time to verify the
requested small/large model. PIE output must have `ET_DYN`, `DF_1_PIE`, a
dynamic segment, and the requested entry point; shared libraries must not
have `DF_1_PIE`. Merely linking PIC objects into a fixed-address executable
does not count as PIE coverage. Claimed operands are absent from
`--emit-relocs`, so the checker locates their instruction operands from the
original input relocations for every output mode.

These tests require Hexagon, `llvm-readelf` with JSON output, `llvm-objdump`,
and an ELD build containing the rewrite. They run through the same lit
configuration in source-tree and standalone builds; no target headers or
runtime libraries are required. A small assembly fixture supplies the restore
helper emitted at `-Oz`. Validation inspects ELF files and disassembly, not
execution on target hardware. Test artifacts remain in lit's output directory.

### Additional Hexagon permutations

The ten `ReassignPermutations*.test` groups use
`test/Inputs/check_address_permutations.py` for focused coverage outside the
504-link matrix. They check 137 successful plugin-enabled links plus four
negative-control links in C/C++ (COMDAT is C++ and the relaxation fixture is
assembly), with three additional plugin-free relaxation control links:

- Full LTO, ThinLTO, and LTO using an external assembler.
- Compilation without function/data section splitting; `-O3`, `-Os`, DWARF v5
  debug information, `-G0`/`-G8`, `-mlong-calls`, hidden visibility, and
  `-fmerge-all-constants`. CPU variants are `hexagonv68`, `hexagonv73`, and
  `hexagonv79`, all supported by the Hexagon 23.0.01 package. That package
  does not support the older `-mv60` option.
- Archive extraction, `--whole-archive`, and intermediate `-r` links.
- Reversed object order and section sorting, explicit `PHDRS` and alignment,
  `--gc-sections` with/without `KEEP()`, `--strip-all`, and `--discard-all`.
  Stripped code is compared with the independently validated unstripped image.
- Static PIE (`--static --pie --no-dynamic-linker`) and a PIE mixing PIC and
  PIE objects. Sequential IDs are allowed to change with input order, while
  their references must remain correct; hash IDs remain stable when no
  collision changes digest-slice selection.
- `--relax` and section-selective relaxation together with address rewriting.
  A plugin-free control checks whether ELD supports instruction-deleting
  relaxation and requires the same deletion and adjusted fixups when available;
  ELD builds providing only trampoline insertion retain their original size.
- Cross-TU inline COMDAT definitions, weak-only and strong-overridden data,
  aliases, both object orders, and `-Bsymbolic`.

Archive cases require `llvm-ar`; the external-assembler LTO case requires
`llvm-mc`. These are optional lit features, not requirements for all plugins.
The tests can use the 23.0.01 package's compiler, archiver, assembler, and
ELF inspection tools, but the ELD linker must include the new rewrite.

Old archive members and LTO-generated native objects are supported without
the preservation flag, provided their object-symbol extents remain available.
Tests cover both the default section-relative mode and explicit preservation
in native/LTO assembly. `ReassignReferenceRewrite.test` additionally checks
GOT-slot elimination, preservation of a public pointer array's GOT entry and
unrelated dynamic relocations, section-offset attribution, and malformed inputs.
It also validates populated provenance against original object relocations
and final image bytes, JSON escaping, serial/parallel determinism, and error
paths. `ReassignSectionOutputs.test` checks option gating, combined symbol
debug output, and empty relocation arrays on every supported architecture.

Two separate tests, `ReassignMergeStringContents.test` and
`ReassignNoMergeStringContents.test`, are marked expected failures. They expose
incorrect content hashes for `SHF_MERGE|SHF_STRINGS` inputs: the merge-fragment
raw-data API uses an input-section offset that is not reliable after layout.
`--no-merge-strings` does not avoid that path. Use ordinary named arrays in
non-mergeable input sections for now. This differs from merely compiling the
ordinary-array fixtures with `-fmerge-all-constants`, which passes. The tests
assert the correct hashes and will report unexpected passes when the bug is
fixed; they do not bless the incorrect IDs as supported behavior.

## Build standalone against an installed ELD package

The installed public API must provide `LinkerWrapper::setSymbolAddress`,
`claimUse`, and `isSymbolPreemptible`. CMake reports an error when the selected
package lacks the required APIs. Updating headers alone is insufficient: the
ELD runtime must provide their implementations too.

Use the top-level Plugins directory, which can be copied outside the ELD
and LLVM source trees. A compatible host C++ compiler, the ELD public
development package, and zlib development files are required:

```sh
cmake -S /path/to/Plugins -B build-reassign \
  -DBUILD_STANDALONE_PLUGINS=ON \
  -DELD_PACKAGE_ROOT=/path/to/target_tools \
  -DCMAKE_CXX_COMPILER=/path/to/host-clang++ \
  -DCMAKE_CXX_FLAGS="-stdlib=libc++" \
  -DELD_PLUGINS=ReassignSectionAddresses
cmake --build build-reassign
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
cmake -S /path/to/Plugins -B build-reassign -DBUILD_TESTING=ON
cmake --build build-reassign
ctest --test-dir build-reassign --output-on-failure
```

This reuses the cached package and compiler settings. Test setup discovers
ELD_TARGET_CC, ELD_TARGET_CXX, and ELD_TARGET_LD in the package's bin directory,
preferring clang/clang++ with hexagon-clang/hexagon-clang++ fallbacks. Override
those paths when the target tools are elsewhere. ELD_TARGET_TRIPLE selects
the target architecture, ELD_TARGET_CXX_FLAGS adds flags for both target
compiler drivers, and ELD_TARGET_LD_FLAGS adds linker flags. These settings
do not affect compilation of the host plugin.

### Run the tests with an external llvm-lit

Add lit testing to the same build:

```sh
cmake -S /path/to/Plugins -B build-reassign \
  -DBUILD_TESTING=ON \
  -DELD_ENABLE_LIT_TESTS=ON \
  -DELD_TARGET_TRIPLE=riscv64-unknown-elf \
  -DELD_LLVM_LIT=/path/to/llvm-package/bin/llvm-lit
cmake --build build-reassign
ctest --test-dir build-reassign --output-on-failure
```

Select a triple supported by the target tools. Plugins/lit.cfg derives the
lit architecture from ELD_TARGET_TRIPLE; ELD_TEST_TARGET overrides that
architecture if necessary. The configuration does not load eld/test/lit.cfg.
ELD_LLVM_LIT may be omitted when llvm-lit or lit is on PATH. FileCheck and not
must be in ELD_LLVM_TOOLS_DIR (default: beside the runner). LLVM libraries
default to the sibling lib directory; ELD_LLVM_LIBS_DIR overrides that path.
The general lit test requires llvm-readelf. Hexagon address tests additionally
require llvm-objdump; lit marks tests with missing tools unsupported.
The Hexagon address tests also require the plugin-owned relocation APIs in ELD;
an older package cannot build or load this plugin without those APIs.
Python-driven matrix fixtures currently do not support embedded double quotes
in extra compiler flags. Use simple flags such as `-G0` for the full matrix;
the smoke test and direct compiler RUN lines preserve quoted arguments.

The smoke test is ELDStandalone.ReassignSectionAddresses; the lit suite is
ELDStandaloneLit.ReassignSectionAddresses. Use `ctest -R` to select either.
For multi-configuration generators, build with `--config Release` and run
CTest with `-C Release`. The smoke script is kept at test/standalone_test.py.

CMake parses ELD_TARGET_CXX_FLAGS and ELD_TARGET_LD_FLAGS with the host's
command-line syntax; quote paths with spaces and double literal backslashes on
Unix. Direct smoke runs accept repeatable `--target-cxx-arg=...` and
`--target-ld-arg=...` options without further shell splitting. See the
[framework test documentation](../README.md#standalone-tests) for JSON argument
arrays in direct lit invocations and platform validation limits.

When loading the plugin manually, pass `-L/path/to/plugin-directory` to ELD
to locate the plugin. Include the ELD runtime library directory in
LD_LIBRARY_PATH on Linux, DYLD_LIBRARY_PATH on macOS, or PATH on Windows.
CTest arranges the plugin search and runtime library paths automatically.
