//===- CrossReference.cpp-------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//
//
// Builds a symbol-level caller-to-callee cross-reference table and writes it
// to a dump file, as either compact text (the default) or JSON. Unlike the
// linker's built-in --cref table (which records, per symbol, only the
// *input files* that reference it), this plugin records the specific
// *referring symbol* for each reference, when it can be determined.
//
// Local symbols are not unique by name (e.g. a static helper named "helper"
// may be defined identically in several translation units), so every symbol
// printed in the dump is qualified with its origin file, size, and virtual
// address, as tab-delimited fields: "name\tfile\t0xsize\taddress" (e.g.
// "helper\ta.c.o\t0x10\t0x2000"). A garbage-collected symbol never reaches
// final layout and so has no address; its address field is printed as "?",
// which doubles as the dump's sole indicator of GC'd status (no separate
// tag is needed).
//
// By default, garbage-collected symbols -- and any edge referencing one as
// either caller or callee -- are omitted from the dump entirely, so it
// reflects only the final, live graph. Passing "show_gc=yes" in the Options
// string (see below) instead reports the full symbol connectivity graph as
// it existed prior to garbage collection: edges are recorded for every
// relocation regardless of whether either endpoint was later garbage
// collected, so a caller that itself gets collected still shows its
// outgoing edges (each with a "?" address), and callees that only
// garbage-collected callers reference still show up as callees. This is
// useful for tracing *why* a removed function was itself dead code (nothing
// reaches it except other dead code) as well as *what* dead code would have
// called had it not been removed.
//
// For every relocation (a "Use") found in every input section, the plugin
// attributes the reference to whichever symbol defined in the relocation's
// source chunk most plausibly contains the instruction doing the
// referencing:
//   - If the relocation's offset within its source chunk falls inside a
//     symbol's [offset, offset + size) range, the reference is attributed
//     to that symbol exactly.
//   - Otherwise, the nearest preceding symbol (by offset) in the same chunk
//     is used as a best-effort guess, and the edge gets an "approx" flag in
//     text output (or "referrerKind": "approx" in JSON). This fallback
//     matters for chunks whose symbols have no reliable size information
//     (e.g. hand-written assembly without .size directives).
//   - If no symbol precedes the relocation's offset in its chunk at all,
//     the referrer is recorded as an unattributed edge.
//
// If the reference was resolved through a linker-generated trampoline (a
// branch island / stub, e.g. for an out-of-range branch), the edge is
// collapsed to point directly from the original referrer to the real
// target symbol, and is tagged with a "trampoline" flag rather than being
// reported as two separate hops through the synthetic stub symbol.
//
// LTO/bitcode input files are not inspected by this initial implementation.
//
// This is a LinkerPlugin, so its ActBeforeWritingOutput hook is used to
// build the table: this is the first hook that runs after both garbage
// collection and stub/trampoline creation (both of which happen earlier in
// the link pipeline, before layout), so relocations have their final,
// possibly stub-rewritten target symbols by the time this hook fires.
//
// Options string format: a colon-delimited list of key=value tokens. The
// "file" key is required and gives the path of the file to write the
// cross-reference table to. The remaining keys are optional:
//   file=<path>          -- path of the dump file to write (required).
//   format=text|json|json_columnar
//                          -- output format for the dump (default: text).
//                            "text" produces a compact symbol catalog and
//                            numeric edge table. "json" produces the
//                            section-oriented object format consumed by
//                            image_analysis. "json_columnar" produces its
//                            compressed columnar format.
//   gzip=yes|no             -- compress the output using gzip and append
//                            ".gz" to the file path (default: no).
//   coalesce_dirs=none|unary
//                          -- in JSON formats, fold empty single-child
//                            directory chains after the first two path
//                            components (default: none). Folded components
//                            are joined with the visible separator "⟫".
//   source_root=<path>    -- remove this path prefix from source paths in all
//                            output formats. The prefix is removed only when
//                            it is a complete path component.
//   strip_prefix=<glob>   -- remove the longest complete path prefix matched
//                            by this wildcard pattern. Unlike source_root,
//                            this supports *, ?, bracket classes and brace
//                            expansions. The two options are exclusive.
//   show_gc=yes|no       -- whether to include garbage-collected
//                            symbols/edges in the dump (default: no).
//   cpp_demangle=yes|no  -- whether to print C++ symbol names demangled
//                            (default: no; names are printed exactly as
//                            they appear in the symbol table, e.g. mangled
//                            for C++).
//   usedwarf=yes|no      -- whether to look up each symbol's defining
//                            source file and line number from DWARF debug
//                            info (default: no; requires the input file to
//                            have been compiled with debug info, e.g. -g).
//                            When available, this is appended to the symbol
//                            name as "(source-file:line)" in a text-format
//                            symbol, and added to a JSON-format symbol as
//                            "sourceFile"/
//                            "sourceLine" fields; when unavailable (no debug
//                            info, or no matching subprogram/variable DIE), it is
//                            simply omitted.
//
//                            Caveat: this reads DWARF directly from each
//                            input file's unrelocated bytes, so any name
//                            stored via a relocated string form (DW_FORM_strp
//                            into .debug_str, or DW_FORM_strx into
//                            .debug_str_offsets -- the default for DW_AT_name
//                            and DW_AT_decl_file with plain "-g" on most
//                            targets) resolves to the wrong string, since the
//                            relocation that would point it at the right
//                            offset is never applied to non-alloc debug
//                            sections during linking. This is a limitation of
//                            ELD's DWARF plugin API, not of this plugin.
//                            Compiling with a fixed abbreviation form that
//                            stores these strings inline (e.g. clang's
//                            "-gdwarf-2 -mllvm -dwarf-inlined-strings=Enable")
//                            avoids the affected forms and resolves correctly.
//   exclude_symbols=<globs> -- comma-delimited list of glob patterns (see
//                            llvm::GlobPattern); a symbol is omitted from
//                            the dump, and from any edge it would otherwise
//                            appear in as referrer or target, if its name
//                            matches any pattern. Matching is done against
//                            the demangled name when cpp_demangle=yes, and
//                            the raw (possibly mangled) name otherwise, to
//                            match what is actually printed.
//   exclude_files=<globs>  -- comma-delimited list of glob patterns; a
//                            symbol is omitted (same as exclude_symbols) if
//                            its origin file's resolved path matches any
//                            pattern.
//   include_symbols=<globs> -- comma-delimited list of glob patterns; if
//                            given, a symbol (and any edge it would
//                            otherwise appear in) is omitted unless its
//                            (printed) name matches at least one pattern.
//                            Name matching follows the same demangle rule as
//                            exclude_symbols. Combines with exclude_symbols/
//                            exclude_files: a symbol must match an include
//                            pattern (if any are given) *and* fail to match
//                            every exclude pattern to be kept.
//   exclude_local=yes|no  -- whether to omit local (STB_LOCAL) symbols --
//                            e.g. static functions/data, and compiler- or
//                            assembler-generated labels such as ".L0" or
//                            "$d" -- from the dump, along with any edge they
//                            would otherwise appear in (default: yes).
//   exclude_functions=yes|no -- whether to omit function (STT_FUNC) symbols
//                            from the dump, along with any edge they would
//                            otherwise appear in (default: no).
//   exclude_data=yes|no   -- whether to omit data/object (STT_OBJECT)
//                            symbols from the dump, along with any edge
//                            they would otherwise appear in (default: no).
//                            Combined with exclude_functions=yes, this omits
//                            every typed symbol, leaving only symbols whose
//                            type is neither (e.g. sections or files).
//   min_size=<bytes>      -- omit any symbol smaller than this many bytes,
//                            along with any edge it would otherwise appear
//                            in (default: 0, i.e. no minimum).
//   min_refs=<n>          -- omit any symbol with fewer than n incoming
//                            edges, along with any edge it would otherwise
//                            appear in as referrer or target (default: 0,
//                            i.e. no minimum). The incoming-edge count used
//                            for this test is taken from the full recorded
//                            edge graph, before any other filtering option
//                            is applied.
//   exclude_intra_file=yes|no -- whether to omit an edge whose referrer and
//                            target both originate from the same input
//                            file's resolved path, to focus the dump on
//                            cross-file references (default: no). Unlike
//                            the other filters, this affects only edges, not
//                            the symbols list.
// e.g. "file=xref_dump.txt:show_gc=yes:cpp_demangle=yes".
//
//===----------------------------------------------------------------------===//

#include "LinkerPlugin.h"
#include "PluginVersion.h"
#include "eld/PluginAPI/ThreadPool.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/Demangle/Demangle.h"
#include "llvm/Support/Compression.h"
#include "llvm/Support/CRC.h"
#include "llvm/Support/GlobPattern.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_os_ostream.h"
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstdlib>
#include <deque>
#include <fstream>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace eld::plugin;

