//===- PluginRelocationTest.cpp -------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#include "eld/Config/LinkerConfig.h"
#include "eld/Core/LinkerScript.h"
#include "eld/Core/Module.h"
#include "eld/Diagnostics/DiagnosticEngine.h"
#include "eld/PluginAPI/LinkerWrapper.h"
#include "eld/Readers/Relocation.h"
#include "gtest/gtest.h"
#include <atomic>
#include <thread>
#include <vector>

namespace {

class PluginRelocationTest : public ::testing::Test {
protected:
  eld::DiagnosticEngine Diag{false};
  eld::LinkerConfig Config{&Diag};
  eld::LinkerScript Script{&Diag};
  eld::Module Module{Script, Config, nullptr};
  eld::plugin::LinkerWrapper Owner{nullptr, Module};
  eld::plugin::LinkerWrapper Other{nullptr, Module};
};

TEST_F(PluginRelocationTest, OnlyOwnerCanSupplyClaimedData) {
  eld::Relocation R;
  eld::plugin::Use U(&R);
  ASSERT_TRUE(Module.claimRelocation(&R, &Owner));
  EXPECT_FALSE(Module.claimRelocation(&R, &Owner));
  EXPECT_FALSE(Module.claimRelocation(&R, &Other));
  EXPECT_FALSE(Other.setTargetDataForUse(U, 0xaaaaaaaaaaaaaaaa));
  ASSERT_TRUE(Owner.setTargetDataForUse(U, 0x123456789abcdef0));
  uint64_t Data = 0;
  ASSERT_TRUE(Owner.getTargetDataForUse(U, Data));
  EXPECT_EQ(Data, 0x123456789abcdef0ULL);
}

TEST_F(PluginRelocationTest, ExistingOverridePreventsClaim) {
  eld::Relocation R;
  eld::plugin::Use U(&R);
  ASSERT_TRUE(Other.setTargetDataForUse(U, 0x12345678));
  EXPECT_FALSE(Module.claimRelocation(&R, &Owner));
  EXPECT_FALSE(R.isPluginOwned());
  uint64_t Data = 0;
  ASSERT_TRUE(Other.getTargetDataForUse(U, Data));
  EXPECT_EQ(Data, 0x12345678U);
}

TEST_F(PluginRelocationTest, ConcurrentClaimAndForeignOverrideAreExclusive) {
  constexpr size_t Count = 4096;
  std::vector<eld::Relocation> Relocs(Count);
  std::vector<uint8_t> Claimed(Count), Written(Count);
  std::atomic<unsigned> Ready{0};
  std::atomic<bool> Start{false};
  auto AwaitStart = [&] {
    ++Ready;
    while (!Start.load())
      std::this_thread::yield();
  };
  std::thread Claimant([&] {
    AwaitStart();
    for (size_t I = 0; I < Count; ++I) {
      Claimed[I] = Module.claimRelocation(&Relocs[I], &Owner);
      if (Claimed[I]) {
        eld::plugin::Use U(&Relocs[I]);
        EXPECT_TRUE(Owner.setTargetDataForUse(U, 0x123456789abcdef0));
      }
      if (I % 7 == 0)
        std::this_thread::yield();
    }
  });
  std::thread Writer([&] {
    AwaitStart();
    for (size_t I = 0; I < Count; ++I) {
      eld::plugin::Use U(&Relocs[I]);
      Written[I] = bool(Other.setTargetDataForUse(U, 0xaaaaaaaaaaaaaaaa));
      if (I % 7 == 0)
        std::this_thread::yield();
    }
  });
  while (Ready.load() != 2)
    std::this_thread::yield();
  Start = true;
  Claimant.join();
  Writer.join();
  for (size_t I = 0; I < Count; ++I) {
    EXPECT_NE(Claimed[I], Written[I]) << I;
    uint64_t Data = 0;
    ASSERT_TRUE(Module.getRelocationData(&Relocs[I], Data));
    EXPECT_EQ(Data, Claimed[I] ? 0x123456789abcdef0ULL : 0xaaaaaaaaaaaaaaaaULL)
        << I;
  }
}

} // namespace
