//===- DWARFInfoTest.cpp --------------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#include "eld/Diagnostics/DiagnosticEngine.h"
#include "eld/Input/Input.h"
#include "eld/Input/InputFile.h"
#include "eld/PluginAPI/DWARF.h"
#include "eld/PluginAPI/PluginADT.h"
#include <gtest/gtest.h>
#include <string>

namespace {

TEST(DWARFInfoTest, InvalidObjectInputDoesNotLeaveAnUncheckedError) {
  eld::DiagnosticEngine DiagEngine(/*useColor=*/false);
  eld::Input Input("invalid-dwarf-input.o", &DiagEngine);
  Input.setResolvedPath("invalid-dwarf-input.o");

  std::string Contents = "not an object file";
  eld::InputFile InputFile(&Input, &DiagEngine);
  InputFile.setContents(Contents);

  eld::plugin::DWARFInfo DWARFInfo{eld::plugin::InputFile(&InputFile)};
  EXPECT_FALSE(DWARFInfo.hasDWARFContext());
}

} // namespace
