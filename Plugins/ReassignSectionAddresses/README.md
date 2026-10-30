# ReassignSectionAddresses

ReassignSectionAddresses is an `OutputSectionIteratorPlugin` example that
assigns an absolute address to every object symbol in selected output
sections. It is intended for bookkeeping sections such as `DSECT`, `COPY`,
`INFO`, or `OVERLAY`; the assigned range is not loaded as ordinary image data.

The plugin runs after layout, when output sections and symbol contents are
known. It must not be used for relaxable code that expects the symbols to keep
their pre-assignment addresses.

## References to assigned IDs on Hexagon

When code passes a string's assigned address as an ID, compile its translation
unit with `-Wa,--reloc-section-sym=none`. This preserves relocation references
to the actual local string symbols instead of substituting section symbols
plus offsets. For example, a function-local `static const char fmt[]` in
`.dedup` can be used in either C or C++ without an assembly macro. Its bytes
must not be dereferenced at the assigned address.

For shared-library code, retain `-fpic` or `-fPIC`. PIE executables can use
`-fpie` or `-fPIE` and link with `--pie`. ELD recognizes the immediate-extender
plus `Rd = add(pc, ...)` sequence referencing a non-preemptible symbol made
absolute by the plugin and rewrites it to `Rd = ##assigned_value`. The two-word
sequence remains eight bytes, with no additional GOT entry, runtime relocation,
or memory load. Genuine symbol offsets are preserved. This prevents the
library's load bias from being added to the ID. No additional plugin option is
needed; the same rewrite also works in fixed-address executables.

This requires an ELD build containing the Hexagon absolute-address rewrite;
the presence of `setSymbolAddress` alone in an older package is not sufficient.
The Hexagon lit tests check actual C/C++ instructions and retained
relocations, including parallel and serial linking. The rewrite is deliberately
narrow: it does not recover symbols from section-relative references in old
archives, rewrite GOT-based addressing, fix dynamic pointer-table relocations,
or change preemptible symbol references. Malformed candidate relocation pairs
are diagnosed instead of being partially rewritten. Other targets retain their
existing relocation behavior.

## Options

Options are colon-delimited `key=value` pairs. When an option accepts more
than one value, its value list remains comma-delimited:

| Option | Default | Description |
| --- | --- | --- |
| `section=<name>[,<name>...]` | required | Output sections to process. |
| `hash=md5\|sha1\|sequential` | `md5` | Address assignment mode. |
| `start=<value>` | `0` | Starting address for `hash=sequential`; accepts C integer syntax. |
| `dump=<path>[,<path>...]` | unset | Optional text dump, one path per target section. |
| `gzip=yes\|no` | `no` | Writes dump files as `<path>.gz` and does not create the uncompressed file. |
| `debug_dump=yes\|no` | `no` | Writes an uncompressed parallel `<path>_debug<ext>` dump with each symbol's assigned/original address, name, and raw bytes. Requires `dump=`. |
| `clean_strings=yes\|no` | `no` | In the main dump only, retains printable ASCII, removes CR/LF, and converts each run of tabs to one space. |

Example plugin configuration:

```yaml
GlobalPlugins:
  - Type: OutputSectionIteratorPlugin
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.dedup:hash=md5:dump=dedup.dump:gzip=no
```

In sequential mode, identical symbol contents share one address across all
selected sections. In MD5 and SHA1 modes, the address is derived from the
symbol bytes. The plugin still leaves the original bytes in the output; it
does not physically merge sections or symbols.

Dump lines have the form:

```text
<8-digit-lowercase-hex-address>:<symbol-content>
```

Duplicate addresses are written once per dump. Set `debug_dump=yes` to also
write a parallel debug dump with every symbol, its original address, and raw
bytes; linker tracing is not required.

Set `clean_strings=yes` when dump content may contain terminal control
characters or non-ASCII bytes. It affects only the human-readable main dump;
the debug dump continues to record the original bytes as hexadecimal.

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
It checks linked immediate values, static retained relocation types/addends,
unchanged function sizes, and byte-identical serial/parallel images. A normal
non-DSECT string is a negative control. DSECT sections must be non-allocated
and outside every `PT_LOAD` file range, with no dynamic relocations in these
self-contained images. Non-PIC immediate stores, `combine`, and duplex
instruction forms are checked as well as the PIC rewrite.

The fixtures also check `__PIC__`/`__PIE__` at compile time to verify the
requested small/large model. PIE output must have `ET_DYN`, `DF_1_PIE`, a
dynamic segment, and the requested entry point; shared libraries must not
have `DF_1_PIE`. Merely linking PIC objects into a fixed-address executable
does not count as PIE coverage. ELD does not retain static relocations for
shared libraries or PIEs, so the checker locates their instruction operands
from the original input relocations instead.

These tests require Hexagon, `llvm-readelf` with JSON output, `llvm-objdump`,
and an ELD build containing the rewrite. They run through the same lit
configuration in source-tree and standalone builds; no target headers or
runtime libraries are required. A small assembly fixture supplies the restore
helper emitted at `-Oz`. Validation inspects ELF files and disassembly, not
execution on target hardware. Test artifacts remain in lit's output directory.

### Additional Hexagon permutations

The ten `ReassignPermutations*.test` groups use
`test/Inputs/check_address_permutations.py` for focused coverage outside the
504-link matrix. They check 137 successful links plus four negative-control
links in C/C++ (COMDAT is C++ and the relaxation fixture is assembly):

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
  their references must remain correct; content hashes remain stable.
- Actual instruction deletion by `--relax` and section-selective relaxation,
  together with address rewriting in the relaxed fragment.
- Cross-TU inline COMDAT definitions, weak-only and strong-overridden data,
  aliases, both object orders, and `-Bsymbolic`.

Archive cases require `llvm-ar`; the external-assembler LTO case requires
`llvm-mc`. These are optional lit features, not requirements for all plugins.
The tests can use the 23.0.01 package's compiler, archiver, assembler, and
ELF inspection tools, but the ELD linker must include the new rewrite.

For LTO, preserving symbols when compiling bitcode is **not sufficient**.
Pass the preservation option to ELD's native code-generation stage too:

```sh
ld.eld --shared first.bc second.bc \
  --flto-options=codegen=-reloc-section-sym=none \
  -T layout.t --plugin-config plugins.yaml -o image.so
```

If using the external LTO assembler, also supply
`--flto-options=asmopts=--reloc-section-sym=none`. The negative-control tests
confirm that omitting the LTO code-generation setting, or using an old archive
member compiled without symbol preservation, leaves section-relative address
computations unrepaired. Those are not successful ID-materialization cases.

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

The installed public API must provide `LinkerWrapper::setSymbolAddress`.
CMake reports an error when the selected package lacks that API.

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
The Hexagon address tests also require ELD's plugin-assigned absolute-address
rewrite support; older linkers can pass the smoke test but fail these fixtures.
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

When loading the plugin manually, include its output directory and the ELD
runtime library directory in LD_LIBRARY_PATH on Linux, DYLD_LIBRARY_PATH
on macOS, or PATH on Windows. CTest arranges these paths automatically.
