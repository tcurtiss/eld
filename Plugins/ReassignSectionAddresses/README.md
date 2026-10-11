# ReassignSectionAddresses

ReassignSectionAddresses is an `OutputSectionIteratorPlugin` example that
assigns an absolute address to every object symbol in selected output
sections. It is intended for bookkeeping sections such as `DSECT`, `COPY`,
`INFO`, or `OVERLAY`; the assigned range is not loaded as ordinary image data.

The plugin runs after layout, when output sections and symbol contents are
known. It must not be used for relaxable code that expects the symbols to keep
their pre-assignment addresses.

## Options

Options are colon-delimited `key=value` pairs:

| Option | Default | Description |
| --- | --- | --- |
| `section=<name>[,<name>...]` | required | Output sections to process. |
| `hash=md5\|sha1\|sequential` | `md5` | Address assignment mode. |
| `start=<value>` | `0` | Starting address for `hash=sequential`; accepts C integer syntax. |
| `dump=<path>[,<path>...]` | unset | Optional text dump, one path per target section. |
| `gzip=yes\|no` | `no` | Writes dump files as `<path>.gz` and does not create the uncompressed file. |

Example plugin configuration:

```yaml
GlobalPlugins:
  - Type: OutputSectionIteratorPlugin
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.dedup,hash=md5,dump=dedup.dump,gzip=no
```

In sequential mode, identical symbol contents share one address across all
selected sections. In MD5 and SHA1 modes, the address is derived from the
symbol bytes. The plugin still leaves the original bytes in the output; it
does not physically merge sections or symbols.

Dump lines have the form:

```text
<8-digit-lowercase-hex-address>:<symbol-content>
```

Duplicate addresses are written once per dump. With plugin tracing enabled, a
temporary debug dump may also show each symbol, its original address, and raw
bytes.

## Build as part of ELD

Configure ELD/LLVM normally, then build the plugin target:

```sh
cmake -S /path/to/llvm-project -B build-eld \
  -DLLVM_ENABLE_PROJECTS=clang
cmake --build build-eld --target ReassignSectionAddresses
```

The plugin-local test covers sequential, MD5, SHA1, duplicate-content,
diagnostic, and gzip behavior. Run it with the configured ELD `llvm-lit`
driver, or run the plugin test target provided by the ELD build.

## Build standalone against an installed ELD package

The standalone build requires an installed ELD package exposing
`LinkerWrapper::setSymbolAddress`. Packages predating that API extension
cannot build this plugin; use a package that provides the API.

When `ELD_TARGET_CXX` and `ELD_TARGET_LD` are omitted, CMake derives the
linker path and searches for the target compiler under
`<ELD_PACKAGE_ROOT>/Tools/bin`. Set them explicitly only when the target
compiler or linker is installed somewhere other than the ELD package.

```sh
cmake -S /path/to/eld/Plugins \
  -B build-reassign \
  -DELD_PACKAGE_ROOT=/path/to/target_tools \
  -DELD_PLUGIN_CXX=/path/to/host-clang++ \
  -DELD_PLUGIN_USE_LIBCXX=ON \
  -DELD_PLUGINS=ReassignSectionAddresses
cmake --build build-reassign
```

Set `ELD_TARGET_TRIPLE`, `ELD_TARGET_CXX_FLAGS`, and `ELD_TARGET_LD_FLAGS` as
needed for the selected architecture. Use `-DBUILD_TESTING=OFF` when only the
plugin shared library is needed and no target test tools are available.

`ELD_PLUGIN_CXX` is the host Clang compiler for the plugin library. With
`ELD_PLUGIN_USE_LIBCXX=ON`, `-stdlib=libc++` is supplied before CMake tests
that compiler.

### Run the tests with an external `llvm-lit`

The standalone build registers the plugin-local lit suite with CTest. Use an
`llvm-lit` from the external LLVM package, and provide the target triple so
the lit configuration can select the corresponding ELD test target:

```sh
cmake -S /path/to/eld/Plugins \
  -B build-reassign \
  -DELD_PACKAGE_ROOT=/path/to/target_tools \
  -DELD_PLUGIN_CXX=/path/to/host-clang++ \
  -DELD_PLUGIN_USE_LIBCXX=ON \
  -DELD_PLUGINS=ReassignSectionAddresses \
  -DELD_TARGET_TRIPLE=riscv64-unknown-elf \
  -DELD_ENABLE_LIT_TESTS=ON \
  -DELD_LLVM_LIT=/path/to/llvm-package/bin/llvm-lit
cmake --build build-reassign
ctest --test-dir build-reassign \
  -R ELDStandaloneLit.ReassignSectionAddresses --output-on-failure
```

The standalone lit configuration is self-contained; it does not require the
full ELD source tree or the ELD test harness. The external LLVM tools
directory must provide `FileCheck`, `not`, and `llvm-readelf`.

`ELD_TEST_TARGET=RISCV64` may be supplied instead of
`ELD_TARGET_TRIPLE` when the automatically derived architecture is not the
one wanted. `ELD_LLVM_LIT` may be omitted when the external `llvm-lit` is on
`PATH`. The tools and libraries used by the lit suite are inferred from the
`llvm-lit` location; set `ELD_LLVM_TOOLS_DIR` or `ELD_LLVM_LIBS_DIR` when
those directories are elsewhere.

The package-only smoke test is kept with this plugin at
`test/standalone_test.py`. It exercises sequential address assignment and
dump generation and is registered with CTest when the plugin is selected.
