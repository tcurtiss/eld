//===- PluginWorkQueue.h---------------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#ifndef ELD_PLUGIN_WORK_QUEUE_H
#define ELD_PLUGIN_WORK_QUEUE_H

#include "PluginThreadPool.h"
#include <algorithm>
#include <cassert>
#include <future>
#include <utility>
#include <vector>

namespace eld::plugin {

// A bounded sliding window of tasks. Only the calling thread submits and
// consumes results; workers own their result slots until their future is ready.
// Consumption stays in submission order even when workers finish out of order.
template <typename Result> class OrderedWorkQueue {
public:
  OrderedWorkQueue(ThreadPool *Pool, size_t Capacity)
      : Pool(Pool), Slots(std::max<size_t>(1, Capacity)) {}

  OrderedWorkQueue(const OrderedWorkQueue &) = delete;
  OrderedWorkQueue &operator=(const OrderedWorkQueue &) = delete;

  ~OrderedWorkQueue() {
    // Tasks capture slots, so finish them before destroying any result storage.
    for (auto &Slot : Slots)
      if (Slot.Ready.valid())
        Slot.Ready.wait();
  }

  bool empty() const { return Pending == 0; }
  bool full() const { return Pending == Slots.size(); }

  template <typename Produce> void push(Produce Fn) {
    assert(!full());
    Slot &S = Slots[(Head + Pending) % Slots.size()];
    if (Pool)
      S.Ready =
          Pool->run([&S, Fn = std::move(Fn)]() mutable { S.Value = Fn(); });
    else
      S.Value = Fn();
    ++Pending;
  }

  template <typename Consume> void pop(Consume &&Fn) {
    assert(!empty());
    Slot &S = Slots[Head];
    if (S.Ready.valid())
      S.Ready.get();
    Fn(S.Value);
    S.Value = Result();
    S.Ready = {};
    Head = (Head + 1) % Slots.size();
    --Pending;
  }

private:
  struct Slot {
    Result Value;
    std::shared_future<void> Ready;
  };
  ThreadPool *Pool;
  std::vector<Slot> Slots;
  size_t Head = 0;
  size_t Pending = 0;
};

} // namespace eld::plugin

#endif
