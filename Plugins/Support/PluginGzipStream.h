//===- PluginGzipStream.h--------------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#ifndef ELD_PLUGIN_GZIP_STREAM_H
#define ELD_PLUGIN_GZIP_STREAM_H

#include "PluginPortable.h"
#include "PluginWorkQueue.h"
#include <streambuf>

namespace eld::plugin::portable {

// Stream JSON into independently compressed DEFLATE blocks, then write those
// blocks in order inside ONE gzip member. Multiple gzip members are rejected by
// DecompressionStream in some viewers. Block boundaries and bytes are identical
// for serial and parallel execution; only a bounded window is kept in memory.
class GzipStreamBuffer : public std::streambuf {
public:
  GzipStreamBuffer(std::ostream &Out, ThreadPool *Pool, size_t Workers)
      : Out(Out), Queue(Pool, Pool ? 2 * Workers : 1), Input(BlockSize) {
    const char Header[] = {char(0x1f), char(0x8b), char(0x08), char(0x00),
                           char(0x00), char(0x00), char(0x00), char(0x00),
                           char(0x02), char(0x03)};
    Out.write(Header, sizeof(Header));
    resetBuffer();
  }

  bool finish() {
    if (Finished)
      return Good && bool(Out);
    submit(true);
    drain();
    if (Good) {
      writeLE32(Out, CRC);
      writeLE32(Out, static_cast<uint32_t>(Size));
      Out.flush();
    }
    Finished = true;
    setp(nullptr, nullptr);
    return Good && bool(Out);
  }

protected:
  int_type overflow(int_type C) override {
    if (Finished || !Good || !Out)
      return traits_type::eof();
    submit(false);
    if (!Good || !Out)
      return traits_type::eof();
    if (!traits_type::eq_int_type(C, traits_type::eof())) {
      *pptr() = traits_type::to_char_type(C);
      pbump(1);
    }
    return traits_type::not_eof(C);
  }

  int sync() override {
    if (Finished)
      return Good && bool(Out) ? 0 : -1;
    if (pptr() != pbase())
      submit(false);
    drain();
    Out.flush();
    return Good && bool(Out) ? 0 : -1;
  }

private:
  static constexpr size_t BlockSize = 4 * 1024 * 1024;
  struct CompressedBlock {
    std::vector<uint8_t> Bytes;
    bool Good = false;
  };

  static CompressedBlock compress(const std::vector<char> &Input, bool Final) {
    CompressedBlock Result;
    z_stream Stream{};
    if (deflateInit2(&Stream, Z_BEST_COMPRESSION, Z_DEFLATED, -MAX_WBITS, 8,
                     Z_DEFAULT_STRATEGY) != Z_OK)
      return Result;
    Result.Bytes.resize(deflateBound(&Stream, Input.size()) + 16);
    Stream.next_in =
        reinterpret_cast<Bytef *>(const_cast<char *>(Input.data()));
    Stream.avail_in = static_cast<uInt>(Input.size());
    Stream.next_out = Result.Bytes.data();
    Stream.avail_out = static_cast<uInt>(Result.Bytes.size());
    int Status = deflate(&Stream, Final ? Z_FINISH : Z_SYNC_FLUSH);
    Result.Good = Status == (Final ? Z_STREAM_END : Z_OK) &&
                  Stream.avail_in == 0 && Stream.avail_out != 0;
    Result.Bytes.resize(Stream.total_out);
    // Non-final blocks intentionally leave BFINAL clear and finish on a byte
    // boundary. A fresh compressor may start the next block without referring
    // to the previous block's dictionary; the final block sets BFINAL.
    deflateEnd(&Stream);
    return Result;
  }

  void resetBuffer() { setp(Input.data(), Input.data() + Input.size()); }

  void pop() {
    Queue.pop([&](const CompressedBlock &Block) {
      Good &= Block.Good;
      if (Good)
        Out.write(reinterpret_cast<const char *>(Block.Bytes.data()),
                  Block.Bytes.size());
    });
  }

  void drain() {
    while (!Queue.empty())
      pop();
  }

  void submit(bool Final) {
    if (Queue.full())
      pop();
    size_t Bytes = pptr() - pbase();
    CRC = crc32(CRC, reinterpret_cast<const Bytef *>(pbase()),
                static_cast<uInt>(Bytes));
    Size += Bytes;
    std::vector<char> Block(pbase(), pptr());
    Queue.push(
        [Block = std::move(Block), Final] { return compress(Block, Final); });
    resetBuffer();
  }

  std::ostream &Out;
  OrderedWorkQueue<CompressedBlock> Queue;
  std::vector<char> Input;
  uint32_t CRC = crc32(0, Z_NULL, 0);
  uint64_t Size = 0;
  bool Good = true;
  bool Finished = false;
};

class GzipOutputStream : public std::ostream {
public:
  GzipOutputStream(std::ostream &Out, ThreadPool *Pool, size_t Workers)
      : std::ostream(nullptr), Buffer(Out, Pool, Workers) {
    rdbuf(&Buffer);
    if (!Out)
      setstate(std::ios::badbit);
  }

  bool finish() {
    if (!Buffer.finish())
      setstate(std::ios::badbit);
    return good();
  }

private:
  GzipStreamBuffer Buffer;
};

} // namespace eld::plugin::portable

#endif
