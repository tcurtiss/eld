# ReassignSectionAddresses

ReassignSectionAddresses is an `OutputSectionIteratorPlugin` example that
assigns an absolute address to every object symbol in selected output
sections. It is intended for bookkeeping sections such as `DSECT`, `COPY`,
`INFO`, or `OVERLAY`; the assigned range is not loaded as ordinary image data.

The plugin runs after layout, when output sections and symbol contents are
known. It must not be used for relaxable code that expects the symbols to keep
their pre-assignment addresses.

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

The plugin-local test covers sequential, MD5, SHA1, duplicate-content,
diagnostic, and gzip behavior. Run it with the configured ELD `llvm-lit`
driver, or run the plugin test target provided by the ELD build.

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
The lit test also requires llvm-readelf; without it, lit marks the test unsupported.

The smoke test is ELDStandalone.ReassignSectionAddresses; the lit suite is
ELDStandaloneLit.ReassignSectionAddresses. Use `ctest -R` to select either.
For multi-configuration generators, build with `--config Release` and run
CTest with `-C Release`. The smoke script is kept at test/standalone_test.py.

When loading the plugin manually, include its output directory and the ELD
runtime library directory in LD_LIBRARY_PATH on Linux, DYLD_LIBRARY_PATH
on macOS, or PATH on Windows. CTest arranges these paths automatically.
