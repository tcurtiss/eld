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
// content. Alternatively, hash=sequential assigns increasing integer values
// starting at a configurable constant, one per unique symbol content, in
// the order symbols are encountered, across all target sections combined.
// Each target section must be declared in the linker script with the
// DSECT (or COPY/INFO/OVERLAY) output section type, since its address
// range is bookkeeping only and is never actually loaded: these types
// clear SHF_ALLOC on the section, which removes it from both the linker's
// virtual-address overlap check and the requirement that it be placed in
// a PT_LOAD segment. Target sections are given via the required "section="
// option key (see Init() below for the full options string format).
//
// Optionally, the plugin can dump every assigned address alongside the
// symbol's string content to a text file (one "<hex address>:<string>" pair
// per line, one line per distinct address), for offline inspection of the
// address/content mapping. The address is always printed as exactly 8
// lowercase hex digits, zero-padded on the left (no leading-zero
// suppression), regardless of its numeric magnitude. When more than one
// target section is given, a separate dump file is written per section (see
// the "dump" option below).
//
// Symbols whose content is byte-identical automatically receive the same
// address. In hash mode (md5/sha1) this falls out for free, since the
// address is a pure hash of the symbol's own content -- no explicit
// duplicate detection is needed. In sequential mode, the plugin keeps an
// explicit content-to-address map so that repeated content reuses the
// address assigned to its first occurrence rather than consuming a new
// counter value, regardless of which target section either occurrence is
// in. Such duplicates are written to a section's dump file only once
// (keyed by address). However, this plugin does NOT physically merge the
// duplicated bytes in the output section (as SHF_MERGE/SHF_STRINGS would):
// every symbol's underlying bytes remain in the output, even when several
// symbols are addressed alike. The dump file can still be treated as a
// merged/deduplicated view of the address/content mapping, even though the
// section's on-disk content is not deduplicated.
//
// CAUTION: this plugin assigns each symbol's final address only in the
// AfterLayout state, i.e. after the linker's relaxation pass has already run
// and shrunk/rewritten any relocations against these symbols based on their
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
#include "OutputSectionIteratorPlugin.h"
#include "PluginADT.h"
#include "PluginVersion.h"
#include <array>
#include <atomic>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace eld::plugin;
namespace portable = eld::plugin::portable;