namespace {

enum class AttributionKind : uint8_t { Exact, NearestPreceding, Unattributed };

enum class OutputFormat : uint8_t { Text, DashboardObject, DashboardColumnar };

// A symbol together with its offset and size within the chunk that defines
// it, used to build a per-chunk, offset-sorted index for referrer lookup.
struct SymbolOffset {
  Symbol Sym;
  off_t Offset;
  uint32_t Size;
};

struct ChunkSymbolRange {
  uint32_t Begin = 0;
  uint32_t End = 0;
};

// A symbol's DWARF-derived declaration site, as looked up by name from the
// subprogram or variable DIEs of its defining input file's compile units.
struct SourceLoc {
  std::string File;
  uint64_t Line;
};

struct DashboardSection {
  Section Handle;
  uint32_t PathID = 0;
  std::string Name;
  uint32_t OutputID = UINT32_MAX;
  uint64_t Size = 0;
  uint8_t Kind = 0;
  bool Live = true;
  bool Root = false;
};

// Compresses directory paths for dashboard display without changing the
// section or edge graph. A directory with no files of its own and exactly one
// child is folded into that child. The first two components are retained so
// the dashboard's top-level-directory and subsystem groupings remain stable.
class DashboardPathCoalescer {
public:
  static constexpr const char *Separator = "⟫";

  void build(const std::vector<std::string> &Paths) {
    Nodes.clear();
    NodeIDs.clear();
    SeenPaths.clear();
    Cache.clear();
    for (const std::string &Path : Paths) {
      if (!SeenPaths.insert(Path).second)
        continue;
      addPath(Path);
    }
    for (Node &N : Nodes)
      N.Keep = N.DirectFiles != 0 || N.Children.size() != 1 || N.Depth < 2;
  }

  std::string coalesce(const std::string &Path) const {
    auto Cached = Cache.find(Path);
    if (Cached != Cache.end())
      return Cached->second;

    size_t Slash = Path.rfind('/');
    std::string DirPart = Slash == std::string::npos
                              ? ""
                              : Path.substr(0, Slash);
    bool Absolute = !DirPart.empty() && DirPart.front() == '/';
    std::string Base = Slash == std::string::npos ? Path
                                                   : Path.substr(Slash + 1);
    int Parent = -1;
    std::string ResultDir;
    std::string Pending;
    size_t Start = 0;
    while (Start < DirPart.size()) {
      size_t End = DirPart.find('/', Start);
      if (End == std::string::npos)
        End = DirPart.size();
      if (End > Start) {
        std::string Name = DirPart.substr(Start, End - Start);
        auto It = NodeIDs.find({Parent, Name});
        if (It == NodeIDs.end()) {
          // Paths passed to coalesce() are normally all present during build;
          // retain an unknown path unchanged rather than corrupting it.
          Cache.emplace(Path, Path);
          return Path;
        }
        const Node &N = Nodes[It->second];
        Parent = It->second;
        if (!Pending.empty())
          Pending += Separator;
        Pending += Name;
        if (N.Keep) {
          if (!ResultDir.empty())
            ResultDir += '/';
          ResultDir += Pending;
          Pending.clear();
        }
      }
      Start = End + 1;
    }
    if (!Pending.empty()) {
      if (!ResultDir.empty())
        ResultDir += '/';
      ResultDir += Pending;
    }
    std::string Result = ResultDir.empty() ? Base : ResultDir + '/' + Base;
    if (Absolute && !Result.empty())
      Result.insert(Result.begin(), '/');
    Cache.emplace(Path, Result);
    return Result;
  }

private:
  struct Node {
    int Parent = -1;
    std::string Name;
    std::vector<int> Children;
    uint32_t DirectFiles = 0;
    uint32_t Depth = 0;
    bool Keep = true;
  };

  void addPath(const std::string &Path) {
    size_t Slash = Path.rfind('/');
    std::string DirPart = Slash == std::string::npos
                              ? ""
                              : Path.substr(0, Slash);
    int Parent = -1;
    int Last = -1;
    size_t Start = 0;
    while (Start < DirPart.size()) {
      size_t End = DirPart.find('/', Start);
      if (End == std::string::npos)
        End = DirPart.size();
      if (End > Start) {
        std::string Name = DirPart.substr(Start, End - Start);
        auto It = NodeIDs.find({Parent, Name});
        int ID;
        if (It == NodeIDs.end()) {
          ID = Nodes.size();
          NodeIDs.emplace(std::make_pair(Parent, Name), ID);
          Nodes.push_back({Parent, Name, {}, 0,
                           Parent < 0 ? 0u : Nodes[Parent].Depth + 1, true});
          if (Parent >= 0)
            Nodes[Parent].Children.push_back(ID);
        } else {
          ID = It->second;
        }
        Parent = ID;
        Last = ID;
      }
      Start = End + 1;
    }
    if (Last >= 0)
      ++Nodes[Last].DirectFiles;
  }

  std::map<std::pair<int, std::string>, int> NodeIDs;
  std::vector<Node> Nodes;
  std::unordered_set<std::string> SeenPaths;
  mutable std::unordered_map<std::string, std::string> Cache;
};

} // namespace

class CrossReference : public LinkerPlugin {
public:
  CrossReference() : LinkerPlugin("CrossReference") {}

  void Init(const std::string &options) override {
    OutputPathCache.clear();
    std::istringstream Tokens(options);
    std::string Token;
    while (std::getline(Tokens, Token, ':')) {
      if (Token.empty())
        continue;
      size_t Eq = Token.find('=');
      if (Eq == std::string::npos) {
        HasError = true;
        getLinker()->reportDiag(getLinker()->getErrorDiagID(
            "CrossReference does not recognize option '%0': options "
            "must be in key=value form"),
            Token);
        return;
      }
      std::string Key = Token.substr(0, Eq);
      std::string Value = Token.substr(Eq + 1);
      if (Key == "file") {
        if (!DumpPath.empty()) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference was given more than one 'file' option "
              "in its Options string: '%0' and '%1'"),
              DumpPath, Value);
          return;
        }
        DumpPath = Value;
        continue;
      }
      if (Key == "format") {
        if (Value == "text") {
          Format = OutputFormat::Text;
        } else if (Value == "json") {
          Format = OutputFormat::DashboardObject;
        } else if (Value == "json_columnar") {
          Format = OutputFormat::DashboardColumnar;
        } else {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference does not support format '%0'; only "
              "'text', 'json', and 'json_columnar' are supported"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "gzip") {
        if (!parseYesNo(Value, Gzip)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's gzip option must be 'yes' or 'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "coalesce_dirs") {
        if (Value == "none") {
          CoalesceDirs = false;
        } else if (Value == "unary") {
          CoalesceDirs = true;
        } else {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's coalesce_dirs option must be 'none' or "
              "'unary', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "source_root") {
        if (HasStripPrefix) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference options 'source_root' and 'strip_prefix' "
              "are mutually exclusive"));
          return;
        }
        SourceRoot = Value;
        HasSourceRoot = true;
        continue;
      }
      if (Key == "strip_prefix") {
        if (HasSourceRoot) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference options 'source_root' and 'strip_prefix' "
              "are mutually exclusive"));
          return;
        }
        const std::string &Stored = GlobStorage.emplace_back(Value);
        llvm::Expected<llvm::GlobPattern> ExpPattern =
            llvm::GlobPattern::create(Stored);
        if (!ExpPattern) {
          HasError = true;
          getLinker()->reportDiag(
              getLinker()->getErrorDiagID(
                  "CrossReference could not parse strip_prefix glob "
                  "pattern '%0': %1"),
              Stored, llvm::toString(ExpPattern.takeError()));
          return;
        }
        StripPrefixPattern = std::move(ExpPattern.get());
        HasStripPrefix = true;
        continue;
      }
      if (Key == "show_gc") {
        if (!parseYesNo(Value, ShowGC)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's show_gc option must be 'yes' or "
              "'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "cpp_demangle") {
        if (!parseYesNo(Value, CppDemangle)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's cpp_demangle option must be 'yes' or "
              "'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "usedwarf") {
        if (!parseYesNo(Value, UseDWARF)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's usedwarf option must be 'yes' or "
              "'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "exclude_symbols") {
        if (!parseGlobList(Value, ExcludeSymbolPatterns))
          return;
        continue;
      }
      if (Key == "exclude_files") {
        if (!parseGlobList(Value, ExcludeFilePatterns))
          return;
        continue;
      }
      if (Key == "include_symbols") {
        if (!parseGlobList(Value, IncludeSymbolPatterns))
          return;
        continue;
      }
      if (Key == "exclude_local") {
        if (!parseYesNo(Value, ExcludeLocal)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's exclude_local option must be 'yes' or "
              "'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "exclude_functions") {
        if (!parseYesNo(Value, ExcludeFunctions)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's exclude_functions option must be 'yes' "
              "or 'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "exclude_data") {
        if (!parseYesNo(Value, ExcludeData)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's exclude_data option must be 'yes' or "
              "'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "min_size") {
        if (!parseNonNegativeInt(Value, MinSize)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's min_size option must be a non-negative "
              "integer, got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "min_refs") {
        if (!parseNonNegativeInt(Value, MinRefs)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's min_refs option must be a non-negative "
              "integer, got '%0'"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "exclude_intra_file") {
        if (!parseYesNo(Value, ExcludeIntraFile)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReference's exclude_intra_file option must be 'yes' "
              "or 'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      HasError = true;
      getLinker()->reportDiag(getLinker()->getErrorDiagID(
          "CrossReference does not recognize option '%0'"), Key);
      return;
    }
    if (DumpPath.empty()) {
      HasError = true;
      getLinker()->reportDiag(getLinker()->getErrorDiagID(
          "CrossReference requires a 'file=<path>' option in its "
          "Options string"));
      return;
    }
  }

  void ActBeforeWritingOutput() override {
    if (HasError)
      return;
    {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference buildStubMap", "CrossReference",
          getLinker()->isTimingEnabled()));
      buildStubMap();
    }
    {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference collectAllSymbols", "CrossReference",
          getLinker()->isTimingEnabled()));
      collectAllSymbols();
    }
    {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference buildDashboardSections", "CrossReference",
          getLinker()->isTimingEnabled()));
      buildDashboardSections();
    }
    if (CoalesceDirs) {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference coalesceDashboardPaths", "CrossReference",
          getLinker()->isTimingEnabled()));
      DashboardPathCompressor.build(DashboardPaths);
    }
    if (Format == OutputFormat::Text) {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference buildChunkSymbolIndex", "CrossReference",
          getLinker()->isTimingEnabled()));
      buildChunkSymbolIndex();
    }
    {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference walkReferences", "CrossReference",
          getLinker()->isTimingEnabled()));
      walkReferences();
    }
    if (Format == OutputFormat::Text) {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference computeIncomingRefCounts", "CrossReference",
          getLinker()->isTimingEnabled()));
      computeIncomingRefCounts();
    }
    if (UseDWARF && Format == OutputFormat::Text) {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference buildDWARFIndex", "CrossReference",
          getLinker()->isTimingEnabled()));
      buildDWARFIndex();
    }
    {
      AutoTimer Timer(getLinker()->CreateTimer(
          "CrossReference writeDump", "CrossReference",
          getLinker()->isTimingEnabled()));
      writeDump();
    }
  }

  void Destroy() override {
    WorkPool.reset();
    WorkPoolThreads = 0;
  }

