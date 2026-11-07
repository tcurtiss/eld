#!/usr/bin/env python3
# Part of the eld Project, under the BSD License
# See https://github.com/qualcomm/eld/LICENSE.txt for license information.
# SPDX-License-Identifier: BSD-3-Clause
"""Check half-open ID exclusions independently of plugin hash/assignment code."""

import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

from check_address_patterns import inspect, run, symbols
from mapping_csv import check_mapping_csv


MASK32 = 0xffffffff
LIMIT32 = MASK32 + 1
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", required=True)
parser.add_argument("--compiler-flags", default="")
parser.add_argument("--link", required=True)
parser.add_argument("--readelf", required=True)
parser.add_argument("--work", type=Path, required=True)
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)

# Duplicates within/across sections, NUL-normalized duplicates, actual empty
# symbols, and binary content at a two-block padding boundary.
contents = {
    "same_a": (".reassign_a", b"same\0"),
    "other_a": (".reassign_a", b"other\0"),
    "same_a_duplicate": (".reassign_a", b"same\0"),
    "same_b": (".reassign_b", b"same\0"),
    "third_b": (".reassign_b", b"third\0"),
    "no_bytes": (".reassign_empty", b""),
    "nul_only": (".reassign_empty", b"\0"),
    "binary": (".reassign_empty", bytes(range(55)) + b"\0"),
}
source = work / "data.c"
source.write_text("\n".join(
    '__attribute__((used, aligned(1), section("{}"))) '
    'const unsigned char {}[{}] = {{{}}};'.format(
        section, name, len(value), ",".join(str(byte) for byte in value))
    for name, (section, value) in contents.items()) + "\nvoid entry(void) {}\n")
obj = work / "data.o"
run([args.compiler, *shlex.split(args.compiler_flags), "-c", source, "-o", obj], work)
script = work / "layout.t"
script.write_text('''SECTIONS {
  .text 0x10000 : { *(.text*) }
  .reassign_a 0 (DSECT) : { *(.reassign_a) }
  .reassign_b 0 (DSECT) : { *(.reassign_b) }
  .reassign_empty 0 (DSECT) : { *(.reassign_empty) }
}''')


def digest_slices(mode, value):
    digest = getattr(hashlib, mode)(value).digest()
    if mode == "md5":
        return [int.from_bytes(digest[i:i + 4], "little")
                for i in range(len(digest) - 3)]
    return [int.from_bytes(digest[i:i + 4], "big")
            for i in range(len(digest) - 4, -1, -1)]


def excluded(value, ranges):
    return any(low <= value < end for low, end in ranges)


