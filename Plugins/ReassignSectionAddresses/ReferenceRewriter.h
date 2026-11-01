//===- ReferenceRewriter.h -----------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#ifndef REASSIGN_REFERENCE_REWRITER_H
#define REASSIGN_REFERENCE_REWRITER_H

#include "../Support/PluginPortable.h"
#include "LinkerWrapper.h"
#include "OutputFile.h"
#include "PluginADT.h"
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <iterator>
#include <memory>
#include <mutex>
#include <optional>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// Policy lives in the plugin. Only public ELD API handles are used here;
// opaque pointers are identifiers, never dereferenced.
class ReferenceRewriter {
  using Chunk = eld::plugin::Chunk;
  using Symbol = eld::plugin::Symbol;
  using Use = eld::plugin::Use;
  using LinkerWrapper = eld::plugin::LinkerWrapper;

  struct Entry {
    Symbol Sym;
    uint64_t Offset;
    uint64_t Size;
  };
  struct Target {
    Symbol Sym;
    int64_t Interior;
  };
  enum class Encoding { Pointer, High, Low, StoreLow, DuplexLow };
  struct Reference {
    Use U;
    Target T;
    Encoding Kind;
    uint32_t Word;
  };
  // Only populated with debug=yes. Keep the original target chunk because
  // setSymbolAddress detaches its symbol from the original fragment.
  struct DebugReference {
    size_t Index;
    Chunk OriginalTarget;
    std::string SourceFile;
    std::string SourceSection;
    uint64_t Offset;
    std::string OriginalSymbol;
    uint32_t OriginalType;
    int64_t OriginalAddend;
    uint32_t OriginalData;
    uint32_t ReplacementData = 0;
    uint64_t SourceAddress = 0;
    Chunk SourceChunk{nullptr};
  };
  using UseIndex = std::unordered_map<uint64_t, Use>;
  struct SourceIndex {
    std::once_flag Once;
    std::optional<UseIndex> Uses;
  };
  struct DebugChunk {
    std::string File;
    std::string Section;
    std::string OutputSection;
  };
  struct DebugTarget {
    std::string Name;
    uint32_t Address;
  };

public:
  struct DebugSymbol {
    Symbol Sym;
    Chunk OriginalChunk;
    uint64_t OriginalAddress;
    uint32_t AssignedAddress;
    eld::plugin::portable::ArrayRef<uint8_t> Bytes;
  };

  explicit ReferenceRewriter(LinkerWrapper &LW) : LW(LW) {}

  void initialize(const std::vector<std::string> &Sections, bool Debug) {
    this->Debug = Debug;
    if (LW.getRelocationHandler().getRelocationName(0) != "R_HEX_NONE" ||
        LW.getLinkMode() == LinkerWrapper::PartialLink)
      return;
    Enabled = true;
    ErrorID = LW.getErrorDiagID(
        "ReassignSectionAddresses: %0 in %1 section %2 at offset %3");
    Selected.insert(Sections.begin(), Sections.end());
    auto Handler = LW.getRelocationHandler();
    // Subscribe to all currently supported Hexagon ELF relocation types so
    // references into selected chunks cannot silently escape validation.
    auto Last = Handler.getRelocationType("R_HEX_27_REG");
    if (Last > 1024) {
      Failed = true;
      return;
    }
    for (uint32_t Type = 0; Type <= Last; ++Type) {
      auto Result = LW.registerReloc(Type);
      if (!Result) {
        LW.reportDiagEntry(std::move(Result.error()));
        Failed = true;
      }
    }
  }

