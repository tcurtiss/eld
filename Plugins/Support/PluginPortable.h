// Portable support used by plugins that can be built outside the ELD tree.
// This header intentionally depends only on C++17, zlib, and the public ELD
// plugin API.  It is also usable by the in-tree build.
#ifndef ELD_PLUGIN_PORTABLE_H
#define ELD_PLUGIN_PORTABLE_H

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <optional>
#include <ostream>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include <cxxabi.h>
#include <zlib.h>

namespace eld::plugin::portable {

template <typename T> class ArrayRef {
public:
  ArrayRef() = default;
  ArrayRef(const T *Data, size_t Size) : Data_(Data), Size_(Size) {}
  const T *begin() const { return Data_; }
  const T *end() const { return Data_ + Size_; }
  const T *data() const { return Data_; }
  size_t size() const { return Size_; }
  bool empty() const { return Size_ == 0; }
  const T &operator[](size_t I) const { return Data_[I]; }

private:
  const T *Data_ = nullptr;
  size_t Size_ = 0;
};

inline std::string demangle(const std::string &Name) {
  int Status = 0;
  char *Result = abi::__cxa_demangle(Name.c_str(), nullptr, nullptr, &Status);
  if (Status != 0 || !Result)
    return Name;
  std::string Demangled(Result);
  std::free(Result);
  return Demangled;
}

class GlobPattern {
public:
  static std::optional<GlobPattern> create(std::string Pattern) {
    int BracketDepth = 0;
    int BraceDepth = 0;
    for (size_t I = 0; I < Pattern.size(); ++I) {
      if (Pattern[I] == '\\') {
        ++I;
        continue;
      }
      if (Pattern[I] == '[')
        ++BracketDepth;
      else if (Pattern[I] == ']')
        --BracketDepth;
      else if (Pattern[I] == '{')
        ++BraceDepth;
      else if (Pattern[I] == '}')
        --BraceDepth;
      if (BracketDepth < 0 || BraceDepth < 0)
        return std::nullopt;
    }
    if (BracketDepth != 0 || BraceDepth != 0)
      return std::nullopt;
    return GlobPattern(std::move(Pattern));
  }

  bool match(const std::string &Text) const { return matchAt(0, 0, Text); }

private:
  explicit GlobPattern(std::string Pattern) : Pattern_(std::move(Pattern)) {}

  bool matchAt(size_t P, size_t T, const std::string &Text) const {
    while (P < Pattern_.size()) {
      char C = Pattern_[P];
      if (C == '*') {
        while (P + 1 < Pattern_.size() && Pattern_[P + 1] == '*')
          ++P;
        for (size_t I = T; I <= Text.size(); ++I)
          if (matchAt(P + 1, I, Text))
            return true;
        return false;
      }
      if (C == '?') {
        if (T == Text.size())
          return false;
        ++P;
        ++T;
        continue;
      }
      if (C == '{') {
        size_t End = P + 1;
        int Depth = 1;
        for (; End < Pattern_.size() && Depth; ++End) {
          if (Pattern_[End] == '{')
            ++Depth;
          else if (Pattern_[End] == '}')
            --Depth;
        }
        if (Depth != 0)
          return false;
        size_t BodyEnd = End - 1;
        size_t Start = P + 1;
        int Nested = 0;
        for (size_t I = Start; I <= BodyEnd; ++I) {
          bool Split = I == BodyEnd ||
                       (Pattern_[I] == ',' && Nested == 0);
          if (Pattern_[I] == '{')
            ++Nested;
          else if (Pattern_[I] == '}')
            --Nested;
          if (!Split)
            continue;
          std::string Alternative = Pattern_.substr(Start, I - Start);
          std::string Suffix = Pattern_.substr(End);
          auto Alt = GlobPattern::create(Alternative + Suffix);
          if (Alt && Alt->match(Text.substr(T)))
            return true;
          Start = I + 1;
        }
        return false;
      }
      if (C == '[') {
        if (T == Text.size())
          return false;
        size_t End = Pattern_.find(']', P + 1);
        if (End == std::string::npos)
          return false;
        bool Negated = P + 1 < End &&
                       (Pattern_[P + 1] == '!' || Pattern_[P + 1] == '^');
        size_t I = P + (Negated ? 2 : 1);
        bool Found = false;
        while (I < End) {
          char Lo = Pattern_[I++];
          if (I + 1 < End && Pattern_[I] == '-') {
            ++I;
            char Hi = Pattern_[I++];
            Found |= Lo <= Text[T] && Text[T] <= Hi;
          } else {
            Found |= Lo == Text[T];
          }
        }
        if (Found == Negated)
          return false;
        P = End + 1;
        ++T;
        continue;
      }
      if (C == '\\' && P + 1 < Pattern_.size())
        C = Pattern_[++P];
      if (T == Text.size() || C != Text[T])
        return false;
      ++P;
      ++T;
    }
    return T == Text.size();
  }