def check(label, mode, ranges=(), value=None, start=0, error=None, extra=""):
    config = work / (label + ".yaml")
    options = ("section=.reassign_a,.reassign_b,.reassign_empty:hash={}:"
               "seq_start={}:output_format=csv,json:debug=yes").format(mode, start)
    if value is None and ranges:
        value = ",".join("0x{:x}-0x{:x}".format(low, high) for low, high in ranges)
    if value is not None:
        options += ":exclude_range=" + value
    options += extra
    config.write_text('''GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: "''' + options + '"\n')
    image = work / (label + ".out")
    # A rerun must not reuse artifacts left by a previously successful link.
    for suffix in (".csv", ".json", ".debug.json"):
        path = Path(str(image) + ".reassign" + suffix)
        if path.exists():
            path.unlink()
    result = subprocess.run([str(arg) for arg in [
        *shlex.split(args.link), obj, "-T", script, "-e", "entry",
        "--plugin-config", config, "-o", image]], cwd=work,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if error:
        assert result.returncode != 0, label
        assert error in result.stderr, (label, result.stderr)
        for suffix in (".csv", ".json", ".debug.json"):
            assert not Path(str(image) + ".reassign" + suffix).exists(), label
        return
    assert result.returncode == 0, (label, result.stdout, result.stderr)
    elf_symbols = {s["Name"]["Name"]: s for s in symbols(inspect(args, image))}
    debug = json.loads(Path(str(image) + ".reassign.debug.json").read_text())
    mapping = json.loads(Path(str(image) + ".reassign.json").read_text())
    assigned = {}
    next_value = start
    expected_sections = []
    expected_rows = [["section", "address", "string"]]
    observed = {}
    for section in debug["sections"]:
        entries = []
        seen = set()
        for symbol in section["symbols"]:
            name = symbol["symbol"]
            expected_section, raw = contents[name]
            assert section["section"] == expected_section, (label, symbol)
            assert bytes.fromhex(symbol["raw_bytes"]) == raw, (label, symbol)
            normalized = raw[:-1] if raw.endswith(b"\0") else raw
            if mode == "seq":
                if normalized not in assigned:
                    while excluded(next_value, ranges):
                        for low, end in ranges:
                            if low <= next_value < end:
                                next_value = end & MASK32
                                break
                    assigned[normalized] = next_value
                    next_value = (next_value + 1) & MASK32
                address = assigned[normalized]
            else:
                address = next(word for word in digest_slices(mode, raw)
                               if not excluded(word, ranges))
            assert not excluded(address, ranges), (label, address)
            assert symbol["assigned_address"] == address, (label, symbol, address)
            assert elf_symbols[name]["Section"]["Name"] == "Absolute", name
            assert elf_symbols[name]["Value"] == address, (label, name, address)
            observed[name] = address
            if address not in seen:
                seen.add(address)
                text = normalized.decode("latin1")
                entries.append({"address": address, "string": text})
                expected_rows.append([expected_section, "0x{:08X}".format(address), text])
        expected_sections.append({"section": section["section"], "entries": entries})
    assert observed.keys() == contents.keys(), (label, observed)
    assert mapping["sections"] == expected_sections, (label, mapping)
    check_mapping_csv(Path(str(image) + ".reassign.csv").read_bytes(), expected_rows)
    return observed


for mode in ("md5", "sha1"):
    words = digest_slices(mode, contents["same_a"][1])
    assert len(set(words)) == len(words), words
    for depth in range(len(words)):
        result = check(mode + "-slice-" + str(depth), mode,
                       [(word, word + 1) for word in words[:depth]])
        assert result["same_a"] == words[depth], (mode, depth, result)
        assert result["same_a"] == result["same_b"] == result["same_a_duplicate"]
    # The start is excluded; the end remains available for the usual digest ID.
    result = check(mode + "-low-inclusive", mode, [(words[0], words[0] + 1)])
    assert result["same_a"] == words[1], (mode, result)
    result = check(mode + "-end-exclusive", mode, [(words[0] - 1, words[0])])
    assert result["same_a"] == words[0], (mode, result)
    check(mode + "-exhausted", mode, [(word, word + 1) for word in words],
          error="all {} 32-bit digest slices are excluded for symbol 'same_a'".format(mode))
    # Excluding every old non-overlapping word must no longer exhaust the hash.
    result = check(mode + "-word-boundaries-excluded", mode,
                   [(word, word + 1) for word in words[::4]])
    assert result["same_a"] == words[1], (mode, result)
    check(mode + "-end-sentinel-exhausted", mode, [(1, LIMIT32)],
          error="all {} 32-bit digest slices are excluded for symbol 'same_a'".format(mode))

check("seq-basic", "seq", [(100, 200), (0x1234, 0x4567), (0xffff0000, 0xfffffff0)],
      value="0x1234-0x4567,100-200,0xffff0000-0xfffffff0", start=99)
result = check("seq-inclusive-start", "seq", [(100, 200)], start=100)
assert result["same_a"] == 200, result
result = check("seq-before-end", "seq", [(100, 200)], start=199)
assert result["same_a"] == 200, result
result = check("seq-exclusive-end", "seq", [(100, 200)], start=200)
assert result["same_a"] == 200, result
result = check("seq-single-excluded", "seq", [(100, 101)], start=100)
assert result["same_a"] == 101, result
check("seq-hexadecimal-range", "seq", [(0x1234, 0x4567)], start=0x1234)
check("seq-upper-range", "seq", [(0xffff0000, 0xfffffff0)], start=0xffff0000)
check("seq-unsorted-overlapping", "seq", [(100, 103), (104, 110)], start=99,
      value="108-110,104-106,100-102,105-109,101-103")
result = check("seq-adjacent", "seq", [(100, 102), (102, 104)], start=100)
assert result["same_a"] == 104, result
result = check("seq-gap", "seq", [(100, 102), (103, 105)], start=99)
assert (result["same_a"] == 99 and result["other_a"] == 102 and
        result["third_b"] == 105), result
check("seq-leading-zero-decimal", "seq", [(100, 200)], value="0100-0200", start=100)
check("seq-whitespace-hex", "seq", [(100, 200)], value=" 0X64 - 0XC8 ", start=100)
check("seq-wrap", "seq", [(0, 2), (MASK32 - 1, LIMIT32)], start=MASK32 - 2)
result = check("seq-final-id-excluded", "seq", [(MASK32, LIMIT32)], start=MASK32)
assert result["same_a"] == 0, result
result = check("seq-decimal-end-sentinel", "seq", [(MASK32, LIMIT32)],
               value="4294967295-4294967296", start=MASK32)
assert result["same_a"] == 0, result
check("seq-single-allowed", "seq", [(0, MASK32)],
      error="sequential address reuse after wrap (ID 4294967295) for symbol 'other_a'")
check("seq-zero-only", "seq", [(1, LIMIT32)], start=MASK32,
      error="sequential address reuse after wrap (ID 0) for symbol 'other_a'")
# Repeated keys have the same last-value-wins policy as other scalar options.
check("seq-repeated", "seq", [(100, 102)], value="0-0x100000000", start=100,
      extra=":exclude_range=100-102")
check("seq-unset", "seq")

invalid = ("", "10", "10-", "-20", "-1-2", "1--2", "1-2-3", "2-1",
           "0x20-0x10", "0-0", "100-100", "0xffffffff-0xffffffff",
           "1-0x100000001", "4294967296-4294967296", "4294967296-4294967297",
           "0-18446744073709551615", "0-18446744073709551616",
           "0x-0x5", "xyz-2", "1-2,", "1-2,,3-4", ",1-2", "1-2junk",
           "+1-2", "0b10-20", "1-+2")
for index, value in enumerate(invalid):
    check("invalid-" + str(index), "md5", value=value,
          error="exclude_range= must be a comma-separated list")
for index, value in enumerate(("0-0x100000000", "2147483648-4294967296,0-2147483648",
                               "0-300,100-4294967296")):
    check("full-" + str(index), "seq", value=value,
          error="exclude_range= leaves no available 32-bit address")

print("Exclude range checks passed")