  void indexSymbols() {
    // Enumerate each input file once, rather than rescanning its symbol table
    // for every selected chunk. Contents are borrowed, not copied.
    for (auto F : LW.getInputFiles()) {
      for (Symbol S : F.getSymbols()) {
        if (!S.isObject() || S.isUndef() || S.isGarbageCollected())
          continue;
        Chunk C = S.getChunk();
        if (!C)
          continue;
        auto O = C.getSection().getOutputSection();
        if (!O || !Selected.count(O.getName()))
          continue;
        auto Offset = S.getOffsetInChunk();
        if (Offset < 0 || uint64_t(Offset) > C.getSize() ||
            S.getSize() > C.getSize() - uint64_t(Offset)) {
          Failed = true;
          LW.getDiagnosticBuilder(ErrorID)
              << "invalid symbol extent" << F.getFileName() << C.getName()
              << std::to_string(Offset);
          continue;
        }
        Symbols[C.getFragment()].push_back({S, uint64_t(Offset), S.getSize()});
        DirectSymbols.insert(S);
      }
    }
    for (auto &Item : Symbols) {
      std::stable_sort(
          Item.second.begin(), Item.second.end(),
          [](const Entry &A, const Entry &B) { return A.Offset < B.Offset; });
      const Entry *Previous = nullptr;
      for (const Entry &E : Item.second) {
        if (Previous && E.Offset < Previous->Offset + Previous->Size &&
            (E.Offset != Previous->Offset || E.Size != Previous->Size)) {
          Failed = true;
          auto C = E.Sym.getChunk();
          LW.getDiagnosticBuilder(ErrorID)
              << "ambiguous overlapping string symbols"
              << C.getInputFile().getFileName() << C.getName()
              << std::to_string(E.Offset);
        }
        Previous = &E;
      }
    }
  }

