//===- CrossReferencePlugin.cpp-------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//
//
// Builds a symbol-level caller-to-callee cross-reference table and writes it
// to a dump file, as either plain text (the default) or JSON. Unlike the
// linker's built-in --cref table (which records, per symbol, only the
// *input files* that reference it), this plugin records the specific
// *referring symbol* for each reference, when it can be determined.
//
// Local symbols are not unique by name (e.g. a static helper named "helper"
// may be defined identically in several translation units), so every symbol
// printed in the dump is qualified with its origin file, size, and virtual
// address, as "name@file+size@address" (all in hex, e.g.
// "helper@a.c.o+0x10@0x2000"). A garbage-collected symbol never reaches
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
//     is used as a best-effort guess, and the edge is marked "(approx)" in
//     the dump. This fallback matters for chunks whose symbols have no
//     reliable size information (e.g. hand-written assembly without .size
//     directives).
//   - If no symbol precedes the relocation's offset in its chunk at all,
//     the referrer is recorded as "<unattributed>".
//
// If the reference was resolved through a linker-generated trampoline (a
// branch island / stub, e.g. for an out-of-range branch), the edge is
// collapsed to point directly from the original referrer to the real
// target symbol, and is tagged "[trampoline]" rather than being reported
// as two separate hops through the synthetic stub symbol.
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
//   format=text|json     -- output format for the dump (default: text).
//                            "text" produces the human-readable
//                            "name@file+size@address" table described above;
//                            "json" produces a machine-readable object with
//                            "edges" and "symbols" arrays, where each symbol
//                            is {"name", "file", "size", "address"} (address
//                            is JSON null for a garbage-collected symbol,
//                            the JSON analog of the text format's "?"), and
//                            each edge is {"referrer", "referrerKind",
//                            "target", "trampoline"} ("referrer" is null
//                            when unattributed; "referrerKind" is one of
//                            "exact", "approx", "unattributed").
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
//                            When available, this is appended to a text-
//                            format symbol as "@srcfile:line", and added to
//                            a JSON-format symbol as "sourceFile"/
//                            "sourceLine" fields; when unavailable (no debug
//                            info, or no matching subprogram DIE), it is
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
// e.g. "file=xref_dump.txt:show_gc=yes:cpp_demangle=yes".
//
//===----------------------------------------------------------------------===//

#include "LinkerPlugin.h"
#include "PluginVersion.h"
#include "llvm/Demangle/Demangle.h"
#include "llvm/Support/JSON.h"
#include <algorithm>
#include <fstream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace eld::plugin;

namespace {

enum class AttributionKind : uint8_t { Exact, NearestPreceding, Unattributed };

enum class OutputFormat : uint8_t { Text, JSON };

// A symbol together with its offset and size within the chunk that defines
// it, used to build a per-chunk, offset-sorted index for referrer lookup.
struct SymbolOffset {
  Symbol Sym;
  off_t Offset;
  uint32_t Size;
};

// A symbol's DWARF-derived declaration site, as looked up by name from the
// subprogram DIEs of its defining input file's compile units.
struct SourceLoc {
  std::string File;
  uint64_t Line;
};

} // namespace

class CrossReferencePlugin : public LinkerPlugin {
public:
  CrossReferencePlugin() : LinkerPlugin("CrossReferencePlugin") {}

