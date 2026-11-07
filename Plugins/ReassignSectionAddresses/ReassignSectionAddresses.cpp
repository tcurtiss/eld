//===- ReassignSectionAddresses.cpp---------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//
//
// Example plugin that assigns an absolute address to every symbol defined
// in one or more named output sections. By default, and with
// hash=md5/hash=sha1, the address is derived from the lower 32 bits of
// a hash (MD5 or SHA1, selectable via plugin options) of the symbol's own
// content. Alternatively, hash=seq assigns increasing integer values
// starting at a configurable constant, one per unique symbol content, in
// the order symbols are encountered, across all target sections combined.
// exclude_range= reserves inclusive 32-bit ranges. Hash modes try successive
// 32-bit digest slices in 8-bit steps; sequential mode jumps past excluded
// ranges. Each target section must be declared in the linker script with the
// DSECT (or COPY/INFO/OVERLAY) output section type, since its address
// range is bookkeeping only and is never actually loaded: these types
// clear SHF_ALLOC on the section, which removes it from both the linker's
// virtual-address overlap check and the requirement that it be placed in
// a PT_LOAD segment. Target sections are given via the required "section="
// option key (see Init() below for the full options string format).
//
// Optionally, the plugin writes an address/string mapping to one CSV or JSON
// file per output image. CSV includes a section column; JSON groups entries
// by section. CSV addresses use 0x followed by eight zero-padded uppercase
// hexadecimal digits; JSON addresses are decimal numbers. Paths are derived
// from the linker output filename.
//
// Symbols whose content is byte-identical receive the same address. Hash
// collisions with different contents try higher-order digest slices, skipping
// excluded or conflicting IDs across all selected sections. Sequential mode
// detects ID reuse after wrap. In sequential mode, the plugin keeps an
// explicit content-to-address map so that repeated content reuses the
// address assigned to its first occurrence rather than consuming a new
// counter value, regardless of which target section either occurrence is
// in. Such duplicates are written to each section's mapping only once
// (keyed by address). However, this plugin does NOT physically merge the
// duplicated bytes in the output section (as SHF_MERGE/SHF_STRINGS would):
// every symbol's underlying bytes remain in the output, even when several
// symbols are addressed alike. Mapping outputs can still be treated as a
// merged/deduplicated view of the address/content mapping, even though the
// section's on-disk content is not deduplicated.
//
// Hexagon references are claimed before scanning and rewritten after layout
// by ReferenceRewriter. Other targets retain their normal relocation behavior.
// CAUTION for targets without the reference rewrite: this plugin assigns each
// symbol's final address only in the AfterLayout state, after relaxation has
// run and shrunk/rewritten any relocations against these symbols based on their
// pre-assignment (placeholder) addresses. On targets with link-time
// relocation relaxation (e.g. RISC-V's R_RISCV_HI20/LO12_I with
// R_RISCV_RELAX), code that takes the address of one of these symbols may
// have already had its instruction sequence narrowed to a form that cannot
// hold the full, later-assigned 32-bit address -- silently truncating it at
// emission. This is safe only when the target symbols are never referenced
// by relaxable address-computing code, e.g. a DSECT bookkeeping section, or
// when relaxation is disabled for translation units that take these
// symbols' addresses (e.g. `-mno-relax` on RISC-V). Do not rely on this
// plugin for symbols placed in a PT_LOAD segment whose address is actually
// dereferenced by relaxable code.
//
// This must be an OutputSectionIteratorPlugin, not a LinkerPlugin: its Run()
// hook is invoked in AfterLayout state (from Linker::layout, immediately
// before relocations are applied). A LinkerPlugin's ActBeforeWritingOutput
// hook only fires later, inside Linker::emit()/ELFObjectWriter::writeObject,
// after relocations referencing these symbols have already been resolved.
//
//===----------------------------------------------------------------------===//

#include "../Support/PluginAPICompat.h"
#include "../Support/PluginPortable.h"
#include "Defines.h"
#include "MappingOutput.h"
#include "OutputSectionIteratorPlugin.h"
#include "PluginADT.h"
#include "PluginVersion.h"
#include "ReferenceRewriter.h"
#include <array>
#include <atomic>
#include <cerrno>
#include <charconv>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace eld::plugin;
namespace portable = eld::plugin::portable;