  void collect(Use U) {
    if (!Enabled || Failed.load(std::memory_order_relaxed))
      return;
    Chunk Source = U.getSourceChunk();
    // Debug information is not runtime code/data and must retain its normal
    // relocation handling. In particular, do not interpret DWARF as packets.
    if (!Source || !Source.isAlloc())
      return;
    Chunk C = U.getTargetChunk();
    if (!C)
      return;
    auto O = C.getSection().getOutputSection();
    if (!O || !Selected.count(O.getName()))
      return;
    // Config::Init runs while inputs are still being read. Initialize only
    // for a relevant callback, after symbol resolution and GC.
    std::call_once(IndexOnce, [this] { indexSymbols(); });
    if (Failed)
      return;
    auto It = Symbols.find(C.getFragment());
    if (It == Symbols.end()) {
      fail(U, "selected target has no object symbols");
      return;
    }
    auto Name = LW.getRelocationHandler().getRelocationName(U.getType());
    if (Name == "R_HEX_NONE")
      return;
    auto Uses = usesFor(Source);
    auto Offset = U.getOffsetInChunk();
    if (!Uses || Offset < 0)
      return;
    auto Here = Uses->find(Offset);
    if (Here == Uses->end() || !(Here->second == U)) {
      fail(U, "duplicate relocation at selected operand");
      return;
    }
    for (int Delta = -3; Delta <= 3; ++Delta)
      if (Delta && Offset + Delta >= 0 && Uses->count(Offset + Delta)) {
        fail(U, "overlapping relocation at selected operand");
        return;
      }
    int64_t Addend = U.getTargetChunkOffset();
    Encoding Kind = Encoding::Pointer;
    uint32_t Word = 0;
    if (Name != "R_HEX_32") {
      bool PC = Name == "R_HEX_B32_PCREL_X" || Name == "R_HEX_6_PCREL_X";
      bool GOT = Name == "R_HEX_GOT_32_6_X" || Name == "R_HEX_GOT_11_X";
      bool Absolute = Name == "R_HEX_32_6_X" || Name == "R_HEX_16_X" ||
                      Name == "R_HEX_8_X" || Name == "R_HEX_6_X";
      if ((!PC && !GOT && !Absolute) || !Source.isCode()) {
        fail(U, "unsupported selected-target relocation " + Name);
        return;
      }
      bool High = Name == "R_HEX_B32_PCREL_X" || Name == "R_HEX_GOT_32_6_X" ||
                  Name == "R_HEX_32_6_X";
      if (Offset < 0 || (!High && Offset < 4)) {
        fail(U, "invalid immediate-pair offset");
        return;
      }
      uint64_t HighOffset = High ? Offset : Offset - 4;
      auto Extender = readWord(Source, HighOffset);
      auto Low = readWord(Source, HighOffset + 4);
      auto Start = packetStart(Source, HighOffset + 4);
      if (!Extender || !Low || !Start || HighOffset < *Start ||
          (*Extender & 0xf0000000) || packetEnd(*Extender) ||
          (!Absolute && (*Low & 0xc000) == 0)) {
        fail(U, "invalid or truncated immediate-extender packet");
        return;
      }
      bool Transfer = (*Low & 0xff200000) == 0x78000000;
      bool Store = (*Low & 0xffe00000) == 0x3c400000;
      bool Combine = (*Low & 0xff800000) == 0x7c000000 ||
                     (*Low & 0xffc02000) == 0x73002000;
      bool Duplex = (*Low & 0xc000) == 0 && (*Low & 0x1c000000) == 0x08000000;
      bool ValidLow = PC    ? ((*Low & 0xffff2060) == 0x6a490000)
                      : GOT ? ((*Low & 0xf9e00000) == 0x91800000)
                            : (Transfer || Store || Combine || Duplex);
      if (!ValidLow) {
        fail(U, "unsupported immediate-pair instruction");
        return;
      }
      uint64_t OtherOffset = High ? HighOffset + 4 : HighOffset;
      auto Paired = Uses->find(OtherOffset);
      Use Other = Paired == Uses->end() ? Use(nullptr) : Paired->second;
      auto OtherName =
          Other ? LW.getRelocationHandler().getRelocationName(Other.getType())
                : std::string();
      const char *Expected =
          PC    ? (High ? "R_HEX_6_PCREL_X" : "R_HEX_B32_PCREL_X")
          : GOT ? (High ? "R_HEX_GOT_11_X" : "R_HEX_GOT_32_6_X")
                : (High ? "R_HEX_16_X" : "R_HEX_32_6_X");
      bool TypeMatches = OtherName == Expected;
      if (Absolute && High)
        TypeMatches = Transfer ? OtherName == "R_HEX_16_X"
                      : Duplex ? OtherName == "R_HEX_6_X"
                               : OtherName == "R_HEX_8_X";
      if (Absolute && !High)
        TypeMatches = TypeMatches && (Transfer ? Name == "R_HEX_16_X"
                                      : Duplex ? Name == "R_HEX_6_X"
                                               : Name == "R_HEX_8_X");
      if (!Other || !TypeMatches || !(Other.getSymbol() == U.getSymbol())) {
        fail(U, "missing or conflicting paired relocation");
        return;
      }
      auto OtherAddend = int64_t(Other.getTargetChunkOffset());
      if (PC) {
        Addend -= uint64_t(Offset) - *Start;
        OtherAddend -= OtherOffset - *Start;
      }
      if (Addend != OtherAddend || (GOT && Addend != 0)) {
        fail(U, "inconsistent paired relocation addends");
        return;
      }
      Kind = High ? Encoding::High : Encoding::Low;
      // Replacement has no memory access or PC/GOT dependence. Preserve the
      // packet parse/loop bits and destination register, and no other fields.
      Word = High ? (*Extender & 0xf000c000) : (0x78000000 | (*Low & 0xc01f));
      if (Absolute && !High) {
        if (Duplex) {
          Kind = Encoding::DuplexLow;
          Word = *Low & ~0x03f00000u;
        } else if (Store) {
          Kind = Encoding::StoreLow;
          Word = *Low & ~0x207fu;
        } else {
          Word = *Low & ~(Transfer ? 0x00df3fe0u : 0x1fe0u);
        }
      }
    }
    auto T = resolve(U, It->second, Addend);
    if (!T)
      return;
    if (LW.isSymbolPreemptible(T->Sym)) {
      fail(U, "selected string target is interposable; bind it locally first");
      return;
    }
    auto OriginalData =
        Debug ? readWord(Source, Offset, false) : std::optional<uint32_t>(0);
    if (!OriginalData) {
      fail(U, "missing original relocation data for provenance");
      return;
    }
    auto Claim = LW.claimUse(U);
    if (!Claim) {
      LW.reportDiagEntry(std::move(Claim.error()));
      Failed = true;
      return;
    }
    // Prepare metadata outside the append lock. claimUse must remain in the
    // current callback: ELD validates its ownership using thread-local state.
    DebugReference D{};
    if (Debug)
      D = {0,
           C,
           Source.getInputFile().getFileName(),
           Source.getName(),
           uint64_t(Offset),
           U.getName(),
           U.getType(),
           int64_t(U.getTargetChunkOffset()),
           *OriginalData};
    std::lock_guard<std::mutex> Guard(ReferencesMutex);
    if (Debug) {
      D.Index = References.size();
      DebugReferences.push_back(std::move(D));
    }
    References.push_back({U, *T, Kind, Word});
  }

