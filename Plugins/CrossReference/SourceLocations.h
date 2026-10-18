//===- SourceLocations.h --------------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#ifndef ELD_CROSSREFERENCE_SOURCELOCATIONS_H
#define ELD_CROSSREFERENCE_SOURCELOCATIONS_H

#include "LinkerPlugin.h"
#include <cstdint>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace crossreference {

struct SourceLoc {
  uint32_t File;
  uint64_t Line;
};

struct FileSources {
  // Paths are interned per file, not copied into each symbol's location.
  std::vector<std::string> Files;
  std::vector<std::pair<eld::plugin::Symbol, SourceLoc>> Locations;
};

struct DIENameInfo {
  std::string Name;
  std::string LinkageName;
};

// Do not use DWARFDie::getName() here. Older ELD packages left a failed
// getAsCString() error unchecked for a malformed/non-string DW_AT_name, which
// aborts the linker when the temporary llvm::Expected is destroyed. The public
// DWARFValue accessor consumes that error and lets this optional enrichment
// skip the malformed DIE instead.
inline DIENameInfo getDIENameInfo(const eld::plugin::DWARFDie &Die) {
  DIENameInfo Result;
  for (eld::plugin::DWARFAttribute &Attr : Die.getAttributes()) {
    std::string Key = Attr.getAttributeName();
    if (Key == "DW_AT_name")
      Result.Name = Attr.getValue().getValueAsString();
    else if (Key == "DW_AT_linkage_name" || Key == "DW_AT_MIPS_linkage_name")
      Result.LinkageName = Attr.getValue().getValueAsString();
  }
  return Result;
}

// One worker owns the entire reader and its transient name index. In
// particular, do not use getDWARFInfoForInputFile here: its section-map context
// does not resolve object relocations and remains cached in the linker. This
// public constructor uses the object-aware reader, and releases the context at
// return.
inline FileSources
readSourceLocations(eld::plugin::InputFile IF,
                    const std::vector<eld::plugin::Symbol> &Wanted) {
  using namespace eld::plugin;
  FileSources Result;
  if (Wanted.empty())
    return Result;
  struct Candidate {
    SourceLoc Loc{0, 0};
    int Rank = -1;
    bool Ambiguous = false;
  };
  std::unordered_map<std::string, Candidate> Names;
  Names.reserve(Wanted.size());
  for (const Symbol &S : Wanted)
    Names.try_emplace(S.getName());

  DWARFInfo Info(IF);
  if (!Info.hasDWARFContext())
    return Result;
  std::unordered_map<std::string, uint32_t> Files;
  for (DWARFUnit &Unit : Info.getDWARFUnits()) {
    for (DWARFDie &Die : Unit.getDIEs()) {
      if (!Die.isSubprogramDIE() && !Die.isVariable())
        continue;
      DWARFDie Naming = Die;
      DIENameInfo NameInfo = getDIENameInfo(Naming);
      std::string Name = NameInfo.Name;
      // Abstract origins can carry names omitted from a concrete DIE. Bound the
      // walk even for malformed/cyclic input; do not guess from plain PCs in
      // relocatable files, where separate sections can have identical PCs.
      for (unsigned Depth = 0; Name.empty() && Depth != 8; ++Depth) {
        DWARFDie Origin = Naming.getReferencedOrigin();
        if (!Origin)
          break;
        Naming = Origin;
        NameInfo = getDIENameInfo(Naming);
        Name = NameInfo.Name;
      }
      auto Match = Names.find(Name);
      // A linkage name is authoritative even when the plain name happens to
      // match another ELF symbol (e.g. global data and namespace::data).
      bool Linkage = !NameInfo.LinkageName.empty();
      if (Linkage)
        Match = Names.find(NameInfo.LinkageName);
      if (Match == Names.end())
        continue;
      std::string File = Die.getDeclFile();
      uint64_t Line = Die.getDeclLine();
      if (File.empty() || !Line) {
        File = Naming.getDeclFile();
        Line = Naming.getDeclLine();
      }
      if (File.empty() || !Line)
        continue;
      auto Entry = Files.try_emplace(File, Result.Files.size());
      if (Entry.second)
        Result.Files.push_back(std::move(File));
      SourceLoc Loc{Entry.first->second, Line};
      int Rank = (Linkage ? 2 : 0) + (!Die.isDeclaration() ? 1 : 0);
      Candidate &C = Match->second;
      if (Rank > C.Rank) {
        C = {Loc, Rank, false};
      } else if (Rank == C.Rank &&
                 (C.Loc.File != Loc.File || C.Loc.Line != Loc.Line)) {
        // Never arbitrarily attach one of several same-name declarations.
        C.Ambiguous = true;
      }
    }
  }
  for (const Symbol &S : Wanted) {
    const Candidate &C = Names.find(S.getName())->second;
    if (C.Rank >= 0 && !C.Ambiguous)
      Result.Locations.emplace_back(S, C.Loc);
  }
  return Result;
}

} // namespace crossreference
#endif
