//===- OutputFile.h -------------------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#ifndef REASSIGN_OUTPUT_FILE_H
#define REASSIGN_OUTPUT_FILE_H

#include <fstream>
#include <memory>
#include <ostream>
#include <streambuf>
#include <string>
#include <zlib.h>

// Lazy output creation, shared by mapping and debug writers. Gzip streams
// through a fixed-size buffer rather than retaining the complete document.
class OutputFile {
  class GzipBuffer : public std::streambuf {
  public:
    explicit GzipBuffer(gzFile File) : File(File) {
      setp(Data, Data + sizeof(Data));
    }

  protected:
    int_type overflow(int_type C) override {
      if (sync() != 0)
        return traits_type::eof();
      if (!traits_type::eq_int_type(C, traits_type::eof())) {
        *pptr() = traits_type::to_char_type(C);
        pbump(1);
      }
      return traits_type::not_eof(C);
    }

    int sync() override {
      int Size = static_cast<int>(pptr() - pbase());
      if (Size && gzwrite(File, pbase(), Size) != Size)
        return -1;
      pbump(-Size);
      return 0;
    }

  private:
    gzFile File;
    char Data[64 * 1024];
  };

public:
  OutputFile(const std::string &Path, bool Gzip) : Path(Path), Gzip(Gzip) {}

  ~OutputFile() {
    if (CompressedFile)
      gzclose(CompressedFile);
  }

  const std::string &path() const { return Path; }

  std::ostream *open() {
    if (Out)
      return Out;
    if (Gzip) {
      CompressedFile = gzopen(Path.c_str(), "wb9");
      if (!CompressedFile)
        return nullptr;
      Buffer = std::make_unique<GzipBuffer>(CompressedFile);
      CompressedStream = std::make_unique<std::ostream>(Buffer.get());
      Out = CompressedStream.get();
    } else {
      File.open(Path, std::ios::out | std::ios::trunc | std::ios::binary);
      if (!File)
        return nullptr;
      Out = &File;
    }
    return Out;
  }

  bool finish() {
    if (!Out)
      return true;
    Out->flush();
    bool Written = bool(*Out);
    if (CompressedFile) {
      // Closing flushes zlib's buffered data and can reveal late write errors.
      int Status = gzclose(CompressedFile);
      CompressedFile = nullptr;
      return Written && Status == Z_OK;
    }
    File.close();
    return Written && bool(File);
  }

private:
  const std::string Path;
  const bool Gzip;
  std::ofstream File;
  gzFile CompressedFile = nullptr;
  std::unique_ptr<GzipBuffer> Buffer;
  std::unique_ptr<std::ostream> CompressedStream;
  std::ostream *Out = nullptr;
};

#endif
