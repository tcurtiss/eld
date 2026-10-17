# ELD plugins

Plugins build as part of ELD or against an installed ELD package. Every
immediate child directory containing a CMakeLists.txt is discovered
automatically, except the reserved cmake and Support directories.

## Build as part of ELD

Configure ELD normally, then build the desired target:

```sh
cmake --build /path/to/build-eld --target HelloWorldPlugin
```

## Build against an installed package

Select standalone mode explicitly:

```sh
cmake -S /path/to/eld/Plugins -B build-plugins \
  -DBUILD_STANDALONE_PLUGINS=ON \
  -DELD_PACKAGE_ROOT=/path/to/target_tools \
  -DCMAKE_CXX_COMPILER=/path/to/host-clang++ \
  -DCMAKE_CXX_FLAGS="-stdlib=libc++"
cmake --build build-plugins
```

The plugin runs on the host. Select a host C++ compiler, and use libc++ as
required by the ELD package. Set the compiler and runtime flags with standard
CMake variables or a host toolchain file so they apply during CMake's
compiler checks as well as the plugin build. The harness does not select
the compiler or inject runtime flags. Use a fresh build directory when
changing compilers.

FindELD.cmake accepts either a conventional installation with include, lib,
and bin directories or a package containing those directories under Tools.
ELD_ROOT or CMAKE_PREFIX_PATH can also supply the installation prefix.
Only the public plugin headers and host LinkerWrapper library are required;
building plugins does not require LLVM sources, LLVM CMake files, Python,
lit, or a target compiler.

All discovered plugins build by default. Select a subset with
`-DELD_PLUGINS=HelloWorldPlugin`; quote semicolon-separated lists when
selecting multiple plugins.

## Host platforms

Library discovery uses the platform's library suffixes and the installed
API version, rather than a fixed Linux soname. On Windows the installation
must provide both the LinkerWrapper DLL and its import library. ELD_LIBRARY
and ELD_RUNTIME_LIBRARY can override their locations. On Unix, the plugin
records the ELD library directory in its RPATH.

The standalone workflow is validated on Linux. Windows and macOS execution
still require native validation with compatible ELD packages. Compiler,
standard library, architecture, and ABI must match the host ELD installation;
the Linux libc++ command above is not a Windows toolchain configuration.

## Standalone tests

Building libraries is the default; test dependencies are discovered only with
`BUILD_TESTING=ON`. Copying the Plugins directory is sufficient: standalone
tests do not load the ELD source-tree test harness or require LLVM sources.

The host compiler above builds the plugin loaded into ELD. The separate
`ELD_TARGET_CC`, `ELD_TARGET_CXX`, and `ELD_TARGET_LD` settings build and
link target test inputs. They are not replacements for CMAKE_CXX_COMPILER.
Test setup searches the resolved package's bin directory for clang/clang++
first, with hexagon-clang/hexagon-clang++ fallbacks, and for ld.eld. Explicit
paths override discovery when the tools are elsewhere. If no separate C
driver is found, the C++ driver is also used for C inputs.

Enable package-only smoke tests (Python 3, a target compiler, and ELD):

```sh
cmake -S /path/to/eld/Plugins -B build-plugins \
  -DBUILD_STANDALONE_PLUGINS=ON \
  -DELD_PACKAGE_ROOT=/path/to/target_tools \
  -DCMAKE_CXX_COMPILER=/path/to/host-clang++ \
  -DCMAKE_CXX_FLAGS="-stdlib=libc++" \
  -DELD_PLUGINS=HelloWorldPlugin \
  -DBUILD_TESTING=ON
cmake --build build-plugins
ctest --test-dir build-plugins --output-on-failure
```

For lit suites, add an external lit runner and target selection:

```sh
cmake -S /path/to/eld/Plugins -B build-plugins \
  -DBUILD_STANDALONE_PLUGINS=ON \
  -DELD_PACKAGE_ROOT=/path/to/target_tools \
  -DCMAKE_CXX_COMPILER=/path/to/host-clang++ \
  -DCMAKE_CXX_FLAGS="-stdlib=libc++" \
  -DELD_PLUGINS=HelloWorldPlugin \
  -DBUILD_TESTING=ON \
  -DELD_ENABLE_LIT_TESTS=ON \
  -DELD_TARGET_TRIPLE=riscv64-unknown-elf \
  -DELD_LLVM_LIT=/path/to/llvm-package/bin/llvm-lit
cmake --build build-plugins
ctest --test-dir build-plugins --output-on-failure
```

Use `ctest -R ELDStandaloneLit` to run only lit or
`ctest -R '^ELDStandalone[.]'` to run only smoke tests. For multi-configuration
generators, build with `--config Release` and test with `ctest -C Release`.

ELD_LLVM_LIT may be omitted when llvm-lit (or lit) is on PATH. The LLVM tools
directory defaults to the runner's directory and the library directory to
its sibling lib. Override ELD_LLVM_TOOLS_DIR and ELD_LLVM_LIBS_DIR when needed,
including when lit was installed separately with pip. Lit additionally
requires FileCheck and not. llvm-readelf is optional; tests that use it must
declare `REQUIRES: llvm-readelf`. HelloWorld does not require it.

Plugins/lit.cfg derives its architecture from ELD_TARGET_TRIPLE. Supported
names include ARM, AArch64, Hexagon, RISCV, RISCV64, and X86. ELD_TEST_TARGET
overrides the lit architecture (for example RISCV64 or RISCV64_default);
it does not override an explicitly supplied compiler target triple. Use
ELD_TARGET_TRIPLE to select the same target for smoke and lit tests.
ELD_TARGET_CXX_FLAGS supplies additional flags to both target compiler
drivers; ELD_TARGET_LD_FLAGS supplies target linker flags. Host compiler
flags are independent of these settings.

CTest and lit arrange runtime library search paths: LD_LIBRARY_PATH on
Linux, DYLD_LIBRARY_PATH on macOS, and PATH on Windows. The same paths are
needed when loading a plugin manually. LLVM helper tools run on the host
and must be compatible with the target object formats.

## Adding a plugin

Give the plugin directory and CMake target the same name. Use
`eld_add_standalone_plugin(... SOURCES ... LIBRARIES ...)` when
ELD_STANDALONE is true and the normal ELD/LLVM library helpers otherwise.
The standalone helper links ELD::LW; optional dependencies belong to the
plugin that needs them. `eld_standalone_require_api(plugin header symbol)`
can reject packages missing a required public API.

Keep regression tests under the plugin's test directory. Register them with
`eld_register_plugin_tests(test_dir target)` in integrated builds, and with
`eld_add_standalone_test(NAME ... TARGET ... SCRIPT ...)` and
`eld_add_standalone_lit_test(NAME ... TARGET ... TEST_DIR ...)` when
standalone BUILD_TESTING is enabled. See HelloWorldPlugin for an example.
The smoke helper passes package, compiler, linker, flags, and library-path
arguments to the Python script; the lit helper uses Plugins/lit.cfg.