  void Init(const std::string &options) override {
    std::istringstream Tokens(options);
    std::string Token;
    while (std::getline(Tokens, Token, ':')) {
      if (Token.empty())
        continue;
      size_t Eq = Token.find('=');
      if (Eq == std::string::npos) {
        HasError = true;
        getLinker()->reportDiag(getLinker()->getErrorDiagID(
            "CrossReferencePlugin does not recognize option '%0': options "
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
              "CrossReferencePlugin was given more than one 'file' option "
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
          Format = OutputFormat::JSON;
        } else {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReferencePlugin does not support format '%0'; only "
              "'text' and 'json' are supported"),
              Value);
          return;
        }
        continue;
      }
      if (Key == "show_gc") {
        if (!parseYesNo(Value, ShowGC)) {
          HasError = true;
          getLinker()->reportDiag(getLinker()->getErrorDiagID(
              "CrossReferencePlugin's show_gc option must be 'yes' or "
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
              "CrossReferencePlugin's cpp_demangle option must be 'yes' or "
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
              "CrossReferencePlugin's usedwarf option must be 'yes' or "
              "'no', got '%0'"),
              Value);
          return;
        }
        continue;
      }
      HasError = true;
      getLinker()->reportDiag(getLinker()->getErrorDiagID(
          "CrossReferencePlugin does not recognize option '%0'"), Key);
      return;
    }
    if (DumpPath.empty()) {
      HasError = true;
      getLinker()->reportDiag(getLinker()->getErrorDiagID(
          "CrossReferencePlugin requires a 'file=<path>' option in its "
          "Options string"));
      return;
    }
  }

  void ActBeforeWritingOutput() override {
    if (HasError)
      return;
    buildStubMap();
    collectAllSymbols();
    buildChunkSymbolIndex();
    walkReferences();
    if (UseDWARF)
      buildDWARFIndex();
    writeDump();
  }

  void Destroy() override {}

