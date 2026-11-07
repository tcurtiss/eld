//===- ReassignSymbolMutation.cpp -----------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#include "LinkerPlugin.h"
#include "LinkerWrapper.h"
#include "PluginVersion.h"

using namespace eld::plugin;

// Define an existing, sized undefined object through a public API. It must be
// included when defined early, and diagnosed when defined after attribution.
class ReassignSymbolMutation : public LinkerPlugin {
public:
  ReassignSymbolMutation() : LinkerPlugin("ReassignSymbolMutation") {}

  void Init(const std::string &Options) override { Mode = Options; }

  void ActBeforeRuleMatching() override {
    if (Mode == "early")
      define();
  }

  void ActBeforePerformingLayout() override {
    if (Mode != "early")
      define();
  }

private:
  void define() {
    Symbol Late(nullptr);
    Chunk Target(nullptr);
    for (InputFile F : getLinker()->getInputFiles())
      for (Symbol S : F.getSymbols()) {
        if (S.getName() == "late_object")
          Late = S;
        if (S.getName() == (Mode == "late-empty" ? "empty_chunk" : "fmt"))
          Target = S.getChunk();
      }
    if (!Late || !Target) {
      getLinker()->getDiagnosticBuilder(
          getLinker()->getErrorDiagID("missing symbol mutation fixture"));
      return;
    }
    auto Result = getLinker()->resetSymbol(Late, Target);
    if (!Result)
      getLinker()->reportDiagEntry(std::move(Result.error()));
  }

  std::string Mode;
};

ELD_REGISTER_PLUGIN(ReassignSymbolMutation)
