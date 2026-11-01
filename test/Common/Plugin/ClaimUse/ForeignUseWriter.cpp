//===- ForeignUseWriter.cpp -----------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#include "OutputSectionIteratorPlugin.h"
#include "PluginVersion.h"
#include "PointerReloc.h"

using namespace eld::plugin;

class ForeignUseWriter : public OutputSectionIteratorPlugin,
                         public LinkerPluginConfig {
public:
  ForeignUseWriter()
      : OutputSectionIteratorPlugin("ForeignUseWriter"),
        LinkerPluginConfig(this) {}
  void Init(std::string) override {}
  void Init() override {
    auto Result = getLinker()->registerReloc(pointerReloc(*getLinker()));
    if (!Result)
      getLinker()->reportDiagEntry(std::move(Result.error()));
  }
  void processOutputSection(OutputSection) override {}
  Status Run(bool) override { return Status::SUCCESS; }
  void RelocCallBack(Use U) override {
    if (U.getName() != "data")
      return;
    auto Result = getLinker()->setTargetDataForUse(U, 0);
    if (!Result)
      getLinker()->reportDiagEntry(std::move(Result.error()));
  }
  std::string GetName() override { return "ForeignUseWriter"; }
  std::string GetLastErrorAsString() override { return ""; }
  uint32_t GetLastError() override { return 0; }
  void Destroy() override {}
};

ELD_REGISTER_PLUGIN(ForeignUseWriter)

extern "C" LinkerPluginConfig DLL_A_EXPORT *getPluginConfig(const char *) {
  return ThisPlugin;
}