class DLL_A_EXPORT ReassignSectionAddresses
    : public OutputSectionIteratorPlugin {
public:
  enum class HashKind { MD5, SHA1, Sequential };
  using OutputFormat = MappingOutput::Format;

  ReassignSectionAddresses()
      : OutputSectionIteratorPlugin("ReassignSectionAddresses") {}

  // Options string format:
  //   "<key>=<value>[:<key>=<value>]*"
  // Every field is a "key=value" pair, colon-delimited. Recognized keys:
  //   section=<sectionName>[,<sectionName>]*
  //                     Required. A comma-separated list of one or more
  //                     target output section names; every listed section
  //                     is processed identically and shares the options
  //                     below.
  //   hash=<md5|sha1|seq>
  //                     Address assignment mode (default md5), shared by
  //                     all target sections. "seq" assigns
  //                     increasing integer values, one per unique symbol
  //                     content across *all* target sections combined,
  //                     starting at the value given by "seq_start" (see
  //                     below), in the order symbols are encountered
  //                     while iterating the sections. ID reuse for different
  //                     contents after wrap is an error. MD5/SHA1 collisions
  //                     with different bytes try 32-bit digest slices in 8-bit
  //                     increments toward higher-order bits.
  //   seq_start=<value> Starting value for hash=seq, parsed as a C
  //                     integer literal (e.g. "0x1000" or "4096"); default 0.
  //                     Ignored for hash=md5/sha1.
  //   exclude_range=<low>-<high>[,<low>-<high>]*
  //                     Inclusive unsigned 32-bit decimal/hexadecimal ranges,
  //                     with low <= high. Hashes try 32-bit slices in 8-bit
  //                     steps until one is allowed; sequential IDs skip the
  //                     ranges.
  //   output_format=<csv|json>[,<csv|json>]* (or none)
  //                     Write the selected mapping formats, one file each
  //                     containing all modified sections. Default none;
  //                     CSV adds a leading section column.
  //   output_suffix=<name>
  //                     Filename suffix (default reassign). Outputs are named
  //                     <image>.<output_suffix>.csv/.json/.debug.json, with .gz
  //                     appended when enabled. Must be a nonempty filename
  //                     component without path separators or control bytes.
  //   gzip=<yes|no>     Compress all mapping/debug outputs as <path>.gz;
  //                     the uncompressed path is not created (default no).
  //   debug=<yes|no>    Write <output>.<output_suffix>.debug.json with
  //                     per-section entries for every modified symbol's
  //                     assigned/original address,
  //                     name, raw bytes, and relocation provenance (default
  //                     no). Independent of output_format= and tracing.
  //   clean_strings=<yes|no>
  //                     When yes, clean mapping string fields in CSV/JSON:
  //                     retain printable ASCII and tabs, remove CR/LF and
  //                     other control/non-ASCII bytes, and trim trailing
  //                     whitespace without collapsing tabs (default no).
  //                     Debug JSON always retains raw bytes as hex.
  void Init(std::string Options) override {
    // Init() may be called more than once on the same plugin instance (the
    // linker's plugin-loading path can invoke it in addition to the
    // OutputSectionIteratorPlugin dispatch path), so reset all state that
    // would otherwise accumulate across calls.
    TargetSections.clear();
    SectionIndex.clear();
    Hash = HashKind::MD5;
    NextSequentialAddr = 0;
    ExcludedRanges.clear();
    Outputs.clear();
    Suffix = "reassign";
    Gzip = false;
    Debug = false;
    CleanStrings = false;
    EC = 0;
    LastError = "Success";

    bool SawSection = false;
    std::string::size_type FieldStart = 0;
    while (true) {
      std::string::size_type ColonPos = Options.find(':', FieldStart);
      std::string Field = Options.substr(FieldStart, ColonPos - FieldStart);
      std::string::size_type EqPos = Field.find('=');
      if (EqPos == std::string::npos) {
        if (!Field.empty() && pluginTrace())
          std::cout << "[ReassignSectionAddresses] Init: ignoring "
                       "malformed option field '"
                    << Field << "'\n";
      } else {
        std::string Key = Field.substr(0, EqPos);
        std::string Value = Field.substr(EqPos + 1);
        if (Key == "section") {
          SawSection = true;
          std::vector<std::string> Sections;
          splitOnComma(Value, Sections);
          for (const auto &Section : Sections) {
            if (Section.empty()) {
              EC = 1;
              LastError = "section= must not contain empty section names";
              return;
            }
            if (std::find(TargetSections.begin(), TargetSections.end(),
                          Section) == TargetSections.end())
              TargetSections.push_back(Section);
          }
        } else if (Key == "hash") {
          if (Value == "sha1")
            Hash = HashKind::SHA1;
          else if (Value == "md5")
            Hash = HashKind::MD5;
          else if (Value == "seq")
            Hash = HashKind::Sequential;
          else {
            Hash = HashKind::MD5;
            if (pluginTrace())
              std::cout << "[ReassignSectionAddresses] Init: unknown hash '"
                        << Value << "', defaulting to md5\n";
          }
        } else if (Key == "seq_start") {
          size_t First = Value.find_first_not_of(" \t\r\n\f\v");
          char *End = nullptr;
          errno = 0;
          auto Address = std::strtoull(Value.c_str(), &End, 0);
          if (First == std::string::npos || Value[First] == '-' || errno ||
              End == Value.c_str() || *End || Address > UINT32_MAX) {
            EC = 1;
            LastError = "seq_start= must be an unsigned 32-bit integer";
            return;
          }
          NextSequentialAddr = static_cast<uint32_t>(Address);
        } else if (Key == "exclude_range") {
          if (!parseExcludedRanges(Value)) {
            EC = 1;
            LastError = "exclude_range= must be a comma-separated list of "
                        "unsigned 32-bit decimal or hexadecimal low-high "
                        "ranges with low <= high";
            return;
          }
        } else if (Key == "output_format") {
          if (!parseOutputs(Value)) {
            EC = 1;
            LastError =
                "output_format= must be 'none' or a comma-separated list of "
                "'csv' and 'json'";
            if (pluginTrace())
              std::cout << "[ReassignSectionAddresses] Init: " << LastError
                        << "\n";
            return;
          }
        } else if (Key == "output_suffix") {
          if (Value.empty() ||
              Value.find_first_of("/\\") != std::string::npos ||
              std::any_of(Value.begin(), Value.end(), [](unsigned char C) {
                return C < 0x20 || C == 0x7f;
              })) {
            EC = 1;
            LastError =
                "output_suffix= must be a nonempty filename component without "
                "path separators or control bytes";
            if (pluginTrace())
              std::cout << "[ReassignSectionAddresses] Init: " << LastError
                        << "\n";
            return;
          }
          Suffix = Value;
        } else if (Key == "gzip") {
          if (!parseYesNo(Value, Gzip)) {
            EC = 1;
            LastError = "gzip= must be 'yes' or 'no'";
            if (pluginTrace())
              std::cout << "[ReassignSectionAddresses] Init: " << LastError
                        << "\n";
            return;
          }
        } else if (Key == "debug") {
          if (!parseYesNo(Value, Debug)) {
            EC = 1;
            LastError = "debug= must be 'yes' or 'no'";
            if (pluginTrace())
              std::cout << "[ReassignSectionAddresses] Init: " << LastError
                        << "\n";
            return;
          }
        } else if (Key == "clean_strings") {
          if (!parseYesNo(Value, CleanStrings)) {
            EC = 1;
            LastError = "clean_strings= must be 'yes' or 'no'";
            if (pluginTrace())
              std::cout << "[ReassignSectionAddresses] Init: " << LastError
                        << "\n";
            return;
          }
        } else {
          if (pluginTrace())
            std::cout << "[ReassignSectionAddresses] Init: ignoring unknown "
                         "option key '"
                      << Key << "'\n";
        }
      }
      if (ColonPos == std::string::npos)
        break;
      FieldStart = ColonPos + 1;
    }

    if (!SawSection) {
      EC = 1;
      LastError = "section= is required and must specify at least one target "
                  "output section";
      if (pluginTrace())
        std::cout << "[ReassignSectionAddresses] Init: " << LastError << "\n";
      return;
    }
    if (ExcludedRanges.size() == 1 && ExcludedRanges[0].Low == 0 &&
        ExcludedRanges[0].High == UINT32_MAX) {
      EC = 1;
      LastError = "exclude_range= leaves no available 32-bit address";
      return;
    }
    for (size_t I = 0; I < TargetSections.size(); ++I)
      SectionIndex[TargetSections[I]] = I;
    TargetOutputSections.assign(TargetSections.size(), OutputSection(nullptr));

    if (!pluginTrace())
      return;
    std::cout << "[ReassignSectionAddresses] Init: target section(s)=";
    for (size_t I = 0; I < TargetSections.size(); ++I)
      std::cout << (I ? "," : "") << TargetSections[I];
    std::cout << ", hash="
              << (Hash == HashKind::SHA1
                      ? "sha1"
                      : (Hash == HashKind::Sequential ? "seq" : "md5"));
    if (Hash == HashKind::Sequential)
      std::cout << ", seq_start=0x" << std::hex << NextSequentialAddr
                << std::dec;
    if (!ExcludedRanges.empty()) {
      std::cout << ", exclude_range=";
      for (size_t I = 0; I < ExcludedRanges.size(); ++I)
        std::cout << (I ? "," : "") << "0x" << std::hex << ExcludedRanges[I].Low
                  << "-0x" << ExcludedRanges[I].High << std::dec;
    }
    std::cout << ", output_format=";
    if (Outputs.empty())
      std::cout << "none";
    for (size_t I = 0; I < Outputs.size(); ++I)
      std::cout << (I ? "," : "")
                << (Outputs[I] == OutputFormat::CSV ? "csv" : "json");
    std::cout << ", gzip=" << (Gzip ? "yes" : "no")
              << ", clean_strings=" << (CleanStrings ? "yes" : "no")
              << ", debug=" << (Debug ? "yes" : "no")
              << ", output_suffix=" << Suffix;
    std::cout << "\n";
  }

  void processOutputSection(OutputSection O) override {
    auto It = SectionIndex.find(O.getName());
    if (It != SectionIndex.end()) {
      if (pluginTrace())
        std::cout << "[ReassignSectionAddresses] processOutputSection: found "
                     "target output section '"
                  << O.getName() << "'\n";
      TargetOutputSections[It->second] = O;
    }
  }

  Status Run(bool Trace) override {
    TraceEnabled = Trace;
    if (getLinker()->getLinkMode() == LinkerWrapper::PartialLink) {
      EC = 1;
      LastError = "partial links are not supported; apply "
                  "ReassignSectionAddresses at the final link";
      return Status::ERROR;
    }
    if (References && References->failed()) {
      EC = 1;
      LastError = "Cannot rewrite references to reassigned symbols";
      return Status::ERROR;
    }
    bool AnyFound = false;
    for (const OutputSection &O : TargetOutputSections)
      AnyFound |= static_cast<bool>(O);
    if (!AnyFound) {
      if (Trace)
        std::cout << "[ReassignSectionAddresses] Run: no target output "
                     "section found, nothing to do\n";
      return Status::SUCCESS;
    }

    if (getLinker()->isLinkStateAfterLayout()) {
      // Freeze the selected symbol order before setSymbolAddress detaches any
      // symbol from its original chunk. Validate the live final inventory.
      auto Symbols = assignmentSymbols();
      if (References && References->failed()) {
        EC = 1;
        LastError = "Cannot validate original symbol attribution";
        return Status::ERROR;
      }
      std::vector<std::vector<ReferenceRewriter::DebugSymbol>> DebugSymbols;
      if (Debug)
        DebugSymbols.resize(TargetSections.size());
      // Input contents remain alive throughout Run; deduplication keys borrow
      // them too, rather than allocating a copy of every distinct string.
      AssignedAddresses Assigned;
      std::vector<std::vector<MappingEntry>> Entries(TargetSections.size());

      for (size_t I = 0; I < TargetOutputSections.size(); ++I) {
        if (!TargetOutputSections[I])
          continue;
        if (Trace)
          std::cout << "[ReassignSectionAddresses] Run (AfterLayout): "
                       "assigning addresses to symbols in '"
                    << TargetSections[I] << "'\n";
        std::vector<SymbolWork> Work;
        Work.reserve(Symbols[I].size());
        for (Symbol Sym : Symbols[I]) {
          SymbolWork Entry;
          Entry.Sym = Sym;
          Entry.OrigAddr = Sym.getAddress();
          Entry.ContentData = Sym.getChunk().getRawData();
          if (Entry.ContentData) {
            Entry.ContentData += Sym.getOffsetInChunk();
            Entry.ContentSize = Sym.getSize();
            Entry.Bytes = portable::ArrayRef<uint8_t>(
                reinterpret_cast<const uint8_t *>(Entry.ContentData),
                Entry.ContentSize);
            if (Entry.ContentSize &&
                Entry.ContentData[Entry.ContentSize - 1] == '\0')
              --Entry.ContentSize;
          }
          Work.push_back(Entry);
        }
        if (Hash != HashKind::Sequential)
          computeHashesInParallel(Work);
        // Resolve IDs serially in assignment order, across all sections.
        // Workers only compute digests, so collision handling is thread-count
        // independent.
        for (SymbolWork &Entry : Work)
          if (!assignAddress(Entry, Assigned))
            return Status::ERROR;
        std::unordered_set<uint32_t> OutputAddrs;
        for (const SymbolWork &Entry : Work) {
          if (Trace)
            std::cout << "[ReassignSectionAddresses]   symbol '"
                      << Entry.Sym.getName() << "' -> 0x" << std::hex
                      << Entry.Addr << std::dec << "\n";
          const Chunk OriginalChunk =
              Debug ? Entry.Sym.getChunk() : Chunk(nullptr);
          auto Result = getLinker()->setSymbolAddress(Entry.Sym, Entry.Addr);
          if (!Result) {
            getLinker()->reportDiagEntry(std::move(Result.error()));
            return Status::ERROR;
          }
          if (!Outputs.empty() && OutputAddrs.insert(Entry.Addr).second)
            Entries[I].push_back(
                {Entry.Addr, Entry.ContentData, Entry.ContentSize});
          if (Debug)
            DebugSymbols[I].push_back({Entry.Sym, OriginalChunk, Entry.OrigAddr,
                                       Entry.Addr, Entry.Bytes});
        }
        // The assignment index is no longer needed for this section.
        std::vector<Symbol>().swap(Symbols[I]);
      }
      // Drop the global registries, including their buckets, before rewrites
      // and output; mapping/debug records borrow original input bytes directly.
      Assigned = {};
      if (References && !References->apply()) {
        EC = 1;
        LastError = "Cannot write reassigned symbol references";
        return Status::ERROR;
      }
      // No writer invokes mutable linker APIs. Files have independent owners
      // and stream borrowed contents; never buffer entire rendered payloads.
      std::vector<std::unique_ptr<MappingOutput>> Mappings;
      std::vector<std::function<bool()>> Writers;
      for (OutputFormat Format : Outputs) {
        Mappings.push_back(std::make_unique<MappingOutput>(
            getLinker()->getOutputFileName(), Suffix, Format, Gzip,
            CleanStrings));
        auto *Mapping = Mappings.back().get();
        Writers.push_back([&, Mapping] {
          for (size_t I = 0; I < Entries.size(); ++I)
            for (const MappingEntry &E : Entries[I])
              if (!Mapping->write(TargetSections[I], E.Address, E.Data, E.Size))
                return false;
          return Mapping->finish();
        });
      }
      const std::string DebugPath = getLinker()->getOutputFileName() + "." +
                                    Suffix + ".debug.json" +
                                    (Gzip ? ".gz" : "");
      if (Debug) {
        References->prepareDebug(DebugSymbols);
        Writers.push_back([&] {
          return References->writeDebug(DebugPath, TargetSections, DebugSymbols,
                                        Gzip);
        });
      }
      // Join every writer before inspecting errors, including failed writers.
      // Report errors in format-list order, not nondeterministic task order.
      std::vector<uint8_t> Results(Writers.size(), 0);
      auto Write = [&](size_t I) { Results[I] = Writers[I](); };
      if (workerCount() > 1 && Writers.size() > 1) {
        auto &Pool = workPool();
        for (size_t I = 0; I < Writers.size(); ++I)
          Pool.run([&, I] { Write(I); });
        Pool.wait();
      } else {
        for (size_t I = 0; I < Writers.size(); ++I)
          Write(I);
      }
      for (size_t I = 0; I < Results.size(); ++I)
        if (!Results[I])
          return I < Mappings.size()
                     ? artifactError("mapping output", Mappings[I]->path())
                     : artifactError("debug JSON", DebugPath);
    }

    return Status::SUCCESS;
  }

  std::string GetName() override { return "ReassignSectionAddresses"; }

  std::string GetLastErrorAsString() override { return LastError; }

  uint32_t GetLastError() override { return EC; }

  void Destroy() override {}

  void initializeReferences() {
    if (!References)
      References = std::make_unique<ReferenceRewriter>(*getLinker());
    References->initialize(TargetSections, Debug);
  }

  void collectReference(Use U) { References->collect(U); }

private:
  Status artifactError(const std::string &Kind, const std::string &Path) {
    EC = 1;
    LastError = "failed to write " + Kind + " '" + Path + "'";
    getLinker()->getDiagnosticBuilder(
        getLinker()->getErrorDiagID("ReassignSectionAddresses: %0"))
        << LastError;
    return Status::ERROR;
  }

  struct SymbolWork {
    Symbol Sym{nullptr};
    const char *ContentData = nullptr;
    uint32_t ContentSize = 0;
    uint64_t OrigAddr = 0;
    portable::ArrayRef<uint8_t> Bytes;
    std::array<uint32_t, 5> HashWords{};
    uint32_t Addr = 0;
  };

  struct AssignedAddresses {
    std::unordered_map<uint32_t, std::string_view> Contents;
    std::unordered_map<std::string_view, uint32_t> Sequential;
  };

  bool assignmentError(const SymbolWork &Entry, const std::string &Reason) {
    EC = 1;
    LastError = Reason + " for symbol '" + Entry.Sym.getName() + "'";
    getLinker()->getDiagnosticBuilder(
        getLinker()->getErrorDiagID("ReassignSectionAddresses: %0"))
        << LastError;
    return false;
  }

  bool assignAddress(SymbolWork &Entry, AssignedAddresses &Assigned) {
    // Compare exactly the bytes used by the assignment mode. Hash modes include
    // the trailing NUL; sequential deduplication omits one, as before. Cleaning
    // mapping strings never affects identity or collision resolution.
    const size_t Size =
        Hash == HashKind::Sequential ? Entry.ContentSize : Entry.Bytes.size();
    const auto Content = Entry.ContentData
                             ? std::string_view(Entry.ContentData, Size)
                             : std::string_view();
    if (Hash == HashKind::Sequential) {
      auto Existing = Assigned.Sequential.find(Content);
      if (Existing != Assigned.Sequential.end()) {
        Entry.Addr = Existing->second;
        return true;
      }
      while (const ExcludedRange *Range = excludedRange(NextSequentialAddr))
        NextSequentialAddr = static_cast<uint32_t>(uint64_t(Range->High) + 1);
      if (!Assigned.Contents.try_emplace(NextSequentialAddr, Content).second)
        return assignmentError(Entry,
                               "sequential address reuse after wrap (ID " +
                                   std::to_string(NextSequentialAddr) + ")");
      Entry.Addr = NextSequentialAddr++;
      Assigned.Sequential.emplace(Content, Entry.Addr);
      return true;
    }
    bool Collision = false;
    const size_t Count = Hash == HashKind::SHA1 ? 17 : 13;
    for (size_t I = 0; I < Count; ++I) {
      // Words are ordered from lower to higher bits. Each byte step slides the
      // 32-bit window across at most two words, without shifting by 32 or
      // reading beyond the final word. No candidate wraps around the end of the
      // digest.
      const size_t Word = I / 4;
      const unsigned Shift = (I % 4) * 8;
      uint32_t Address = Entry.HashWords[Word] >> Shift;
      if (Shift)
        Address |= Entry.HashWords[Word + 1] << (32 - Shift);
      if (excludedRange(Address))
        continue;
      auto Insertion = Assigned.Contents.try_emplace(Address, Content);
      if (Insertion.second || Insertion.first->second == Content) {
        Entry.Addr = Address;
        return true;
      }
      Collision = true;
    }
    const std::string Mode = Hash == HashKind::SHA1 ? "sha1" : "md5";
    return assignmentError(
        Entry,
        "all " + Mode + " 32-bit digest slices are " +
            (Collision ? "excluded or already assigned to different contents"
                       : "excluded"));
  }

  struct MappingEntry {
    uint32_t Address;
    const char *Data;
    uint32_t Size;
  };

  std::vector<std::vector<Symbol>> assignmentSymbols() {
    // Read each final input symbol table once. Reusing only the pre-scan
    // objects would silently omit symbols defined or moved by another plugin.
    std::unordered_map<const eld::Fragment *, std::vector<Symbol>> ByChunk;
    std::unordered_set<InputFile> Files;
    std::vector<std::vector<Chunk>> Chunks(TargetOutputSections.size());
    for (size_t I = 0; I < TargetOutputSections.size(); ++I) {
      if (!TargetOutputSections[I])
        continue;
      for (LinkerScriptRule Rule :
           TargetOutputSections[I].getLinkerScriptRules())
        for (Chunk C : Rule.getChunks()) {
          if (C.getSection().isIgnore() || C.getSection().isDiscarded() ||
              C.getSection().isGarbageCollected() ||
              TargetOutputSections[I].isDiscard())
            continue;
          Chunks[I].push_back(C);
          ByChunk.try_emplace(C.getFragment());
          Files.insert(C.getInputFile());
        }
    }
    for (InputFile F : Files)
      for (Symbol S : F.getSymbols()) {
        if (!S.isObject() || S.isUndef() || S.isGarbageCollected())
          continue;
        Chunk C = S.getChunk();
        if (!C)
          continue;
        auto It = ByChunk.find(C.getFragment());
        if (It != ByChunk.end())
          It->second.push_back(S);
      }
    std::vector<std::vector<Symbol>> Result(TargetOutputSections.size());
    for (size_t I = 0; I < Chunks.size(); ++I)
      for (Chunk C : Chunks[I]) {
        const auto &Symbols = ByChunk.at(C.getFragment());
        Result[I].insert(Result[I].end(), Symbols.begin(), Symbols.end());
      }
    if (References)
      References->validateAssignments(Result);
    return Result;
  }

  size_t workerCount() const {
    return getLinker()->isMultiThreaded()
               ? std::max<size_t>(1, getLinker()->getPluginThreadCount())
               : 1;
  }

  ThreadPool &workPool() {
    if (!WorkPool)
      WorkPool = std::make_unique<ThreadPool>(workerCount());
    return *WorkPool;
  }

  void computeHashesInParallel(std::vector<SymbolWork> &Work) {
    // Avoid scheduling tiny inputs, but parallelize even a few large symbols.
    constexpr size_t BatchSize = 32;
    size_t Bytes = 0;
    for (const auto &Entry : Work) {
      Bytes += Entry.Bytes.size();
      if (Bytes >= 64 * 1024)
        break;
    }
    size_t Batch = Work.size() < BatchSize ? 1 : BatchSize;
    size_t NumWorkers =
        std::min(workerCount(), (Work.size() + Batch - 1) / Batch);
    if (Work.size() < 256 && Bytes < 64 * 1024)
      NumWorkers = 1;
    if (NumWorkers < 2) {
      for (SymbolWork &Entry : Work)
        computeHashWords(Entry);
      return;
    }

    auto &Pool = workPool();
    std::atomic<size_t> Next{0};
    for (size_t Worker = 0; Worker < NumWorkers; ++Worker) {
      Pool.run([this, &Work, &Next, Batch] {
        while (true) {
          size_t I = Next.fetch_add(Batch, std::memory_order_relaxed);
          if (I >= Work.size())
            break;
          size_t End = std::min(Work.size(), I + Batch);
          for (; I < End; ++I)
            computeHashWords(Work[I]);
        }
      });
    }
    Pool.wait();
  }

  static bool parseYesNo(const std::string &Value, bool &Result) {
    if (Value == "yes") {
      Result = true;
      return true;
    }
    if (Value == "no") {
      Result = false;
      return true;
    }
    return false;
  }

  bool parseOutputs(const std::string &Value) {
    Outputs.clear();
    if (Value == "none")
      return true;
    size_t Start = 0;
    while (true) {
      size_t End = Value.find(',', Start);
      std::string Name = Value.substr(Start, End - Start);
      if (Name != "csv" && Name != "json")
        return false;
      OutputFormat Format =
          Name == "csv" ? OutputFormat::CSV : OutputFormat::JSON;
      if (std::find(Outputs.begin(), Outputs.end(), Format) == Outputs.end())
        Outputs.push_back(Format);
      if (End == std::string::npos)
        return true;
      Start = End + 1;
    }
  }

  bool pluginTrace() const {
#if ELD_PLUGIN_HAS_TRACE_HELPER
    return getLinker()->isTraced();
#else
    return TraceEnabled;
#endif
  }

  static void splitOnComma(const std::string &S,
                           std::vector<std::string> &Out) {
    std::string::size_type Start = 0;
    while (true) {
      std::string::size_type Comma = S.find(',', Start);
      Out.push_back(S.substr(Start, Comma - Start));
      if (Comma == std::string::npos)
        break;
      Start = Comma + 1;
    }
  }

  struct ExcludedRange {
    uint32_t Low;
    uint32_t High;
  };

  static bool parseRangeBound(std::string_view Value, uint32_t &Bound) {
    size_t First = Value.find_first_not_of(" \t\r\n\f\v");
    if (First == std::string_view::npos)
      return false;
    Value =
        Value.substr(First, Value.find_last_not_of(" \t\r\n\f\v") - First + 1);
    int Base = 10;
    if (Value.size() >= 2 && Value[0] == '0' &&
        (Value[1] == 'x' || Value[1] == 'X')) {
      Value.remove_prefix(2);
      Base = 16;
    }
    auto Result =
        std::from_chars(Value.data(), Value.data() + Value.size(), Bound, Base);
    return Result.ec == std::errc() &&
           Result.ptr == Value.data() + Value.size();
  }

  bool parseExcludedRanges(const std::string &Value) {
    ExcludedRanges.clear();
    std::vector<std::string> Ranges;
    splitOnComma(Value, Ranges);
    for (const std::string &Range : Ranges) {
      size_t Dash = Range.find('-');
      ExcludedRange Bounds;
      if (Dash == std::string::npos ||
          !parseRangeBound(std::string_view(Range).substr(0, Dash),
                           Bounds.Low) ||
          !parseRangeBound(std::string_view(Range).substr(Dash + 1),
                           Bounds.High) ||
          Bounds.Low > Bounds.High)
        return false;
      ExcludedRanges.push_back(Bounds);
    }
    std::sort(ExcludedRanges.begin(), ExcludedRanges.end(),
              [](const ExcludedRange &A, const ExcludedRange &B) {
                return A.Low < B.Low;
              });
    // Normalize once for logarithmic lookup and direct sequential jumps past
    // whole ranges, even when the original ranges overlap or are adjacent.
    size_t Count = 0;
    for (ExcludedRange Range : ExcludedRanges) {
      if (Count &&
          uint64_t(Range.Low) <= uint64_t(ExcludedRanges[Count - 1].High) + 1)
        ExcludedRanges[Count - 1].High =
            std::max(ExcludedRanges[Count - 1].High, Range.High);
      else
        ExcludedRanges[Count++] = Range;
    }
    ExcludedRanges.resize(Count);
    return true;
  }

  const ExcludedRange *excludedRange(uint32_t Address) const {
    auto It =
        std::lower_bound(ExcludedRanges.begin(), ExcludedRanges.end(), Address,
                         [](const ExcludedRange &Range, uint32_t Value) {
                           return Range.High < Value;
                         });
    return It != ExcludedRanges.end() && It->Low <= Address ? &*It : nullptr;
  }

  void computeHashWords(SymbolWork &Entry) const {
    if (Hash == HashKind::SHA1) {
      auto Words = portable::sha1Words(Entry.Bytes);
      std::reverse_copy(Words.begin(), Words.end(), Entry.HashWords.begin());
    } else {
      auto Words = portable::md5Words(Entry.Bytes);
      std::copy(Words.begin(), Words.end(), Entry.HashWords.begin());
    }
  }

  std::vector<std::string> TargetSections;
  std::unordered_map<std::string, size_t> SectionIndex;
  std::vector<OutputSection> TargetOutputSections;
  HashKind Hash = HashKind::MD5;
  std::vector<OutputFormat> Outputs;
  std::string Suffix = "reassign";
  bool Gzip = false;
  bool Debug = false;
  bool CleanStrings = false;
  uint32_t NextSequentialAddr = 0;
  std::vector<ExcludedRange> ExcludedRanges;
  uint32_t EC = 0;
  std::string LastError = "Success";
  std::unique_ptr<ThreadPool> WorkPool;
  bool TraceEnabled = false;
  // Init may be re-entered by the output-section iterator. Its parser state
  // resets normally, but the original-symbol/relocation snapshot survives.
  std::unique_ptr<ReferenceRewriter> References;
};

ELD_REGISTER_PLUGIN(ReassignSectionAddresses)

class ReassignRelocationConfig : public LinkerPluginConfig {
public:
  explicit ReassignRelocationConfig(ReassignSectionAddresses *P)
      : LinkerPluginConfig(P), P(P) {}
  void Init() override { P->initializeReferences(); }
  void RelocCallBack(Use U) override { P->collectReference(U); }

private:
  ReassignSectionAddresses *P;
};

extern "C" LinkerPluginConfig DLL_A_EXPORT *getPluginConfig(const char *) {
  static std::unique_ptr<ReassignRelocationConfig> Config;
  Config = std::make_unique<ReassignRelocationConfig>(ThisPlugin);
  return Config.get();
}