private:
  struct XRefEdge {
    Symbol Target;
    Symbol Referrer;
    uint64_t Count = 0;
    uint8_t Flags = 0;
  };

  enum EdgeFlag : uint8_t {
    EdgeApprox = 1 << 0,
    EdgeUnattributed = 1 << 1,
    EdgeTrampoline = 1 << 2,
  };

  struct EdgeInfo {
    uint64_t Count = 0;
    uint8_t Flags = 0;
  };

  struct ReferenceWorkResult {
    // The high and low 32-bit fields contain referrer-id + 1 and
    // target-id + 1 respectively. A zero high field represents an
    // unattributed edge. Integer keys avoid copying two Symbol handles and
    // their hash state into every temporary edge entry.
    std::unordered_map<uint64_t, EdgeInfo> Edges;
    std::unordered_map<uint64_t, uint64_t> DashboardEdgeCounts;
  };

  struct StubWorkResult {
    std::vector<std::pair<Symbol, Symbol>> Mappings;
    std::vector<Chunk> Chunks;
  };

  static std::string normalizeSeparators(std::string Path) {
    std::replace(Path.begin(), Path.end(), '\\', '/');
    return Path;
  }

  size_t workerCount(size_t WorkItems) const {
    if (WorkItems < 2 || !getLinker()->isMultiThreaded())
      return 1;
    return std::max<size_t>(
        1, std::min<size_t>(WorkItems, getLinker()->getPluginThreadCount()));
  }

  template <typename Function>
  void forEachWorkItem(size_t WorkItems, Function &&Fn) {
    size_t NumWorkers = workerCount(WorkItems);
    if (NumWorkers == 1) {
      for (size_t I = 0; I < WorkItems; ++I)
        Fn(I);
      return;
    }

    if (!WorkPool || WorkPoolThreads != NumWorkers) {
      WorkPool = std::make_unique<ThreadPool>(NumWorkers);
      WorkPoolThreads = NumWorkers;
    }
    std::atomic<size_t> Next{0};
    for (size_t Worker = 0; Worker < NumWorkers; ++Worker) {
      WorkPool->run([&] {
        while (true) {
          size_t I = Next.fetch_add(1, std::memory_order_relaxed);
          if (I >= WorkItems)
            break;
          Fn(I);
        }
      });
    }
    WorkPool->wait();
  }

  std::string outputPath(const std::string &RawPath) const {
    auto Cached = OutputPathCache.find(RawPath);
    if (Cached != OutputPathCache.end())
      return Cached->second;

    auto CacheResult = [&](std::string Result) {
      OutputPathCache.emplace(RawPath, Result);
      return Result;
    };
    std::string Path = normalizeSeparators(RawPath);
    std::string Root = normalizeSeparators(SourceRoot);
    while (Root.size() > 1 && Root.back() == '/')
      Root.pop_back();
    while (Path.size() > 1 && Path.back() == '/')
      Path.pop_back();
    if (Root.empty() && !HasStripPrefix)
      return CacheResult(Path);
    if (Root == "/") {
      if (!Path.empty() && Path.front() == '/')
        return CacheResult(Path.substr(1));
      return CacheResult(Path);
    }
    if (!Root.empty() && Path == Root)
      return CacheResult("");
    if (!Root.empty() && Path.size() > Root.size() &&
        Path.compare(0, Root.size(), Root) == 0 &&
        Path[Root.size()] == '/')
      return CacheResult(Path.substr(Root.size() + 1));
    if (StripPrefixPattern) {
      // GlobPattern reports only whether a complete string matches. Try each
      // possible path prefix and retain the longest complete path-component
      // match so wildcard directories can be removed while the suffix is
      // preserved.
      size_t MatchLength = 0;
      for (size_t Length = 1; Length <= Path.size(); ++Length) {
        bool Boundary = Length == Path.size() || Path[Length] == '/' ||
                        Path[Length - 1] == '/';
        if (!Boundary)
          continue;
        llvm::StringRef Candidate(Path.data(), Length);
        if (!StripPrefixPattern->match(Candidate))
          continue;
        MatchLength = Length;
      }
      if (MatchLength != 0) {
        while (MatchLength < Path.size() && Path[MatchLength] == '/')
          ++MatchLength;
        return CacheResult(Path.substr(MatchLength));
      }
    }
    return CacheResult(Path);
  }

  static uint8_t dashboardKind(const Section &S) {
    if (S.isCode())
      return 0; // code
    if (S.isNoBits())
      return 3; // bss
    if (S.isWritable())
      return 2; // initialized data
    return 1; // read-only data
  }

  std::string symbolDisplayName(const Symbol &Sym) const {
    std::string Name = Sym.getName();
    if (CppDemangle)
      Name = llvm::demangle(Name);
    return Name;
  }

  static std::string outputSectionName(const Symbol &Sym) {
    Chunk C = Sym.getChunk();
    if (!C)
      return "<unknown>";
    Section S = C.getSection();
    if (!S)
      return "<unknown>";
    OutputSection O = S.getOutputSection();
    if (!O)
      return "<unknown>";
    std::string Name = O.getName();
    return Name.empty() ? "<unknown>" : Name;
  }

  void buildDashboardSectionsForInputFile(
      InputFile &IF, uint32_t PathID,
      std::vector<DashboardSection> &Sections) {
    for (Section &S : IF.getSections()) {
      // The dashboard models image input sections. Non-allocatable ELF
      // sections (debug, symbol and relocation tables) are not image nodes.
      if (!S.isELFSection() || !S.isAlloc() || S.isNull() || S.isDiscarded())
        continue;

      DashboardSection DS;
      DS.Handle = S;
      DS.PathID = PathID;
      DS.Name = S.getName();
      auto Primary = PrimarySectionSymbols.find(S);
      if (Primary != PrimarySectionSymbols.end())
        DS.Name = symbolDisplayName(Primary->second);
      std::string Output = S.getOutputSection().getName();
      if (!Output.empty()) {
        auto OutputIt = DashboardOutputIDs.find(Output);
        if (OutputIt != DashboardOutputIDs.end())
          DS.OutputID = OutputIt->second;
      }
      DS.Size = S.getSize();
      DS.Kind = dashboardKind(S);
      DS.Live = !S.isGarbageCollected();
      DS.Root = DS.Live && S.getLinkerScriptRule().isKeep();
      Sections.push_back(std::move(DS));
    }
  }

  void buildDashboardSections() {
    PrimarySectionSymbols.clear();
    for (Symbol &Sym : AllSymbols) {
      if (!Sym || Sym.isUndef() || Sym.isSection() || Sym.isFile())
        continue;
      Chunk C = Sym.getChunk();
      if (!C)
        continue;
      Section S = C.getSection();
      if (!S)
        continue;
      auto It = PrimarySectionSymbols.find(S);
      bool Typed = Sym.isFunction() || Sym.isObject();
      bool ExistingTyped = It != PrimarySectionSymbols.end() &&
                           (It->second.isFunction() || It->second.isObject());
      if (It == PrimarySectionSymbols.end() || (Typed && !ExistingTyped) ||
          (Typed == ExistingTyped &&
           Sym.getOffsetInChunk() < It->second.getOffsetInChunk())) {
        if (It == PrimarySectionSymbols.end())
          PrimarySectionSymbols.emplace(S, Sym);
        else
          It->second = Sym;
      }
    }

    DashboardSections.clear();
    DashboardSectionIds.clear();
    DashboardPaths.clear();
    DashboardPathIDs.clear();
    DashboardOutputs.clear();
    DashboardOutputIDs.clear();
    if (eld::Expected<std::vector<OutputSection>> OutputSections =
            getLinker()->getAllOutputSections()) {
      for (const OutputSection &Output : OutputSections.value()) {
        std::string Name = Output.getName();
        if (Name.empty())
          continue;
        if (DashboardOutputIDs.find(Name) == DashboardOutputIDs.end()) {
          uint32_t ID = DashboardOutputs.size();
          DashboardOutputs.push_back(Name);
          DashboardOutputIDs.emplace(std::move(Name), ID);
        }
      }
    }
    std::vector<InputFile> InputFiles;
    std::vector<uint32_t> PathIDs;
    for (InputFile &IF : getLinker()->getInputFiles()) {
      if (!IF.hasInputFile() || IF.isBitcode())
        continue;
      InputFiles.push_back(IF);
      // outputPath() owns a mutable cache, so normalize paths before entering
      // worker threads and pass the immutable result to each worker.
      std::string Path = outputPath(IF.decoratedPath());
      auto It = DashboardPathIDs.find(Path);
      if (It == DashboardPathIDs.end()) {
        uint32_t ID = DashboardPaths.size();
        DashboardPaths.push_back(Path);
        It = DashboardPathIDs.emplace(std::move(Path), ID).first;
      }
      PathIDs.push_back(It->second);
    }

    std::vector<std::vector<DashboardSection>> Sections(InputFiles.size());
    forEachWorkItem(InputFiles.size(), [&](size_t I) {
      buildDashboardSectionsForInputFile(InputFiles[I], PathIDs[I], Sections[I]);
    });

    for (std::vector<DashboardSection> &FileSections : Sections) {
      for (DashboardSection &DS : FileSections) {
        uint32_t ID = DashboardSections.size();
        DashboardSectionIds.emplace(DS.Handle, ID);
        DashboardSections.push_back(std::move(DS));
      }
    }
  }

  static bool parseYesNo(const std::string &Value, bool &Out) {
    if (Value == "yes") {
      Out = true;
      return true;
    }
    if (Value == "no") {
      Out = false;
      return true;
    }
    return false;
  }

  // Parses Value as a non-negative base-10 integer, rejecting empty
  // strings, a leading '-' (strtoull would otherwise accept it and wrap
  // around), and any trailing non-digit characters.
  static bool parseNonNegativeInt(const std::string &Value, uint64_t &Out) {
    if (Value.empty() || Value.find('-') != std::string::npos)
      return false;
    const char *Begin = Value.c_str();
    char *End = nullptr;
    errno = 0;
    unsigned long long V = std::strtoull(Begin, &End, 10);
    if (End != Begin + Value.size() || errno == ERANGE)
      return false;
    Out = V;
    return true;
  }

  // Splits Value on commas and compiles each piece as a glob pattern,
  // appending the results to Patterns. The glob text itself is stashed in
  // GlobStorage first, since llvm::GlobPattern stores a StringRef into
  // whatever string it was created from rather than copying it; GlobStorage
  // is a deque so earlier elements' addresses stay stable as later globs are
  // added. Reports a diagnostic and returns false on the first malformed
  // pattern.
  bool parseGlobList(const std::string &Value,
                      std::vector<llvm::GlobPattern> &Patterns) {
    std::istringstream Globs(Value);
    std::string Glob;
    while (std::getline(Globs, Glob, ',')) {
      if (Glob.empty())
        continue;
      const std::string &Stored = GlobStorage.emplace_back(std::move(Glob));
      llvm::Expected<llvm::GlobPattern> ExpPattern =
          llvm::GlobPattern::create(Stored);
      if (!ExpPattern) {
        HasError = true;
        getLinker()->reportDiag(
            getLinker()->getErrorDiagID(
                "CrossReference could not parse glob pattern '%0': %1"),
            Stored, llvm::toString(ExpPattern.takeError()));
        return false;
      }
      Patterns.push_back(std::move(ExpPattern.get()));
    }
    return true;
  }

  // Returns true if Sym should be omitted from the dump (and from any edge
  // it participates in) because its name matches an exclude_symbols
  // pattern, or its origin file matches an exclude_files pattern, or it
  // fails to match any include_symbols pattern (when given), or it is a
  // local symbol and exclude_local=yes, or it is a function/data symbol
  // and exclude_functions/exclude_data=yes, or it is smaller than
  // min_size, or it has fewer than min_refs incoming edges.
  bool isExcluded(const Symbol &Sym) const {
    std::string Name;
    auto GetName = [&]() -> const std::string & {
      if (Name.empty()) {
        Name = Sym.getName();
        if (CppDemangle)
          Name = llvm::demangle(Name);
      }
      return Name;
    };
    if (!ExcludeSymbolPatterns.empty()) {
      for (const llvm::GlobPattern &Pattern : ExcludeSymbolPatterns)
        if (Pattern.match(GetName()))
          return true;
    }
    if (!ExcludeFilePatterns.empty()) {
      std::string File = outputPath(Sym.getResolvedPath());
      for (const llvm::GlobPattern &Pattern : ExcludeFilePatterns)
        if (Pattern.match(File))
          return true;
    }
    if (!IncludeSymbolPatterns.empty()) {
      bool Matched = false;
      for (const llvm::GlobPattern &Pattern : IncludeSymbolPatterns) {
        if (Pattern.match(GetName())) {
          Matched = true;
          break;
        }
      }
      if (!Matched)
        return true;
    }
    if (ExcludeLocal && Sym.isLocal())
      return true;
    if (ExcludeFunctions && Sym.isFunction())
      return true;
    if (ExcludeData && Sym.isObject())
      return true;
    if (MinSize > 0 && Sym.getSize() < MinSize)
      return true;
    if (MinRefs > 0) {
      auto It = IncomingRefCount.find(Sym);
      uint64_t Count = It != IncomingRefCount.end() ? It->second : 0;
      if (Count < MinRefs)
        return true;
    }
    return false;
  }

  // Returns true if Edge should be omitted because exclude_intra_file=yes
  // and its referrer and target both originate from the same resolved
  // source file. Unlike isExcluded(), this only ever affects edges: the
  // symbols themselves are still listed in the "# Symbols:" section.
  bool isIntraFileExcluded(const XRefEdge &E) const {
    if (!ExcludeIntraFile || !E.Referrer)
      return false;
    return outputPath(E.Referrer.getResolvedPath()) ==
           outputPath(E.Target.getResolvedPath());
  }

  // Populates IncomingRefCount (symbol -> number of edges targeting it)
  // from the full, unfiltered Edges graph, so that min_refs reflects true
  // connectivity regardless of what other filtering options later remove
  // from the dump.
  void computeIncomingRefCounts() {
    if (MinRefs == 0)
      return;
    for (const XRefEdge &E : Edges)
      IncomingRefCount[E.Target] += E.Count;
  }

  // Populates StubSymbolToTarget (stub symbol -> real target symbol) and
  // StubChunks (chunks that are themselves branch islands), by inspecting
  // every stub created in every output section.
  void buildStubMapForOutputSection(OutputSection &O, StubWorkResult &Result) {
    for (Stub &St : O.getStubs()) {
      Symbol StubSym = St.getStubSymbol();
      Symbol TargetSym = St.getTargetSymbol();
      if (!StubSym || !TargetSym)
        continue;
      Result.Mappings.emplace_back(StubSym, TargetSym);
      Chunk StubChunk = StubSym.getChunk();
      if (StubChunk)
        Result.Chunks.push_back(StubChunk);
    }
  }

  void buildStubMap() {
    StubSymbolToTarget.clear();
    StubChunks.clear();
    eld::Expected<std::vector<OutputSection>> ExpSections =
        getLinker()->getAllOutputSections();
    if (!ExpSections) {
      getLinker()->reportDiagEntry(std::move(ExpSections.error()));
      return;
    }

    std::vector<OutputSection> &OutputSections = ExpSections.value();
    std::vector<StubWorkResult> Results(OutputSections.size());
    forEachWorkItem(OutputSections.size(), [&](size_t I) {
      buildStubMapForOutputSection(OutputSections[I], Results[I]);
    });

    for (StubWorkResult &Result : Results) {
      for (const auto &Mapping : Result.Mappings)
        StubSymbolToTarget.emplace(Mapping.first, Mapping.second);
      for (Chunk C : Result.Chunks)
        StubChunks.insert(C);
    }
  }

  // Finds the symbol in Sorted (sorted ascending by Offset) that best
  // explains a reference at SiteOffset within the same chunk: the nearest
  // preceding symbol, tagged Exact if SiteOffset actually falls within that
  // symbol's [Offset, Offset + Size) range, or NearestPreceding otherwise.
  static AttributionKind findReferrer(llvm::ArrayRef<SymbolOffset> Sorted,
                                       off_t SiteOffset, Symbol &OutSym) {
    auto It = std::upper_bound(
        Sorted.begin(), Sorted.end(), SiteOffset,
        [](off_t Offset, const SymbolOffset &SO) {
          return Offset < SO.Offset;
        });
    if (It == Sorted.begin())
      return AttributionKind::Unattributed;
    const SymbolOffset *Best = &*std::prev(It);
    OutSym = Best->Sym;
    if (SiteOffset < Best->Offset + static_cast<off_t>(Best->Size))
      return AttributionKind::Exact;
    return AttributionKind::NearestPreceding;
  }

  // Builds ChunkSymbolsCache (chunk -> offset-sorted symbols defined in that
  // chunk) from AllSymbols rather than from Chunk::getSymbols(): the latter
  // explicitly excludes global symbols in garbage-collected sections (see
  // its "Skip symbols that are garbage collected" check), which would make
  // it impossible to attribute a GC'd referrer's own outgoing edges back to
  // it. AllSymbols is sourced from InputFile::getSymbols(), which has no
  // such exclusion, so this cache stays correct for the pre-GC graph.
  void buildChunkSymbolIndex() {
    ChunkSymbolsCache.clear();
    ChunkSymbolIndex.clear();
    ChunkSymbolIndex.reserve(AllSymbols.size());

    std::unordered_map<Chunk, std::vector<SymbolOffset>> Temporary;
    for (Symbol &Sym : AllSymbols) {
      Chunk C = Sym.getChunk();
      if (!C)
        continue;
      Temporary[C].push_back({Sym, Sym.getOffsetInChunk(), Sym.getSize()});
    }
    std::vector<std::vector<SymbolOffset> *> SortWork;
    SortWork.reserve(Temporary.size());
    for (auto &Entry : Temporary)
      SortWork.push_back(&Entry.second);

    forEachWorkItem(SortWork.size(), [&](size_t I) {
      std::vector<SymbolOffset> *Symbols = SortWork[I];
      std::sort(Symbols->begin(), Symbols->end(),
                [](const SymbolOffset &A, const SymbolOffset &B) {
                  return A.Offset < B.Offset;
                });
    });

    for (auto &Entry : Temporary) {
      uint32_t Begin = ChunkSymbolIndex.size();
      ChunkSymbolIndex.insert(ChunkSymbolIndex.end(), Entry.second.begin(),
                              Entry.second.end());
      uint32_t End = ChunkSymbolIndex.size();
      ChunkSymbolsCache.emplace(Entry.first, ChunkSymbolRange{Begin, End});
    }
  }

  // Returns the offset-sorted symbol list for the chunk that defines Sym, as
  // computed by buildChunkSymbolIndex(). Returns an empty list if the chunk
  // defines no symbols known to AllSymbols.
  llvm::ArrayRef<SymbolOffset> getSortedSymbols(Chunk &C) const {
    auto It = ChunkSymbolsCache.find(C);
    if (It == ChunkSymbolsCache.end())
      return {};
    return llvm::ArrayRef<SymbolOffset>(
        ChunkSymbolIndex.data() + It->second.Begin,
        It->second.End - It->second.Begin);
  }

  void walkReferencesForInputFile(InputFile &IF, ReferenceWorkResult &Result) {
    for (Section &S : IF.getSections()) {
      // Discarded sections (e.g. duplicate COMDAT group members) never
      // had live relocations to begin with. Garbage-collected sections
      // are deliberately still walked: their relocations and fragment
      // identity remain intact (GC only marks sections Ignore; it does
      // not clear relocation data or move fragments), so their edges can
      // still be recovered and included in the pre-GC connectivity graph.
      if (!S.isELFSection() || S.isDiscarded())
        continue;

      eld::Expected<std::vector<Use>> ExpUses = getLinker()->getUses(S);
      if (!ExpUses) {
        getLinker()->reportDiagEntry(std::move(ExpUses.error()));
        continue;
      }
      for (Use &U : ExpUses.value()) {
        Chunk SrcChunk = U.getSourceChunk();
        if (!SrcChunk || StubChunks.count(SrcChunk))
          continue;

        Symbol TargetSym = U.getSymbol();
        // Some relocations (e.g. R_RISCV_RELAX, a linker-relaxation
        // hint) point at the reserved symtab entry 0 rather than any
        // real symbol. That resolves to the linker's internal null-
        // symbol sentinel: a non-null Symbol handle with an empty name
        // and no origin file. Such a "reference" has no real callee to
        // report, so it is skipped here rather than passed to
        // qualifySymbol(), which assumes every symbol it prints has an
        // origin file.
        if (!TargetSym || TargetSym.getName().empty())
          continue;
        bool Trampoline = false;
        auto StubIt = StubSymbolToTarget.find(TargetSym);
        if (StubIt != StubSymbolToTarget.end()) {
          TargetSym = StubIt->second;
          Trampoline = true;
        }

        Symbol ReferrerSym(nullptr);
        Section SrcSection = SrcChunk.getSection();
        uint8_t EdgeFlags = 0;
        if (Format == OutputFormat::Text) {
          llvm::ArrayRef<SymbolOffset> Sorted = getSortedSymbols(SrcChunk);
          AttributionKind Kind =
              findReferrer(Sorted, U.getOffsetInChunk(), ReferrerSym);
          if (Kind == AttributionKind::Unattributed)
            EdgeFlags |= EdgeUnattributed;
          else if (Kind == AttributionKind::NearestPreceding)
            EdgeFlags |= EdgeApprox;
          if (Kind == AttributionKind::Unattributed && SrcSection &&
              !SrcSection.isCode()) {
            auto Primary = PrimarySectionSymbols.find(SrcSection);
            if (Primary != PrimarySectionSymbols.end() &&
                Primary->second.isObject()) {
              // Data sections such as vtables can contain a relocation before
              // the first symbol covered by the chunk index. Associate those
              // references with the section's primary data symbol instead of
              // losing the source entirely.
              ReferrerSym = Primary->second;
              EdgeFlags &= ~EdgeUnattributed;
              EdgeFlags |= EdgeApprox;
            }
          }
        }
        if (Trampoline)
          EdgeFlags |= EdgeTrampoline;
        if (Format == OutputFormat::Text) {
          auto TargetIt = SymbolIDs.find(TargetSym);
          if (TargetIt != SymbolIDs.end()) {
            uint32_t ReferrerID = 0;
            if (ReferrerSym) {
              auto ReferrerIt = SymbolIDs.find(ReferrerSym);
              if (ReferrerIt != SymbolIDs.end())
                ReferrerID = ReferrerIt->second + 1;
            }
            uint32_t TargetID = TargetIt->second + 1;
            uint64_t Key = (static_cast<uint64_t>(ReferrerID) << 32) |
                           static_cast<uint64_t>(TargetID);
            EdgeInfo &Info = Result.Edges[Key];
            ++Info.Count;
            Info.Flags |= EdgeFlags;
          }
        }

        // The dashboard graph is section-oriented. Keep it independent of
        // symbol filters and show_gc: eliminated sections are deliberately
        // retained as nodes, and repeated relocations are merged into one
        // weighted source-to-target edge.
        Chunk TargetChunk = TargetSym.getChunk();
        if (!TargetChunk)
          continue;
        Section DstSection = TargetChunk.getSection();
        auto SrcIt = DashboardSectionIds.find(SrcSection);
        auto DstIt = DashboardSectionIds.find(DstSection);
        if (SrcIt != DashboardSectionIds.end() &&
            DstIt != DashboardSectionIds.end() &&
            SrcIt->second != DstIt->second) {
          uint64_t Key = (static_cast<uint64_t>(SrcIt->second) << 32) |
                         DstIt->second;
          ++Result.DashboardEdgeCounts[Key];
        }
      }
    }
  }

  void walkReferences() {
    Edges.clear();
    DashboardEdgeCounts.clear();
    std::vector<InputFile> InputFiles;
    for (InputFile &IF : getLinker()->getInputFiles())
      if (IF.hasInputFile() && !IF.isBitcode())
        InputFiles.push_back(IF);

    std::vector<ReferenceWorkResult> Results(InputFiles.size());
    forEachWorkItem(InputFiles.size(), [&](size_t I) {
      walkReferencesForInputFile(InputFiles[I], Results[I]);
    });

    std::unordered_map<uint64_t, EdgeInfo> EdgeCounts;
    for (ReferenceWorkResult &Result : Results) {
      for (const auto &Entry : Result.Edges) {
        EdgeInfo &Info = EdgeCounts[Entry.first];
        Info.Count += Entry.second.Count;
        Info.Flags |= Entry.second.Flags;
      }
      for (const auto &Entry : Result.DashboardEdgeCounts)
        DashboardEdgeCounts[Entry.first] += Entry.second;
      Result.Edges.clear();
      Result.DashboardEdgeCounts.clear();
    }
    Edges.reserve(EdgeCounts.size());
    for (const auto &Entry : EdgeCounts)
      Edges.push_back(
          {AllSymbols[(Entry.first & 0xffffffffu) - 1],
           (Entry.first >> 32) == 0
               ? Symbol(nullptr)
               : AllSymbols[(Entry.first >> 32) - 1],
           Entry.second.Count, Entry.second.Flags});
    if (Format == OutputFormat::Text) {
      SymbolIDs.clear();
      SymbolIDs.rehash(0);
      ChunkSymbolsCache.clear();
      ChunkSymbolsCache.rehash(0);
      std::vector<SymbolOffset>().swap(ChunkSymbolIndex);
    }
  }

  // Collects symbols directly from each input file's own symbol table
  // rather than via LinkerWrapper::getAllSymbols(): that API only returns
  // Module-level output symbols, which excludes symbols defined in
  // garbage-collected ("Ignore") sections (see
  // ObjectLinker::addSymbolToOutput()). InputFile::getSymbols() reads the
  // input file's own local/global symbol tables, so garbage-collected
  // symbols are still visible there and can be included in the dump (with
  // a "?" address, since qualifySymbol() cannot report a real address for
  // a symbol that never reached final layout).
  void collectAllSymbols() {
    AllSymbols.clear();
    SymbolIDs.clear();
    std::vector<InputFile> InputFiles;
    for (InputFile &IF : getLinker()->getInputFiles())
      if (IF.hasInputFile() && !IF.isBitcode())
        InputFiles.push_back(IF);

    std::vector<std::vector<Symbol>> Symbols(InputFiles.size());
    forEachWorkItem(InputFiles.size(), [&](size_t I) {
      Symbols[I] = InputFiles[I].getSymbols();
    });

    for (std::vector<Symbol> &FileSymbols : Symbols) {
      for (Symbol &Sym : FileSymbols) {
        if (Format == OutputFormat::Text &&
            SymbolIDs.find(Sym) == SymbolIDs.end())
          SymbolIDs.emplace(Sym, AllSymbols.size());
        AllSymbols.push_back(Sym);
      }
    }
  }

  // Populates SymbolSourceLoc (symbol -> declaring source file + line) from
  // DWARF debug info, when usedwarf=yes. For each input file that defines at
  // least one collected symbol, this parses its DWARF (if present) once and
  // indexes every subprogram and variable DIE by name; each of that file's
  // symbols is then looked up by name in that index. Symbols with no debug info, or
  // whose input file has none, simply have no entry and are reported without
  // source location, same as before this option existed.
  void buildDWARFIndex() {
    SymbolSourceLoc.clear();
    std::vector<InputFile> InputFiles;
    std::unordered_map<InputFile, size_t> InputFileIDs;
    for (Symbol &Sym : AllSymbols) {
      InputFile IF = Sym.getInputFile();
      if (!IF)
        continue;
      if (InputFileIDs.find(IF) == InputFileIDs.end()) {
        size_t ID = InputFiles.size();
        InputFileIDs.emplace(IF, ID);
        InputFiles.push_back(IF);
      }
    }

    using NamedDIEIndex = std::unordered_map<std::string, SourceLoc>;
    std::vector<std::unordered_set<std::string>> WantedNames(InputFiles.size());
    for (Symbol &Sym : AllSymbols) {
      auto FileIt = InputFileIDs.find(Sym.getInputFile());
      if (FileIt == InputFileIDs.end() || isExcluded(Sym))
        continue;
      WantedNames[FileIt->second].insert(Sym.getName());
    }

    std::vector<NamedDIEIndex> PerFileNamedDIEs(InputFiles.size());
    forEachWorkItem(InputFiles.size(), [&](size_t I) {
      PerFileNamedDIEs[I] =
          indexNamedDIEsByName(InputFiles[I], WantedNames[I]);
    });

    for (Symbol &Sym : AllSymbols) {
      InputFile IF = Sym.getInputFile();
      auto FileIt = InputFileIDs.find(IF);
      if (FileIt == InputFileIDs.end())
        continue;
      auto NameIt = PerFileNamedDIEs[FileIt->second].find(Sym.getName());
      if (NameIt != PerFileNamedDIEs[FileIt->second].end())
        SymbolSourceLoc.emplace(Sym, NameIt->second);
    }
  }

  // Parses IF's DWARF debug info (if any) and returns a map from each
  // subprogram or variable DIE's name to its declaring source file + line,
  // across every compile unit in the file. Returns an empty map if IF has no
  // DWARF context (e.g. it was not compiled with debug info). Only names in
  // WantedNames are indexed; symbols filtered from the text dump do not need
  // DWARF source locations.
  std::unordered_map<std::string, SourceLoc>
  indexNamedDIEsByName(InputFile &IF,
                      const std::unordered_set<std::string> &WantedNames) {
    std::unordered_map<std::string, SourceLoc> Index;
    if (WantedNames.empty())
      return Index;
    eld::Expected<DWARFInfo> ExpDI =
        getLinker()->getDWARFInfoForInputFile(IF, getLinker()->is32Bits());
    if (!ExpDI) {
      getLinker()->reportDiagEntry(std::move(ExpDI.error()));
      return Index;
    }
    DWARFInfo DI = ExpDI.value();
    if (!DI.hasDWARFContext())
      return Index;
    for (DWARFUnit &DU : DI.getDWARFUnits()) {
      for (DWARFDie &Die : DU.getDIEs()) {
        if (!Die.isSubprogramDIE() && !Die.isVariable())
          continue;
        std::string Name = Die.getName();
        if (Name.empty() || WantedNames.find(Name) == WantedNames.end())
          continue;
        Index.emplace(Name, SourceLoc{Die.getDeclFile(), Die.getDeclLine()});
      }
    }
    return Index;
  }

  // Local symbols with the same name can appear in different input files
  // (e.g. a static helper named "helper" defined in both a.c and b.c), so a
  // bare symbol name is not always unique enough to identify which
  // definition is meant. Every symbol name in the dump is therefore
  // qualified with its origin file, size, and virtual address, as
  // tab-delimited fields: "name\tfile\t0xsize\taddress". When DWARF
  // source information is available, it is appended to the name as
  // "name (source-file:line)". A symbol that was garbage collected never
  // reaches final layout, so it has no meaningful address; its address field
  // is reported as "?" instead.
  std::string qualifySymbol(const Symbol &Sym) const {
    std::ostringstream OS;
    std::string Name = Sym.getName();
    if (CppDemangle)
      Name = llvm::demangle(Name);
    OS << Name;
    if (UseDWARF) {
      auto It = SymbolSourceLoc.find(Sym);
      if (It != SymbolSourceLoc.end())
        OS << " (" << outputPath(It->second.File) << ":" << std::dec
           << It->second.Line << ")";
    }
    OS << "\t" << outputPath(Sym.getResolvedPath()) << "\t0x" << std::hex
       << Sym.getSize() << "\t";
    if (Sym.isGarbageCollected())
      OS << "?";
    else
      OS << "0x" << std::hex << Sym.getAddress();
    return OS.str();
  }

  void writeTextDump(std::ostream &Out) {
    std::unordered_map<Symbol, uint32_t> SymbolIDs;
    std::vector<Symbol> PrintedSymbols;
    for (Symbol &Sym : AllSymbols) {
      if (!ShowGC && Sym.isGarbageCollected())
        continue;
      if (isExcluded(Sym))
        continue;
      if (SymbolIDs.find(Sym) == SymbolIDs.end()) {
        uint32_t ID = PrintedSymbols.size();
        SymbolIDs.emplace(Sym, ID);
        PrintedSymbols.push_back(Sym);
      }
    }

    struct TextEdgeKey {
      int64_t Source;
      uint32_t Target;
      bool operator<(const TextEdgeKey &Other) const {
        return std::tie(Source, Target) < std::tie(Other.Source, Other.Target);
      }
    };
    struct TextEdgeInfo {
      uint64_t Count = 0;
      bool Approx = false;
      bool Unattributed = false;
      bool Trampoline = false;
    };
    std::map<TextEdgeKey, TextEdgeInfo> Counts;
    for (XRefEdge &E : Edges) {
      if (!ShowGC && (E.Target.isGarbageCollected() ||
                       (E.Referrer && E.Referrer.isGarbageCollected())))
        continue;
      if (isExcluded(E.Target) || (E.Referrer && isExcluded(E.Referrer)))
        continue;
      if (isIntraFileExcluded(E))
        continue;
      auto TargetIt = SymbolIDs.find(E.Target);
      if (TargetIt == SymbolIDs.end())
        continue;
      int64_t Source = -1;
      if (E.Referrer) {
        auto SourceIt = SymbolIDs.find(E.Referrer);
        if (SourceIt == SymbolIDs.end())
          continue;
        Source = SourceIt->second;
      }
      TextEdgeInfo &Info = Counts[{Source, TargetIt->second}];
      Info.Count += E.Count;
      Info.Approx |= (E.Flags & EdgeApprox) != 0;
      Info.Unattributed |= (E.Flags & EdgeUnattributed) != 0;
      Info.Trampoline |= (E.Flags & EdgeTrampoline) != 0;
    }

    Out << "# Symbols: <id>\t<name>\t<file>\t0x<size>\t<address>\t"
           "<output-section>\n";
    Out << "#   '?' address means garbage-collected; section is the linked "
           "output section.\n";
    Out << "#   with usedwarf=yes, source appears after the name as "
           "(file:line).\n";
    for (uint32_t ID = 0; ID < PrintedSymbols.size(); ++ID)
      Out << ID << "\t" << qualifySymbol(PrintedSymbols[ID]) << "\t"
          << outputSectionName(PrintedSymbols[ID]) << "\n";
    Out << "# Edges: <src-id>\t<dst-id>\t<count>\t<flags>\n";
    Out << "#   '-' source means unattributed; '-' flags means none; flags: "
           "approx, unattributed, trampoline.\n";
    for (const auto &Entry : Counts) {
      const TextEdgeKey &K = Entry.first;
      const TextEdgeInfo &Info = Entry.second;
      if (K.Source < 0)
        Out << "-";
      else
        Out << K.Source;
      Out << "\t" << K.Target << "\t" << Info.Count << "\t";
      bool HasFlag = false;
      if (Info.Approx) {
        Out << "approx";
        HasFlag = true;
      }
      if (Info.Unattributed) {
        Out << (HasFlag ? "," : "") << "unattributed";
        HasFlag = true;
      }
      if (Info.Trampoline) {
        Out << (HasFlag ? "," : "") << "trampoline";
        HasFlag = true;
      }
      if (!HasFlag)
        Out << "-";
      Out << "\n";
    }
  }

  static llvm::StringRef dashboardKindToString(uint8_t Kind) {
    switch (Kind) {
    case 0:
      return "code";
    case 1:
      return "rodata";
    case 2:
      return "data";
    case 3:
      return "bss";
    }
    return "code";
  }

  void writeDashboardObject(std::ostream &Out) {
    std::vector<std::pair<uint64_t, uint64_t>> SortedEdges;
    SortedEdges.reserve(DashboardEdgeCounts.size());
    for (const auto &Entry : DashboardEdgeCounts)
      SortedEdges.push_back(Entry);
    std::sort(SortedEdges.begin(), SortedEdges.end(),
              [](const auto &A, const auto &B) { return A.first < B.first; });

    llvm::raw_os_ostream RawOut(Out);
    llvm::json::OStream JSON(RawOut);
    JSON.object([&] {
      JSON.attributeArray("nodes", [&] {
        for (uint32_t ID = 0; ID < DashboardSections.size(); ++ID) {
          const DashboardSection &S = DashboardSections[ID];
          JSON.object([&] {
            JSON.attribute("id", ID);
            JSON.attribute("name", S.Name);
            JSON.attribute("path", dashboardPath(S.PathID));
            JSON.attribute("kind", dashboardKindToString(S.Kind));
            JSON.attribute("size", S.Size);
            if (!S.Live)
              JSON.attribute("live", false);
            if (S.Root)
              JSON.attribute("root", true);
            if (S.OutputID != UINT32_MAX)
              JSON.attribute("out", DashboardOutputs[S.OutputID]);
          });
        }
      });
      JSON.attributeArray("edges", [&] {
        for (const auto &Entry : SortedEdges) {
          JSON.object([&] {
            JSON.attribute("src", static_cast<uint32_t>(Entry.first >> 32));
            JSON.attribute("dst", static_cast<uint32_t>(Entry.first));
            JSON.attribute("count", Entry.second);
          });
        }
      });
      if (CoalesceDirs)
        JSON.attribute("coalesce_dirs", "unary");
    });
    JSON.flush();
    RawOut << '\n';
  }

  void writeDashboardColumnar(std::ostream &Out) {
    using StringKey = std::pair<int, std::string>;
    std::map<StringKey, int> DirIDs;
    std::vector<StringKey> Dirs;
    std::map<StringKey, int> FileIDs;
    std::vector<StringKey> Files;
    std::map<std::string, int> OutIDs;
    std::vector<std::string> Outs;

    auto internDir = [&](int Parent, const std::string &Name) {
      StringKey Key{Parent, Name};
      auto It = DirIDs.find(Key);
      if (It != DirIDs.end())
        return It->second;
      int ID = Dirs.size();
      DirIDs.emplace(Key, ID);
      Dirs.push_back(std::move(Key));
      return ID;
    };
    auto internFile = [&](int Dir, const std::string &Name) {
      StringKey Key{Dir, Name};
      auto It = FileIDs.find(Key);
      if (It != FileIDs.end())
        return It->second;
      int ID = Files.size();
      FileIDs.emplace(Key, ID);
      Files.push_back(std::move(Key));
      return ID;
    };
    auto internOut = [&](const std::string &Name) {
      auto It = OutIDs.find(Name);
      if (It != OutIDs.end())
        return It->second;
      int ID = Outs.size();
      OutIDs.emplace(Name, ID);
      Outs.push_back(Name);
      return ID;
    };
    auto internPath = [&](const std::string &Path) {
      size_t Slash = Path.rfind('/');
      std::string DirPart = Slash == std::string::npos
                                ? ""
                                : Path.substr(0, Slash);
      std::string Base = Slash == std::string::npos ? Path
                                                      : Path.substr(Slash + 1);
      int Parent = -1;
      size_t Start = 0;
      while (Start < DirPart.size()) {
        size_t End = DirPart.find('/', Start);
        if (End == std::string::npos)
          End = DirPart.size();
        if (End > Start)
          Parent = internDir(Parent, DirPart.substr(Start, End - Start));
        Start = End + 1;
      }
      return internFile(Parent, Base.empty() ? "unknown" : Base);
    };

    std::vector<int> SectionFiles;
    std::vector<int> SectionOuts;
    SectionFiles.reserve(DashboardSections.size());
    SectionOuts.reserve(DashboardSections.size());
    for (const DashboardSection &S : DashboardSections) {
      SectionFiles.push_back(internPath(dashboardPath(S.PathID)));
      SectionOuts.push_back(S.OutputID == UINT32_MAX
                                ? -1
                                : internOut(DashboardOutputs[S.OutputID]));
    }

    std::vector<std::pair<uint64_t, uint64_t>> SortedEdges;
    SortedEdges.reserve(DashboardEdgeCounts.size());
    for (const auto &Entry : DashboardEdgeCounts)
      SortedEdges.push_back(Entry);
    std::sort(SortedEdges.begin(), SortedEdges.end(),
              [](const auto &A, const auto &B) { return A.first < B.first; });

    llvm::raw_os_ostream RawOut(Out);
    llvm::json::OStream JSON(RawOut);
    JSON.object([&] {
      JSON.attribute("format", "fia-columnar");
      JSON.attribute("version", 1);
      JSON.attributeObject("strings", [&] {
        JSON.attributeArray("dirs", [&] {
          for (const StringKey &D : Dirs)
            JSON.array([&] {
              JSON.value(D.first);
              JSON.value(D.second);
            });
        });
        JSON.attributeArray("files", [&] {
          for (const StringKey &F : Files)
            JSON.array([&] {
              JSON.value(F.first);
              JSON.value(F.second);
            });
        });
        JSON.attributeArray("outs", [&] {
          for (const std::string &Name : Outs)
            JSON.value(Name);
        });
      });
      JSON.attributeObject("sections", [&] {
        JSON.attribute("count", static_cast<uint32_t>(DashboardSections.size()));
        auto SectionValues = [&](auto Emit) {
          for (size_t I = 0; I < DashboardSections.size(); ++I)
            Emit(I, DashboardSections[I]);
        };
        JSON.attributeArray("size", [&] {
          SectionValues([&](size_t, const DashboardSection &S) {
            JSON.value(S.Size);
          });
        });
        JSON.attributeArray("file", [&] {
          SectionValues([&](size_t I, const DashboardSection &) {
            JSON.value(SectionFiles[I]);
          });
        });
        JSON.attributeArray("out", [&] {
          SectionValues([&](size_t I, const DashboardSection &) {
            JSON.value(SectionOuts[I]);
          });
        });
        JSON.attributeArray("kind", [&] {
          SectionValues([&](size_t, const DashboardSection &S) {
            JSON.value(S.Kind);
          });
        });
        JSON.attributeArray("flags", [&] {
          SectionValues([&](size_t, const DashboardSection &S) {
            uint8_t SectionFlags = (!S.Live ? 1 : 0) | (S.Root ? 2 : 0);
            JSON.value(SectionFlags);
          });
        });
        JSON.attributeArray("name", [&] {
          SectionValues([&](size_t, const DashboardSection &S) {
            JSON.value(S.Name);
          });
        });
      });
      JSON.attributeObject("refs", [&] {
        JSON.attributeArray("offsets", [&] {
          uint64_t RefCount = 0;
          JSON.value(RefCount);
          for (uint32_t Src = 0; Src < DashboardSections.size(); ++Src) {
            while (RefCount < SortedEdges.size() &&
                   (SortedEdges[RefCount].first >> 32) == Src)
              ++RefCount;
            JSON.value(RefCount);
          }
        });
        JSON.attributeArray("targets", [&] {
          for (const auto &Entry : SortedEdges)
            JSON.value(static_cast<uint32_t>(Entry.first));
        });
        JSON.attributeArray("counts", [&] {
          for (const auto &Entry : SortedEdges)
            JSON.value(Entry.second);
        });
      });
      if (CoalesceDirs)
        JSON.attribute("coalesce_dirs", "unary");
    });
    JSON.flush();
    RawOut << '\n';
  }

  std::string dashboardPath(uint32_t PathID) const {
    const std::string &Path = DashboardPaths[PathID];
    return CoalesceDirs ? DashboardPathCompressor.coalesce(Path) : Path;
  }

  static void writeLE32(std::ostream &Out, uint32_t Value) {
    char Bytes[4];
    for (unsigned Shift = 0; Shift < 32; Shift += 8)
      Bytes[Shift / 8] = static_cast<char>((Value >> Shift) & 0xff);
    Out.write(Bytes, sizeof(Bytes));
  }

  bool writeGzipDump(const std::string &Path, const std::string &Payload) {
    if (!llvm::compression::zlib::isAvailable()) {
      getLinker()->reportDiag(getLinker()->getErrorDiagID(
          "CrossReference cannot use gzip because zlib support is unavailable"));
      return false;
    }

    llvm::ArrayRef<uint8_t> Input(
        reinterpret_cast<const uint8_t *>(Payload.data()), Payload.size());
    llvm::SmallVector<uint8_t, 0> ZlibData;
    llvm::compression::zlib::compress(
        Input, ZlibData, llvm::compression::zlib::BestSizeCompression);
    // LLVM's zlib helper produces a zlib-wrapped DEFLATE stream. Gzip uses
    // the same DEFLATE payload, with a different header and trailer.
    if (ZlibData.size() < 6) {
      getLinker()->reportDiag(getLinker()->getErrorDiagID(
          "CrossReference failed to create gzip output"));
      return false;
    }

    const char Header[] = {char(0x1f), char(0x8b), char(0x08), char(0x00),
                           char(0x00), char(0x00), char(0x00), char(0x00),
                           char(0x02), char(0x03)};
    std::ofstream Out(Path, std::ios::out | std::ios::binary | std::ios::trunc);
    if (!Out) {
      getLinker()->reportDiag(
          getLinker()->getErrorDiagID(
              "CrossReference could not open dump file '%0' for "
              "writing"),
          Path);
      return false;
    }
    Out.write(Header, sizeof(Header));
    Out.write(reinterpret_cast<const char *>(ZlibData.data() + 2),
              ZlibData.size() - 6);
    writeLE32(Out, llvm::crc32(Input));
    writeLE32(Out, static_cast<uint32_t>(Payload.size()));
    if (!Out) {
      getLinker()->reportDiag(
          getLinker()->getErrorDiagID(
              "CrossReference could not write dump file '%0'"),
          Path);
      return false;
    }
    return true;
  }

  void writeDump() {
    if (!Gzip) {
      std::ofstream Out(DumpPath, std::ios::out | std::ios::trunc);
      if (!Out) {
        getLinker()->reportDiag(
            getLinker()->getErrorDiagID(
                "CrossReference could not open dump file '%0' for "
                "writing"),
            DumpPath);
        return;
      }
      if (Format == OutputFormat::DashboardObject)
        writeDashboardObject(Out);
      else if (Format == OutputFormat::DashboardColumnar)
        writeDashboardColumnar(Out);
      else
        writeTextDump(Out);
      return;
    }

    std::ostringstream Buffer;
    if (Format == OutputFormat::DashboardObject)
      writeDashboardObject(Buffer);
    else if (Format == OutputFormat::DashboardColumnar)
      writeDashboardColumnar(Buffer);
    else
      writeTextDump(Buffer);
    writeGzipDump(DumpPath + ".gz", Buffer.str());
  }

  std::string DumpPath;
  bool HasError = false;
  bool ShowGC = false;
  bool CppDemangle = false;
  bool UseDWARF = false;
  bool Gzip = false;
  bool CoalesceDirs = false;
  OutputFormat Format = OutputFormat::Text;
  std::string SourceRoot;
  bool HasSourceRoot = false;
  bool HasStripPrefix = false;
  std::optional<llvm::GlobPattern> StripPrefixPattern;
  std::deque<std::string> GlobStorage;
  std::vector<llvm::GlobPattern> ExcludeSymbolPatterns;
  std::vector<llvm::GlobPattern> ExcludeFilePatterns;
  std::vector<llvm::GlobPattern> IncludeSymbolPatterns;
  bool ExcludeLocal = true;
  bool ExcludeFunctions = false;
  bool ExcludeData = false;
  uint64_t MinSize = 0;
  uint64_t MinRefs = 0;
  bool ExcludeIntraFile = false;
  mutable std::unordered_map<std::string, std::string> OutputPathCache;
  std::unique_ptr<ThreadPool> WorkPool;
  size_t WorkPoolThreads = 0;
  std::unordered_map<Symbol, uint64_t> IncomingRefCount;
  std::unordered_map<Symbol, Symbol> StubSymbolToTarget;
  std::unordered_set<Chunk> StubChunks;
  std::unordered_map<Chunk, ChunkSymbolRange> ChunkSymbolsCache;
  std::vector<SymbolOffset> ChunkSymbolIndex;
  std::unordered_map<Symbol, SourceLoc> SymbolSourceLoc;
  std::vector<XRefEdge> Edges;
  std::vector<Symbol> AllSymbols;
  std::unordered_map<Symbol, uint32_t> SymbolIDs;
  std::vector<DashboardSection> DashboardSections;
  std::vector<std::string> DashboardPaths;
  std::unordered_map<std::string, uint32_t> DashboardPathIDs;
  std::vector<std::string> DashboardOutputs;
  std::unordered_map<std::string, uint32_t> DashboardOutputIDs;
  DashboardPathCoalescer DashboardPathCompressor;
  std::unordered_map<Section, Symbol> PrimarySectionSymbols;
  std::unordered_map<Section, uint32_t> DashboardSectionIds;
  std::unordered_map<uint64_t, uint64_t> DashboardEdgeCounts;
};

ELD_REGISTER_PLUGIN(CrossReference)