  bool apply() {
    if (Failed)
      return false;
    for (size_t I = 0; I < References.size(); ++I) {
      const Reference &R = References[I];
      uint64_t Address = R.T.Sym.getValue();
      if (Address > UINT32_MAX || R.T.Interior < -int64_t(Address) ||
          R.T.Interior > int64_t(UINT32_MAX - Address)) {
        fail(R.U, "assigned address plus interior offset exceeds 32 bits");
        return false;
      }
      uint32_t Data = uint32_t(int64_t(Address) + R.T.Interior);
      if (R.Kind == Encoding::High) {
        uint32_t High = Data >> 6;
        Data = R.Word | ((High >> 14) & 0xfff) << 16 | (High & 0x3fff);
      } else if (R.Kind == Encoding::Low) {
        Data = R.Word | (Data & 0x3f) << 5;
      } else if (R.Kind == Encoding::StoreLow) {
        Data = R.Word | (Data & 0x3f);
      } else if (R.Kind == Encoding::DuplexLow) {
        Data = R.Word | (Data & 0x3f) << 20;
      }
      Use U = R.U;
      auto Write = LW.setTargetDataForUse(U, Data);
      if (!Write) {
        LW.reportDiagEntry(std::move(Write.error()));
        return false;
      }
      if (Debug)
        DebugReferences[I].ReplacementData = Data;
    }
    return true;
  }

  void prepareDebug(const std::vector<std::vector<DebugSymbol>> &Symbols) {
    DebugImage = LW.getOutputFileName();
    DebugChunks.clear();
    DebugTargets.clear();
    DebugTypes.clear();
    auto SnapshotChunk = [&](Chunk C) {
      if (!DebugChunks.count(C))
        DebugChunks.emplace(
            C, DebugChunk{C.getInputFile().getFileName(), C.getName(),
                          C.getSection().getOutputSection().getName()});
    };
    for (const auto &Section : Symbols)
      for (const DebugSymbol &S : Section) {
        DebugTargets.emplace(S.Sym,
                             DebugTarget{S.Sym.getName(), S.AssignedAddress});
        SnapshotChunk(S.OriginalChunk);
      }
    DebugUses.clear();
    for (DebugReference &D : DebugReferences) {
      const Reference &R = References[D.Index];
      D.SourceAddress = R.U.getSourceAddress();
      D.SourceChunk = R.U.getSourceChunk();
      SnapshotChunk(D.SourceChunk);
      SnapshotChunk(D.OriginalTarget);
      if (!DebugTypes.count(D.OriginalType))
        DebugTypes.emplace(
            D.OriginalType,
            LW.getRelocationHandler().getRelocationName(D.OriginalType));
      DebugUses[References[D.Index].T.Sym].push_back(&D);
    }
    // Callback order can differ with parallel scanning. Use stable input
    // identities and final source addresses, never pointer values, for
    // ordering.
    for (auto &Group : DebugUses)
      std::sort(Group.second.begin(), Group.second.end(),
                [](const DebugReference *A, const DebugReference *B) {
                  auto KA =
                      std::tie(A->SourceFile, A->SourceSection, A->Offset);
                  auto KB =
                      std::tie(B->SourceFile, B->SourceSection, B->Offset);
                  if (KA != KB)
                    return KA < KB;
                  return A->SourceAddress < B->SourceAddress;
                });
  }

  bool writeDebug(const std::string &Path,
                  const std::vector<std::string> &Sections,
                  const std::vector<std::vector<DebugSymbol>> &Symbols,
                  bool Gzip) const {
    if (std::all_of(Symbols.begin(), Symbols.end(),
                    [](const auto &Section) { return Section.empty(); }))
      return true;
    OutputFile File(Path, Gzip);
    std::ostream *Out = File.open();
    if (!Out)
      return false;
    eld::plugin::portable::JSONWriter JSON(*Out);
    JSON.object([&] {
      JSON.attribute("schema_version", 3);
      JSON.attribute("plugin", "ReassignSectionAddresses");
      JSON.attribute("output_file", DebugImage);
      JSON.attributeArray("sections", [&] {
        for (size_t I = 0; I < Sections.size(); ++I) {
          if (Symbols[I].empty())
            continue;
          JSON.object([&] {
            JSON.attribute("section", Sections[I]);
            JSON.attributeArray("symbols", [&] {
              for (const DebugSymbol &S : Symbols[I]) {
                const DebugChunk &C = DebugChunks.at(S.OriginalChunk);
                JSON.object([&] {
                  JSON.attribute("symbol", DebugTargets.at(S.Sym).Name);
                  JSON.attribute("input_file", C.File);
                  JSON.attribute("input_section", C.Section);
                  JSON.attribute("assigned_address", S.AssignedAddress);
                  JSON.attribute("original_address", S.OriginalAddress);
                  JSON.attributeHex("raw_bytes", S.Bytes);
                  JSON.attributeArray("relocations", [&] {
                    auto It = DebugUses.find(S.Sym);
                    if (It != DebugUses.end())
                      for (const DebugReference *D : It->second)
                        writeDebugReference(JSON, *D);
                  });
                });
              }
            });
          });
        }
      });
    });
    *Out << '\n';
    return File.finish();
  }