class DLL_A_EXPORT ReassignSectionAddresses
    : public OutputSectionIteratorPlugin {
public:
  enum class HashKind { MD5, SHA1, Sequential };

  // When debug_dump=yes, and only for sections that already have a main dump=
  // file configured, also writes a second, parallel
  // "<path>_debug<ext>" file with one line per symbol (not deduplicated by
  // address, unlike the main dump, so every symbol's own original address
  // is visible even when several symbols share a reassigned address) of the
  // form "<hex hash>:<original address>:<symbol name>:<hex bytes>", where
  // <hex bytes> is a lowercase hex encoding of the symbol's raw content
  // bytes (two hex digits per byte, untrimmed) rather than a string
  // rendering of them. The dump is controlled solely by the plugin option,
  // rather than the linker's tracing state.

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
  //   hash=<md5|sha1|sequential>
  //                     Address assignment mode (default md5), shared by
  //                     all target sections. "sequential" assigns
  //                     increasing integer values, one per unique symbol
  //                     content across *all* target sections combined,
  //                     starting at the value given by "start" (see
  //                     below), in the order symbols are encountered
  //                     while iterating the sections.
  //   start=<value>     Starting value for hash=sequential, parsed as a C
  //                     integer literal (e.g. "0x1000" or "4096"); default 0.
  //                     Ignored for hash=md5/sha1.
  //   dump=<path>[,<path>]*
  //                     Text file(s) to write "<hex address>:<string>"
  //                     pairs to, one file per target section, with the
  //                     address always printed as exactly 8 zero-padded hex
  //                     digits, and duplicate addresses within a given
  //                     section's file collapsed to a single line. When
  //                     more than one
  //                     target section is given, dump must list exactly
  //                     one path per section, comma-delimited in the same
  //                     order as the section list; a count mismatch is a
  //                     plugin error. If dump is omitted entirely, no
  //                     dump file is written for any section.
  //   gzip=<yes|no>      When yes, write each dump as <path>.gz using gzip;
  //                     the uncompressed path is not created (default no).
  //   debug_dump=<yes|no>
  //                     When yes, write an uncompressed parallel
  //                     <path>_debug<ext> dump containing every symbol's
  //                     assigned address, original address, name, and raw
  //                     bytes (default no). Requires dump=.
  //   clean_strings=<yes|no>
  //                     When yes, clean content printed in the main dump:
  //                     retain printable ASCII only, remove CR/LF, and
  //                     replace each run of tabs with one space (default no).
  //                     The debug dump always retains raw bytes as hex.
  void Init(std::string Options) override {
    // Init() may be called more than once on the same plugin instance (the
    // linker's plugin-loading path can invoke it in addition to the
    // OutputSectionIteratorPlugin dispatch path), so reset all state that
    // would otherwise accumulate across calls.
    TargetSections.clear();
    SectionIndex.clear();
    DumpPaths.clear();
    Gzip = false;
    DebugDump = false;
    CleanStrings = false;
    EC = 0;
    LastError = "Success";

    std::string DumpList;
    bool SawDump = false;
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
          splitOnComma(Value, TargetSections);
        } else if (Key == "hash") {
          if (Value == "sha1")
            Hash = HashKind::SHA1;
          else if (Value == "md5")
            Hash = HashKind::MD5;
          else if (Value == "sequential")
            Hash = HashKind::Sequential;
          else if (pluginTrace())
            std::cout << "[ReassignSectionAddresses] Init: unknown hash '"
                      << Value << "', defaulting to md5\n";
        } else if (Key == "start") {
          NextSequentialAddr =
              static_cast<uint32_t>(std::stoull(Value, nullptr, 0));
        } else if (Key == "dump") {
          DumpList = Value;
          SawDump = true;
        } else if (Key == "gzip") {
          if (!parseYesNo(Value, Gzip)) {
            EC = 1;
            LastError = "gzip= must be 'yes' or 'no'";
            if (pluginTrace())
              std::cout << "[ReassignSectionAddresses] Init: " << LastError
                        << "\n";
            return;
          }
        } else if (Key == "debug_dump") {
          if (!parseYesNo(Value, DebugDump)) {
            EC = 1;
            LastError = "debug_dump= must be 'yes' or 'no'";
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
    for (size_t I = 0; I < TargetSections.size(); ++I)
      SectionIndex[TargetSections[I]] = I;
    TargetOutputSections.assign(TargetSections.size(), OutputSection(nullptr));

    if (SawDump) {
      std::vector<std::string> Paths;
      splitOnComma(DumpList, Paths);
      if (Paths.size() != TargetSections.size()) {
        EC = 1;
        std::ostringstream ErrMsg;
        ErrMsg << "dump= must specify exactly one path per target section ("
               << TargetSections.size() << " section(s), " << Paths.size()
               << " dump path(s) given)";
        LastError = ErrMsg.str();
        if (pluginTrace())
          std::cout << "[ReassignSectionAddresses] Init: " << LastError << "\n";
        return;
      }
      DumpPaths = std::move(Paths);
    } else {
      DumpPaths.assign(TargetSections.size(), std::string());
    }

    if (DebugDump && !SawDump) {
      EC = 1;
      LastError = "debug_dump=yes requires dump=";
      if (pluginTrace())
        std::cout << "[ReassignSectionAddresses] Init: " << LastError << "\n";
      return;
    }

    if (!pluginTrace())
      return;
    std::cout << "[ReassignSectionAddresses] Init: target section(s)=";
    for (size_t I = 0; I < TargetSections.size(); ++I)
      std::cout << (I ? "," : "") << TargetSections[I];
    std::cout << ", hash="
              << (Hash == HashKind::SHA1
                      ? "sha1"
                      : (Hash == HashKind::Sequential ? "sequential" : "md5"));
    if (Hash == HashKind::Sequential)
      std::cout << ", start=0x" << std::hex << NextSequentialAddr << std::dec;
    std::cout << ", dump=";
    if (!SawDump) {
      std::cout << "<none>";
    } else {
      for (size_t I = 0; I < DumpPaths.size(); ++I)
        std::cout << (I ? "," : "") << DumpPaths[I];
    }
    std::cout << ", gzip=" << (Gzip ? "yes" : "no")
              << ", debug_dump=" << (DebugDump ? "yes" : "no")
              << ", clean_strings=" << (CleanStrings ? "yes" : "no");
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
      // Shared across all target sections, so hash=sequential assigns one
      // globally-increasing counter value per unique symbol content
      // regardless of which target section the symbol lives in.
      std::unordered_map<std::string, uint32_t> SequentialAddrs;
      const bool ParallelHash =
          Hash != HashKind::Sequential && getLinker()->isMultiThreaded() &&
          getLinker()->getPluginThreadCount() > 1;
      for (size_t I = 0; I < TargetOutputSections.size(); ++I) {
        OutputSection &TargetOutputSection = TargetOutputSections[I];
        if (!TargetOutputSection)
          continue;
        if (Trace)
          std::cout << "[ReassignSectionAddresses] Run (AfterLayout): "
                       "assigning addresses to symbols in '"
                    << TargetOutputSection.getName() << "'\n";
        std::unordered_set<uint32_t> DumpedAddrs;
        const std::string &DumpPath = DumpPaths[I];
        std::ofstream DumpFile;
        std::ostringstream GzipBuffer;
        std::ostream *DumpOut = nullptr;
        if (!DumpPath.empty()) {
          if (Gzip) {
            DumpOut = &GzipBuffer;
          } else {
            DumpFile.open(DumpPath, std::ios::out | std::ios::trunc |
                                         std::ios::binary);
            if (!DumpFile) {
              if (Trace)
                std::cout << "[ReassignSectionAddresses] Run: failed to open "
                             "dump file '"
                          << DumpPath << "'\n";
              return Status::ERROR;
            }
            DumpOut = &DumpFile;
          }
        }
        const bool WriteDebugDump = DebugDump && !DumpPath.empty();
        std::ofstream DebugDumpFile;
        std::string DebugDumpPath;
        if (WriteDebugDump) {
          DebugDumpPath = makeDebugDumpPath(DumpPath);
          DebugDumpFile.open(DebugDumpPath,
                             std::ios::out | std::ios::trunc |
                                 std::ios::binary);
          if (!DebugDumpFile) {
            if (Trace)
              std::cout << "[ReassignSectionAddresses] Run: failed to open "
                           "debug dump file '"
                        << DebugDumpPath << "'\n";
            return Status::ERROR;
          }
        }
        auto AssignSymbol = [&](const Symbol &Sym, uint32_t Addr,
                                const char *ContentData, uint32_t ContentSize,
                                portable::ArrayRef<uint8_t> Bytes,
                                uint64_t OrigAddr) -> bool {
          if (Trace)
            std::cout << "[ReassignSectionAddresses]   symbol '"
                      << Sym.getName() << "' -> 0x" << std::hex << Addr
                      << std::dec << "\n";
          eld::Expected<void> ExpSet =
              getLinker()->setSymbolAddress(Sym, Addr);
          if (!ExpSet) {
            if (Trace)
              std::cout << "[ReassignSectionAddresses]   failed to set "
                           "address for symbol '"
                        << Sym.getName() << "'\n";
            getLinker()->reportDiagEntry(std::move(ExpSet.error()));
            return false;
          }
          if (!DumpPath.empty() && DumpedAddrs.insert(Addr).second) {
            *DumpOut << std::hex << std::setfill('0') << std::setw(8) << Addr
                     << std::dec << ":";
            writeDumpContent(*DumpOut, ContentData, ContentSize);
            *DumpOut << "\n";
          }
          // DEBUG ONLY: one line per symbol (not deduplicated by address,
          // unlike the main dump), so every symbol's own original address
          // remains visible even when several symbols share a reassigned
          // address.
          if (WriteDebugDump)
            DebugDumpFile << std::hex << std::setfill('0') << std::setw(8)
                          << Addr << std::dec << ":" << std::hex << OrigAddr
                          << std::dec << ":" << Sym.getName() << ":"
                          << portable::toHex(Bytes, true) << "\n";
          return true;
        };

        if (ParallelHash) {
          std::vector<SymbolWork> Work;
          for (LinkerScriptRule Rule :
               TargetOutputSection.getLinkerScriptRules()) {
            for (Chunk C : Rule.getChunks()) {
              for (Symbol Sym : C.getSymbols()) {
                // Skip non-OBJECT symbols, e.g. ELF mapping symbols such as
                // ARM/RISC-V's "$d"/"$x", which some targets emit into data
                // sections but which are not part of the section's actual
                // data-carrying symbol set.
                if (!Sym.isObject())
                  continue;
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
            }
          }
          computeHashesInParallel(Work);
          for (const SymbolWork &Entry : Work) {
            if (!AssignSymbol(Entry.Sym, Entry.Addr, Entry.ContentData,
                              Entry.ContentSize, Entry.Bytes,
                              Entry.OrigAddr))
              return Status::ERROR;
          }
        } else {
          for (LinkerScriptRule Rule :
               TargetOutputSection.getLinkerScriptRules()) {
            for (Chunk C : Rule.getChunks()) {
              for (Symbol Sym : C.getSymbols()) {
                // Skip non-OBJECT symbols, e.g. ELF mapping symbols such as
                // ARM/RISC-V's "$d"/"$x", which some targets emit into data
                // sections but which are not part of the section's actual
                // data-carrying symbol set.
                if (!Sym.isObject())
                  continue;
                uint64_t OrigAddr = Sym.getAddress();
                const char *ContentData = Sym.getChunk().getRawData();
                uint32_t ContentSize = 0;
                uint32_t Addr = 0;
                portable::ArrayRef<uint8_t> Bytes;
                if (ContentData) {
                  ContentData += Sym.getOffsetInChunk();
                  ContentSize = Sym.getSize();
                  Bytes = portable::ArrayRef<uint8_t>(
                      reinterpret_cast<const uint8_t *>(ContentData),
                      ContentSize);
                  // Drop a trailing NUL baked into the symbol's raw bytes
                  // (e.g. a C string literal's terminator) from sequential
                  // keys and human-readable dumps.
                  if (ContentSize && ContentData[ContentSize - 1] == '\0')
                    --ContentSize;
                  if (Hash == HashKind::Sequential) {
                    std::string Key(ContentData, ContentSize);
                    auto Insertion = SequentialAddrs.try_emplace(
                        std::move(Key), NextSequentialAddr);
                    if (Insertion.second)
                      ++NextSequentialAddr;
                    Addr = Insertion.first->second;
                  } else {
                    Addr = computeLower32(Bytes);
                  }
                }
                if (!AssignSymbol(Sym, Addr, ContentData, ContentSize, Bytes,
                                  OrigAddr))
                  return Status::ERROR;
              }
            }
          }
        }
        if (Gzip && !DumpPath.empty() &&
            !writeGzipDump(DumpPath + ".gz", GzipBuffer.str()))
          return Status::ERROR;
      }
    }

    return Status::SUCCESS;
  }

  std::string GetName() override { return "ReassignSectionAddresses"; }

  std::string GetLastErrorAsString() override { return LastError; }

  uint32_t GetLastError() override { return EC; }

  void Destroy() override {}

private:
  struct SymbolWork {
    Symbol Sym{nullptr};
    const char *ContentData = nullptr;
    uint32_t ContentSize = 0;
    uint64_t OrigAddr = 0;
    portable::ArrayRef<uint8_t> Bytes;
    uint32_t Addr = 0;
  };

  void computeHashesInParallel(std::vector<SymbolWork> &Work) {
    size_t NumWorkers = std::min<size_t>(
        Work.size(), getLinker()->getPluginThreadCount());
    if (NumWorkers < 2) {
      for (SymbolWork &Entry : Work)
        if (Entry.ContentData)
          Entry.Addr = computeLower32(Entry.Bytes);
      return;
    }

    if (!WorkPool || WorkPoolThreads != NumWorkers) {
      WorkPool = std::make_unique<ThreadPool>(NumWorkers);
      WorkPoolThreads = NumWorkers;
    }
    std::atomic<size_t> Next{0};
    for (size_t Worker = 0; Worker < NumWorkers; ++Worker) {
      WorkPool->run([this, &Work, &Next] {
        while (true) {
          size_t I = Next.fetch_add(1, std::memory_order_relaxed);
          if (I >= Work.size())
            break;
          if (Work[I].ContentData)
            Work[I].Addr = computeLower32(Work[I].Bytes);
        }
      });
    }
    WorkPool->wait();
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

  bool pluginTrace() const {
#if ELD_PLUGIN_HAS_TRACE_HELPER
    return getLinker()->isTraced();
#else
    return TraceEnabled;
#endif
  }

  bool writeGzipDump(const std::string &Path, const std::string &Payload) {
    if (!portable::gzipPayload(Path, Payload)) {
      if (pluginTrace())
        std::cout << "[ReassignSectionAddresses] Run: failed to write gzip "
                     "dump file '"
                  << Path << "'\n";
      return false;
    }
    return true;
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

  void writeDumpContent(std::ostream &Out, const char *ContentData,
                        uint32_t ContentSize) const {
    if (!ContentData || !ContentSize)
      return;
    if (!CleanStrings) {
      Out.write(ContentData, ContentSize);
      return;
    }

    bool PreviousWasTab = false;
    for (uint32_t I = 0; I < ContentSize; ++I) {
      unsigned char Byte = static_cast<unsigned char>(ContentData[I]);
      if (Byte == '\r' || Byte == '\n')
        continue;
      if (Byte == '\t') {
        if (!PreviousWasTab)
          Out.put(' ');
        PreviousWasTab = true;
        continue;
      }
      PreviousWasTab = false;
      if (Byte >= 0x20 && Byte <= 0x7e)
        Out.put(static_cast<char>(Byte));
    }
  }

  // DEBUG ONLY: inserts "_debug" before Path's extension (or appends it if
  // Path has no extension), e.g. "foo.txt" -> "foo_debug.txt".
  static std::string makeDebugDumpPath(const std::string &Path) {
    std::string::size_type SlashPos = Path.find_last_of("/\\");
    std::string::size_type DotPos = Path.find_last_of('.');
    if (DotPos == std::string::npos ||
        (SlashPos != std::string::npos && DotPos < SlashPos))
      return Path + "_debug";
    return Path.substr(0, DotPos) + "_debug" + Path.substr(DotPos);
  }

  // Returns the lower 32 bits of the configured hash of Bytes.
  uint32_t computeLower32(portable::ArrayRef<uint8_t> Bytes) const {
    if (Hash == HashKind::SHA1)
      return portable::sha1Lower32(Bytes);
    return portable::md5Lower32(Bytes);
  }

  std::vector<std::string> TargetSections;
  std::unordered_map<std::string, size_t> SectionIndex;
  std::vector<OutputSection> TargetOutputSections;
  HashKind Hash = HashKind::MD5;
  std::vector<std::string> DumpPaths;
  bool Gzip = false;
  bool DebugDump = false;
  bool CleanStrings = false;
  uint32_t NextSequentialAddr = 0;
  uint32_t EC = 0;
  std::string LastError = "Success";
  std::unique_ptr<ThreadPool> WorkPool;
  size_t WorkPoolThreads = 0;
  bool TraceEnabled = false;
};

ELD_REGISTER_PLUGIN(ReassignSectionAddresses)