  std::string Pattern_;
};

class JSONWriter {
public:
  explicit JSONWriter(std::ostream &Out) : Out_(Out) {}

  template <typename F> void object(F &&Fn) {
    beginValue();
    Out_ << '{';
    Contexts_.push_back({true, true});
    Fn();
    Contexts_.pop_back();
    Out_ << '}';
  }

  template <typename F> void array(F &&Fn) {
    beginValue();
    Out_ << '[';
    Contexts_.push_back({false, true});
    Fn();
    Contexts_.pop_back();
    Out_ << ']';
  }

  template <typename F> void attributeObject(const char *Key, F &&Fn) {
    attributeName(Key);
    Out_ << '{';
    Contexts_.push_back({true, true});
    Fn();
    Contexts_.pop_back();
    Out_ << '}';
  }

  template <typename F> void attributeArray(const char *Key, F &&Fn) {
    attributeName(Key);
    Out_ << '[';
    Contexts_.push_back({false, true});
    Fn();
    Contexts_.pop_back();
    Out_ << ']';
  }

  template <typename T> void attribute(const char *Key, const T &Value) {
    attributeName(Key);
    writeValue(Value);
  }

  template <typename T> void value(const T &Value) {
    beginValue();
    writeValue(Value);
  }

  void flush() { Out_.flush(); }

private:
  struct Context {
    bool Object;
    bool First;
  };

  void beginValue() {
    if (!Contexts_.empty() && !Contexts_.back().Object) {
      if (!Contexts_.back().First)
        Out_ << ',';
      Contexts_.back().First = false;
    }
  }

  void attributeName(const char *Key) {
    if (!Contexts_.empty() && Contexts_.back().Object) {
      if (!Contexts_.back().First)
        Out_ << ',';
      Contexts_.back().First = false;
    }
    writeString(Key);
    Out_ << ':';
  }

  static void writeStringTo(std::ostream &Out, const std::string &Value) {
    Out << '"';
    for (unsigned char C : Value) {
      switch (C) {
      case '"': Out << "\\\""; break;
      case '\\': Out << "\\\\"; break;
      case '\b': Out << "\\b"; break;
      case '\f': Out << "\\f"; break;
      case '\n': Out << "\\n"; break;
      case '\r': Out << "\\r"; break;
      case '\t': Out << "\\t"; break;
      default:
        if (C < 0x20)
          Out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<unsigned>(C) << std::dec << std::setfill('0');
        else
          Out << static_cast<char>(C);
      }
    }
    Out << '"';
  }

  void writeString(const std::string &Value) { writeStringTo(Out_, Value); }
  void writeString(const char *Value) { writeString(std::string(Value)); }

  void writeValue(const std::string &Value) { writeString(Value); }
  void writeValue(const char *Value) { writeString(Value); }
  void writeValue(bool Value) { Out_ << (Value ? "true" : "false"); }

  template <typename T,
            typename std::enable_if_t<std::is_integral<T>::value &&
                                          !std::is_same<T, bool>::value,
                                      int> = 0>
  void writeValue(T Value) {
    if constexpr (std::is_signed<T>::value)
      Out_ << static_cast<long long>(Value);
    else
      Out_ << static_cast<unsigned long long>(Value);
  }