  bool validateSymbol(Symbol S) {
    if (!Enabled)
      return true;
    std::call_once(IndexOnce, [this] { indexSymbols(); });
    if (DirectSymbols.count(S))
      return !Failed;
    Failed = true;
    auto C = S.getChunk();
    LW.getDiagnosticBuilder(ErrorID)
        << "selected symbol was not indexed before relocation scanning; "
           "provide an explicit output section rule"
        << C.getInputFile().getFileName() << C.getName()
        << std::to_string(S.getOffsetInChunk());
    return false;
  }

  bool failed() const { return Failed; }

private:
  void writeDebugReference(eld::plugin::portable::JSONWriter &JSON,
                           const DebugReference &D) const {
    const Reference &R = References[D.Index];
    const DebugChunk &Source = DebugChunks.at(D.SourceChunk);
    const DebugChunk &Target = DebugChunks.at(D.OriginalTarget);
    const DebugTarget &Symbol = DebugTargets.at(R.T.Sym);
    const std::string &Type = DebugTypes.at(D.OriginalType);
    const char *Transformation =
        R.Kind == Encoding::Pointer ? "absolute-pointer-initializer"
        : Type == "R_HEX_B32_PCREL_X" || Type == "R_HEX_6_PCREL_X"
            ? "pc-relative-to-absolute"
        : Type == "R_HEX_GOT_32_6_X" || Type == "R_HEX_GOT_11_X"
            ? "got-load-to-absolute"
            : "absolute-immediate-update";
    JSON.object([&] {
      JSON.attributeObject("source", [&] {
        JSON.attribute("file", D.SourceFile);
        JSON.attribute("section", D.SourceSection);
        JSON.attribute("offset", D.Offset);
        JSON.attribute("address", D.SourceAddress);
        JSON.attribute("output_section", Source.OutputSection);
      });
      JSON.attributeObject("original", [&] {
        JSON.attribute("type", Type);
        JSON.attribute("type_id", D.OriginalType);
        JSON.attribute("symbol", D.OriginalSymbol);
        JSON.attribute("addend", D.OriginalAddend);
        JSON.attribute("data", D.OriginalData);
      });
      JSON.attributeObject("target", [&] {
        JSON.attribute("file", Target.File);
        JSON.attribute("section", Target.Section);
        JSON.attribute("output_section", Target.OutputSection);
        JSON.attribute("symbol", Symbol.Name);
        JSON.attribute("interior_offset", R.T.Interior);
        JSON.attribute("assigned_address", Symbol.Address);
      });
      JSON.attribute("transformation", Transformation);
      JSON.attribute("value", uint32_t(int64_t(Symbol.Address) + R.T.Interior));
      JSON.attribute("replacement_data", D.ReplacementData);
    });
  }

  const UseIndex *usesFor(Chunk C) {
    SourceIndex *Cached;
    {
      std::lock_guard<std::mutex> Guard(SourceUsesMutex);
      auto &Slot = SourceUses[C.getFragment()];
      if (!Slot)
        Slot = std::make_unique<SourceIndex>();
      Cached = Slot.get();
    }
    // Only callbacks for the same source wait for its initialization. The
    // expensive API enumeration and index allocation hold no global mutex.
    std::call_once(Cached->Once, [&] {
      auto Uses = LW.getUses(C);
      if (!Uses) {
        LW.reportDiagEntry(std::move(Uses.error()));
        Failed = true;
        return;
      }
      auto &Index = Cached->Uses.emplace();
      for (Use U : Uses.value())
        if (U.getSourceChunk() == C && U.getOffsetInChunk() >= 0) {
          auto Insert = Index.emplace(U.getOffsetInChunk(), U);
          if (!Insert.second)
            Insert.first->second = Use(nullptr);
        }
    });
    // Cache entries are never erased; heap ownership keeps this pointer stable
    // even if other callbacks rehash SourceUses.
    return Cached->Uses ? &*Cached->Uses : nullptr;
  }

