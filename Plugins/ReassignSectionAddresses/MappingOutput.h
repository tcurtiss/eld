//===- MappingOutput.h ----------------------------------------------------===//
// Part of the eld Project, under the BSD License
// See https://github.com/qualcomm/eld/LICENSE.txt for license information.
// SPDX-License-Identifier: BSD-3-Clause
//===----------------------------------------------------------------------===//

#ifndef REASSIGN_MAPPING_OUTPUT_H
#define REASSIGN_MAPPING_OUTPUT_H

#include "../Support/PluginPortable.h"
#include "OutputFile.h"
#include <cstdint>
#include <iomanip>
#include <string>

// Each file has one writer. Stream the frozen mappings in assignment order
// without copying symbol contents, including when gzip is enabled.
class MappingOutput {
public:
  enum class Format { CSV, JSON };

  MappingOutput(const std::string &Image, const std::string &Suffix,
                Format Kind, bool Gzip, bool Clean)
      : Image(Image), Kind(Kind), Clean(Clean),
        File(Image + "." + Suffix + (Kind == Format::JSON ? ".json" : ".csv") +
                 (Gzip ? ".gz" : ""),
             Gzip) {}

  const std::string &path() const { return File.path(); }

  bool write(const std::string &Section, uint32_t Address, const char *Data,
             uint32_t Size) {
    if (!Out) {
      Out = File.open();
      if (!Out)
        return false;
      if (Kind == Format::CSV) {
        *Out << "section,address,string\r\n";
      } else {
        *Out << "{\"schema_version\":1,\"plugin\":\"ReassignSectionAddresses\","
                "\"output_file\":";
        writeText(Image);
        *Out << ",\"sections\":[";
      }
    }
    if (Kind == Format::CSV) {
      writeText(Section);
      *Out << ',';
      *Out << "0x" << std::hex << std::uppercase << std::setfill('0')
           << std::setw(8) << Address << std::nouppercase << std::dec;
      *Out << ',';
      writeString(Data, Size, Clean);
      *Out << "\r\n";
    } else {
      if (!HaveSection || CurrentSection != Section) {
        if (HaveSection)
          *Out << "]},";
        *Out << "{\"section\":";
        writeText(Section);
        *Out << ",\"entries\":[";
        CurrentSection = Section;
        HaveSection = true;
        FirstEntry = true;
      }
      if (!FirstEntry)
        *Out << ',';
      FirstEntry = false;
      *Out << "{\"address\":" << Address << ",\"string\":";
      writeString(Data, Size, Clean);
      *Out << '}';
    }
    return bool(*Out);
  }

  bool finish() {
    if (!Out)
      return true;
    if (Kind == Format::JSON)
      *Out << "]}]}\n";
    return File.finish();
  }

private:
  void writeText(const std::string &Text) {
    if (Kind == Format::CSV) {
      writeString(Text.data(), Text.size(), false);
    } else {
      // Metadata uses its original UTF-8 spelling, unlike raw symbol bytes.
      eld::plugin::portable::JSONWriter JSON(*Out);
      JSON.value(Text);
    }
  }

  void writeString(const char *Data, size_t Size, bool CleanString) {
    if (CleanString)
      // Trim the rendered suffix: spaces/tabs followed by discarded bytes
      // are trailing whitespace too. No cleaned copy of the string is needed.
      while (Data && Size) {
        unsigned char Byte = static_cast<unsigned char>(Data[Size - 1]);
        if (Byte >= 0x21 && Byte <= 0x7e)
          break;
        --Size;
      }
    Out->put('"');
    const char *Hex = "0123456789abcdef";
    for (size_t I = 0; Data && I < Size; ++I) {
      unsigned char Byte = static_cast<unsigned char>(Data[I]);
      if (CleanString && Byte != '\t' && (Byte < 0x20 || Byte > 0x7e))
        continue;
      if (Kind == Format::CSV) {
        if (Byte == '"')
          Out->put('"');
        Out->put(static_cast<char>(Byte));
      } else if (Byte == '"' || Byte == '\\') {
        Out->put('\\');
        Out->put(static_cast<char>(Byte));
      } else if (Byte < 0x20 || Byte >= 0x7f) {
        // Symbol contents are arbitrary bytes, not necessarily UTF-8. Map
        // each non-ASCII byte to U+00xx so JSON is valid and byte-reversible.
        *Out << "\\u00" << Hex[Byte >> 4] << Hex[Byte & 15];
      } else {
        Out->put(static_cast<char>(Byte));
      }
    }
    Out->put('"');
  }

  const std::string Image;
  const Format Kind;
  const bool Clean;
  OutputFile File;
  std::ostream *Out = nullptr;
  std::string CurrentSection;
  bool HaveSection = false;
  bool FirstEntry = true;
};

#endif