private:
  struct XRefEdge {
    Symbol Target;
    Symbol Referrer;
    AttributionKind Kind;
    bool Trampoline;
  };

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

  // Populates StubSymbolToTarget (stub symbol -> real target symbol) and
  // StubChunks (chunks that are themselves branch islands), by inspecting
  // every stub created in every output section.
  void buildStubMap() {
    eld::Expected<std::vector<OutputSection>> ExpSections =
        getLinker()->getAllOutputSections();
    if (!ExpSections) {
      getLinker()->reportDiagEntry(std::move(ExpSections.error()));
      return;
    }
    for (OutputSection &O : ExpSections.value()) {
      for (Stub &St : O.getStubs()) {
        Symbol StubSym = St.getStubSymbol();
        Symbol TargetSym = St.getTargetSymbol();
        if (!StubSym || !TargetSym)
          continue;
        StubSymbolToTarget.emplace(StubSym, TargetSym);
        Chunk StubChunk = StubSym.getChunk();
        if (StubChunk)
          StubChunks.insert(StubChunk);
      }
    }
  }

  // Finds the symbol in Sorted (sorted ascending by Offset) that best
  // explains a reference at SiteOffset within the same chunk: the nearest
  // preceding symbol, tagged Exact if SiteOffset actually falls within that
  // symbol's [Offset, Offset + Size) range, or NearestPreceding otherwise.
  static AttributionKind findReferrer(const std::vector<SymbolOffset> &Sorted,
                                       off_t SiteOffset, Symbol &OutSym) {
    const SymbolOffset *Best = nullptr;
    for (const SymbolOffset &SO : Sorted) {
      if (SO.Offset > SiteOffset)
        break;
      Best = &SO;
    }
    if (!Best)
      return AttributionKind::Unattributed;
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
    for (Symbol &Sym : AllSymbols) {
      Chunk C = Sym.getChunk();
      if (!C)
        continue;
      ChunkSymbolsCache[C].push_back(
          {Sym, Sym.getOffsetInChunk(), Sym.getSize()});
    }
    for (auto &Entry : ChunkSymbolsCache) {
      std::sort(Entry.second.begin(), Entry.second.end(),
                [](const SymbolOffset &A, const SymbolOffset &B) {
                  return A.Offset < B.Offset;
                });
    }
  }

  // Returns the offset-sorted symbol list for the chunk that defines Sym, as
  // computed by buildChunkSymbolIndex(). Returns an empty list if the chunk
  // defines no symbols known to AllSymbols.
  const std::vector<SymbolOffset> &getSortedSymbols(Chunk &C) {
    static const std::vector<SymbolOffset> Empty;
    auto It = ChunkSymbolsCache.find(C);
    return It != ChunkSymbolsCache.end() ? It->second : Empty;
  }

  void walkReferences() {
    for (InputFile &IF : getLinker()->getInputFiles()) {
      if (!IF.hasInputFile() || IF.isBitcode())
        continue;
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

          const std::vector<SymbolOffset> &Sorted = getSortedSymbols(SrcChunk);
          Symbol ReferrerSym(nullptr);
          AttributionKind Kind =
              findReferrer(Sorted, U.getOffsetInChunk(), ReferrerSym);
          Edges.push_back({TargetSym, ReferrerSym, Kind, Trampoline});
        }
      }
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
    for (InputFile &IF : getLinker()->getInputFiles()) {
      if (!IF.hasInputFile() || IF.isBitcode())
        continue;
      for (Symbol &Sym : IF.getSymbols())
        AllSymbols.push_back(Sym);
    }
  }

  // Populates SymbolSourceLoc (symbol -> declaring source file + line) from
  // DWARF debug info, when usedwarf=yes. For each input file that defines at
  // least one collected symbol, this parses its DWARF (if present) once and
  // indexes every subprogram DIE by name; each of that file's symbols is
  // then looked up by name in that index. Symbols with no debug info, or
  // whose input file has none, simply have no entry and are reported without
  // source location, same as before this option existed.
  void buildDWARFIndex() {
    std::unordered_map<InputFile, std::unordered_map<std::string, SourceLoc>>
        PerFileSubprograms;
    for (Symbol &Sym : AllSymbols) {
      InputFile IF = Sym.getInputFile();
      if (!IF)
        continue;
      auto FileIt = PerFileSubprograms.find(IF);
      if (FileIt == PerFileSubprograms.end())
        FileIt = PerFileSubprograms
                     .emplace(IF, indexSubprogramsByName(IF))
                     .first;
      auto NameIt = FileIt->second.find(Sym.getName());
      if (NameIt != FileIt->second.end())
        SymbolSourceLoc.emplace(Sym, NameIt->second);
    }
  }

  // Parses IF's DWARF debug info (if any) and returns a map from each
  // subprogram DIE's name to its declaring source file + line, across every
  // compile unit in the file. Returns an empty map if IF has no DWARF
  // context (e.g. it was not compiled with debug info).
  std::unordered_map<std::string, SourceLoc>
  indexSubprogramsByName(InputFile &IF) {
    std::unordered_map<std::string, SourceLoc> Index;
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
        if (!Die.isSubprogramDIE())
          continue;
        std::string Name = Die.getName();
        if (Name.empty())
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
  // qualified with its origin file, size, and virtual address, in the form
  // "name@file+size@address". A symbol that was garbage collected never
  // reaches final layout, so it has no meaningful address; its address
  // field is reported as "?" instead.
  std::string qualifySymbol(const Symbol &Sym) const {
    std::ostringstream OS;
    std::string Name = Sym.getName();
    if (CppDemangle)
      Name = llvm::demangle(Name);
    OS << Name << "@" << Sym.getResolvedPath() << "+0x" << std::hex
       << Sym.getSize() << "@";
    if (Sym.isGarbageCollected())
      OS << "?";
    else
      OS << "0x" << std::hex << Sym.getAddress();
    if (UseDWARF) {
      auto It = SymbolSourceLoc.find(Sym);
      if (It != SymbolSourceLoc.end())
        OS << "@" << It->second.File << ":" << std::dec << It->second.Line;
    }
    return OS.str();
  }

  std::string referrerToString(const Symbol &Referrer,
                                AttributionKind Kind) const {
    if (Kind == AttributionKind::Unattributed || !Referrer)
      return "<unattributed>";
    std::string S = qualifySymbol(Referrer);
    if (Kind == AttributionKind::NearestPreceding)
      S += " (approx)";
    return S;
  }

  // JSON counterpart of qualifySymbol(): the same four facts (name, origin
  // file, size, address), as object fields rather than a single delimited
  // string, so consumers don't need to re-parse "name@file+size@address".
  // "address" is JSON null for a garbage-collected symbol -- the JSON
  // analog of the text format's "?" -- since such a symbol never reached
  // final layout and so has no meaningful address to report.
  llvm::json::Object symbolToJSON(const Symbol &Sym) const {
    std::string Name = Sym.getName();
    if (CppDemangle)
      Name = llvm::demangle(Name);
    llvm::json::Object Obj{{"name", Name},
                            {"file", Sym.getResolvedPath()},
                            {"size", Sym.getSize()}};
    if (Sym.isGarbageCollected())
      Obj["address"] = nullptr;
    else
      Obj["address"] = Sym.getAddress();
    if (UseDWARF) {
      auto It = SymbolSourceLoc.find(Sym);
      if (It != SymbolSourceLoc.end()) {
        Obj["sourceFile"] = It->second.File;
        Obj["sourceLine"] = It->second.Line;
      }
    }
    return Obj;
  }

  static llvm::StringRef attributionKindToString(AttributionKind Kind) {
    switch (Kind) {
    case AttributionKind::Exact:
      return "exact";
    case AttributionKind::NearestPreceding:
      return "approx";
    case AttributionKind::Unattributed:
      return "unattributed";
    }
    llvm_unreachable("Unexpected AttributionKind!");
  }

  llvm::json::Object edgeToJSON(const XRefEdge &E) const {
    llvm::json::Object Obj;
    if (E.Kind == AttributionKind::Unattributed || !E.Referrer)
      Obj["referrer"] = nullptr;
    else
      Obj["referrer"] = symbolToJSON(E.Referrer);
    Obj["referrerKind"] = attributionKindToString(E.Kind);
    Obj["target"] = symbolToJSON(E.Target);
    Obj["trampoline"] = E.Trampoline;
    return Obj;
  }

  void writeTextDump(std::ofstream &Out) {
    Out << "# Edges: <referrer> -> <callee> [flags]\n";
    for (XRefEdge &E : Edges) {
      if (!ShowGC && (E.Target.isGarbageCollected() ||
                       (E.Referrer && E.Referrer.isGarbageCollected())))
        continue;
      Out << referrerToString(E.Referrer, E.Kind) << " -> "
          << qualifySymbol(E.Target);
      if (E.Trampoline)
        Out << " [trampoline]";
      Out << "\n";
    }
    Out << "# Symbols:\n";
    for (Symbol &Sym : AllSymbols) {
      if (!ShowGC && Sym.isGarbageCollected())
        continue;
      Out << qualifySymbol(Sym) << "\n";
    }
  }

  void writeJSONDump(std::ofstream &Out) {
    llvm::json::Array JSONEdges;
    for (XRefEdge &E : Edges) {
      if (!ShowGC && (E.Target.isGarbageCollected() ||
                       (E.Referrer && E.Referrer.isGarbageCollected())))
        continue;
      JSONEdges.push_back(edgeToJSON(E));
    }
    llvm::json::Array JSONSymbols;
    for (Symbol &Sym : AllSymbols) {
      if (!ShowGC && Sym.isGarbageCollected())
        continue;
      JSONSymbols.push_back(symbolToJSON(Sym));
    }
    llvm::json::Object Root{{"edges", std::move(JSONEdges)},
                             {"symbols", std::move(JSONSymbols)}};
    Out << llvm::formatv("{0:2}\n", llvm::json::Value(std::move(Root))).str();
  }

  void writeDump() {
    std::ofstream Out(DumpPath, std::ios::out | std::ios::trunc);
    if (!Out) {
      getLinker()->reportDiag(
          getLinker()->getErrorDiagID(
              "CrossReferencePlugin could not open dump file '%0' for "
              "writing"),
          DumpPath);
      return;
    }
    if (Format == OutputFormat::JSON)
      writeJSONDump(Out);
    else
      writeTextDump(Out);
  }

  std::string DumpPath;
  bool HasError = false;
  bool ShowGC = false;
  bool CppDemangle = false;
  bool UseDWARF = false;
  OutputFormat Format = OutputFormat::Text;
  std::unordered_map<Symbol, Symbol> StubSymbolToTarget;
  std::unordered_set<Chunk> StubChunks;
  std::unordered_map<Chunk, std::vector<SymbolOffset>> ChunkSymbolsCache;
  std::unordered_map<Symbol, SourceLoc> SymbolSourceLoc;
  std::vector<XRefEdge> Edges;
  std::vector<Symbol> AllSymbols;
};

ELD_REGISTER_PLUGIN(CrossReferencePlugin)