  std::optional<Target> resolve(Use U, const std::vector<Entry> &Entries,
                                int64_t Addend) {
    Symbol S = U.getSymbol();
    if (!S.isSection()) {
      if (DirectSymbols.count(S))
        return Target{S, Addend};
      fail(U, "target is not a selected object symbol");
      return std::nullopt;
    }
    int64_t Base = S.getOffsetInChunk();
    if ((Addend > 0 && Base > INT64_MAX - Addend) ||
        (Addend < 0 && Base < INT64_MIN - Addend)) {
      fail(U, "section-relative offset overflow");
      return std::nullopt;
    }
    int64_t Offset = Base + Addend;
    auto It = std::upper_bound(
        Entries.begin(), Entries.end(), uint64_t(Offset),
        [](uint64_t Value, const Entry &E) { return Value < E.Offset; });
    const Entry *Match = It != Entries.begin() ? &*std::prev(It) : nullptr;
    if (Offset < 0 || !Match ||
        uint64_t(Offset) - Match->Offset >= Match->Size) {
      fail(U, "section-relative offset has no containing string symbol");
      return std::nullopt;
    }
    return Target{Match->Sym, Offset - int64_t(Match->Offset)};
  }

  void fail(Use U, const std::string &Reason) {
    Failed = true;
    auto Source = U.getSourceChunk();
    LW.getDiagnosticBuilder(ErrorID)
        << Reason << Source.getInputFile().getFileName() << Source.getName()
        << std::to_string(U.getOffsetInChunk());
  }

  static std::optional<uint32_t> readWord(Chunk C, uint64_t Offset,
                                          bool Aligned = true) {
    const char *Bytes = C.getRawData();
    if (!Bytes || (Aligned && Offset % 4) || Offset > C.getSize() ||
        C.getSize() - Offset < 4)
      return std::nullopt;
    auto *P = reinterpret_cast<const unsigned char *>(Bytes + Offset);
    return uint32_t(P[0]) | uint32_t(P[1]) << 8 | uint32_t(P[2]) << 16 |
           uint32_t(P[3]) << 24;
  }

  static bool packetEnd(uint32_t Word) {
    return (Word & 0xc000) == 0xc000 || (Word & 0xc000) == 0;
  }

  static std::optional<uint64_t> packetStart(Chunk C, uint64_t Offset) {
    uint64_t Start = Offset;
    while (Start >= 4 && Offset - Start < 12) {
      auto Previous = readWord(C, Start - 4);
      if (!Previous)
        return std::nullopt;
      if (packetEnd(*Previous))
        break;
      Start -= 4;
    }
    if (Start && Offset - Start == 12) {
      auto Previous = readWord(C, Start - 4);
      if (!Previous || !packetEnd(*Previous))
        return std::nullopt;
    }
    for (uint64_t End = Start; End < Start + 16; End += 4) {
      auto Word = readWord(C, End);
      if (!Word)
        return std::nullopt;
      if (packetEnd(*Word))
        return End >= Offset ? std::optional<uint64_t>(Start) : std::nullopt;
    }
    return std::nullopt;
  }

  LinkerWrapper &LW;
  std::unordered_set<std::string> Selected;
  std::once_flag IndexOnce;
  std::unordered_map<const eld::Fragment *, std::vector<Entry>> Symbols;
  std::unordered_set<Symbol> DirectSymbols;
  std::vector<Reference> References;
  std::vector<DebugReference> DebugReferences;
  std::unordered_map<Symbol, std::vector<const DebugReference *>> DebugUses;
  std::unordered_map<Chunk, DebugChunk> DebugChunks;
  std::unordered_map<Symbol, DebugTarget> DebugTargets;
  std::unordered_map<uint32_t, std::string> DebugTypes;
  std::unordered_map<const eld::Fragment *, std::unique_ptr<SourceIndex>>
      SourceUses;
  std::mutex SourceUsesMutex;
  std::mutex ReferencesMutex;
  std::string DebugImage;
  std::atomic<bool> Failed{false};
  uint32_t ErrorID = 0;
  bool Enabled = false;
  bool Debug = false;
};

#endif