  std::ostream &Out_;
  std::vector<Context> Contexts_;
};

inline std::string toHex(ArrayRef<uint8_t> Bytes, bool LowerCase = true) {
  static constexpr char Digits[] = "0123456789abcdef";
  std::string Result;
  Result.reserve(Bytes.size() * 2);
  for (uint8_t Byte : Bytes) {
    Result.push_back(Digits[Byte >> 4]);
    Result.push_back(Digits[Byte & 15]);
  }
  if (!LowerCase)
    for (char &C : Result)
      C = static_cast<char>(std::toupper(static_cast<unsigned char>(C)));
  return Result;
}

inline void writeLE32(std::ostream &Out, uint32_t Value) {
  char Bytes[4];
  for (unsigned Shift = 0; Shift < 32; Shift += 8)
    Bytes[Shift / 8] = static_cast<char>((Value >> Shift) & 0xff);
  Out.write(Bytes, sizeof(Bytes));
}

inline bool gzipPayload(const std::string &Path, const std::string &Payload) {
  uLongf Bound = compressBound(static_cast<uLong>(Payload.size()));
  std::vector<uint8_t> ZlibData(Bound);
  int Result = compress2(ZlibData.data(), &Bound,
                         reinterpret_cast<const Bytef *>(Payload.data()),
                         static_cast<uLong>(Payload.size()), Z_BEST_COMPRESSION);
  if (Result != Z_OK || Bound < 6)
    return false;
  ZlibData.resize(Bound);
  std::ofstream Out(Path, std::ios::out | std::ios::binary | std::ios::trunc);
  if (!Out)
    return false;
  const char Header[] = {char(0x1f), char(0x8b), char(0x08), char(0x00),
                         char(0x00), char(0x00), char(0x00), char(0x00),
                         char(0x02), char(0x03)};
  Out.write(Header, sizeof(Header));
  Out.write(reinterpret_cast<const char *>(ZlibData.data() + 2), Bound - 6);
  uint32_t CRC = crc32(0, Z_NULL, 0);
  CRC = crc32(CRC, reinterpret_cast<const Bytef *>(Payload.data()),
              static_cast<uInt>(Payload.size()));
  writeLE32(Out, CRC);
  writeLE32(Out, static_cast<uint32_t>(Payload.size()));
  return static_cast<bool>(Out);
}

inline uint32_t leftRotate(uint32_t X, uint32_t N) {
  return (X << N) | (X >> (32 - N));
}

inline uint32_t md5Lower32(ArrayRef<uint8_t> Input) {
  std::vector<uint8_t> Data(Input.begin(), Input.end());
  uint64_t Bits = static_cast<uint64_t>(Data.size()) * 8;
  Data.push_back(0x80);
  while ((Data.size() % 64) != 56)
    Data.push_back(0);
  for (unsigned I = 0; I < 8; ++I)
    Data.push_back(static_cast<uint8_t>(Bits >> (8 * I)));
  uint32_t A0 = 0x67452301, B0 = 0xefcdab89, C0 = 0x98badcfe,
           D0 = 0x10325476;
  static const uint32_t S[64] = {
      7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
      5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
      4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
      6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21};
  static const uint32_t K[64] = {
      0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,
      0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,
      0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,
      0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
      0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,
      0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,
      0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,
      0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
      0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,
      0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,
      0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391};
  for (size_t Offset = 0; Offset < Data.size(); Offset += 64) {
    uint32_t M[16];
    for (unsigned I = 0; I < 16; ++I)
      M[I] = uint32_t(Data[Offset+4*I]) | uint32_t(Data[Offset+4*I+1])<<8 |
             uint32_t(Data[Offset+4*I+2])<<16 | uint32_t(Data[Offset+4*I+3])<<24;
    uint32_t A=A0, B=B0, C=C0, D=D0;
    for (unsigned I = 0; I < 64; ++I) {
      uint32_t F, G;
      if (I < 16) { F=(B&C)|((~B)&D); G=I; }
      else if (I < 32) { F=(D&B)|((~D)&C); G=(5*I+1)%16; }
      else if (I < 48) { F=B^C^D; G=(3*I+5)%16; }
      else { F=C^(B|(~D)); G=(7*I)%16; }
      uint32_t Temp = D; D=C; C=B;
      B = B + leftRotate(A + F + K[I] + M[G], S[I]); A=Temp;
    }
    A0 += A; B0 += B; C0 += C; D0 += D;
  }
  // LLVM's MD5Result::low() reads the first eight digest bytes as a
  // little-endian integer, so its lower 32 bits are the first digest word.
  return A0;
}

inline uint32_t sha1Lower32(ArrayRef<uint8_t> Input) {
  std::vector<uint8_t> Data(Input.begin(), Input.end());
  uint64_t Bits = static_cast<uint64_t>(Data.size()) * 8;
  Data.push_back(0x80);
  while ((Data.size() % 64) != 56)
    Data.push_back(0);
  for (int I = 7; I >= 0; --I)
    Data.push_back(static_cast<uint8_t>(Bits >> (8 * I)));
  uint32_t H0=0x67452301,H1=0xefcdab89,H2=0x98badcfe,H3=0x10325476,H4=0xc3d2e1f0;
  for (size_t Offset=0; Offset<Data.size(); Offset+=64) {
    uint32_t W[80] = {};
    for (unsigned I=0; I<16; ++I)
      W[I]=(uint32_t(Data[Offset+4*I])<<24)|(uint32_t(Data[Offset+4*I+1])<<16)|
           (uint32_t(Data[Offset+4*I+2])<<8)|uint32_t(Data[Offset+4*I+3]);
    for (unsigned I=16; I<80; ++I) W[I]=leftRotate(W[I-3]^W[I-8]^W[I-14]^W[I-16],1);
    uint32_t A=H0,B=H1,C=H2,D=H3,E=H4;
    for (unsigned I=0; I<80; ++I) {
      uint32_t F,K;
      if (I<20) { F=(B&C)|((~B)&D); K=0x5a827999; }
      else if (I<40) { F=B^C^D; K=0x6ed9eba1; }
      else if (I<60) { F=(B&C)|(B&D)|(C&D); K=0x8f1bbcdc; }
      else { F=B^C^D; K=0xca62c1d6; }
      uint32_t T=leftRotate(A,5)+F+E+K+W[I]; E=D; D=C; C=leftRotate(B,30); B=A; A=T;
    }
    H0+=A; H1+=B; H2+=C; H3+=D; H4+=E;
  }
  return H4;
}

} // namespace eld::plugin::portable

#endif
