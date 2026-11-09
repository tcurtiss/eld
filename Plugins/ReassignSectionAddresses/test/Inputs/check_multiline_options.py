#!/usr/bin/env python3
# Part of the eld Project, under the BSD License
# See https://github.com/qualcomm/eld/LICENSE.txt for license information.
# SPDX-License-Identifier: BSD-3-Clause
"""Validate multiline Options scalars through ELD without a Python YAML package."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

from check_address_patterns import inspect, run, symbols
from mapping_csv import check_mapping_csv


parser = argparse.ArgumentParser()
parser.add_argument("--compiler", required=True)
parser.add_argument("--compiler-flags", default="")
parser.add_argument("--link", required=True)
parser.add_argument("--link-flags", default="")
parser.add_argument("--readelf", required=True)
parser.add_argument("--work", type=Path, required=True)
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)
inputs = Path(__file__).resolve().parent
obj = work / "data.o"
run([args.compiler, *shlex.split(args.compiler_flags), "-fdata-sections",
     "-c", inputs / "data.c", "-o", obj], work)

prefix = """# Comments outside the scalar are YAML comments.
GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: """
contents = {
    ".reassign_a": [("same_a", b"same\0"), ("other_a", b"other\0"),
                    ("same_a_duplicate", b"same\0")],
    ".reassign_b": [("same_b", b"same\0"), ("third_b", b"third\0")],
    ".reassign_clean": [("messy_string", b"A\t\tB\nC\rD\x01\x80\0")],
}
suffix = "string ids"
ranges = ((0, 257), (0x86000000, 0x87000000))


def options(mode):
    return """  section = .reassign_a,
                .reassign_b, .reassign_clean :
  section = .reassign_a :
  hash = sha1 :
  hash = {} :
  seq_start = 0x100 :
  exclude_range = 0x0 - 0x100,
                  256 - 257,
                  0x86000000 - 0x87000000 :
  output_format = json,
                  csv, json :
  output_suffix = old :
  output_suffix = {} :
  gzip = yes :
  debug = yes :
  clean_strings = yes  """.format(mode, suffix)


def block(body, style):
    return prefix + style + " # Comment after the indicator is allowed.\n" + "\n".join(
        "      " + line for line in body.splitlines()) + "\n"


def link(label, config, error=None):
    path = work / (label + ".yaml")
    path.write_bytes(config.encode("utf-8"))
    image = work / (label + ".elf")
    command = [args.link, *shlex.split(args.link_flags), obj,
               "-T", inputs / "script.t", "-e", "main", "-o", image,
               "--plugin-config", path, "--trace=plugin"]
    if error:
        result = subprocess.run([str(arg) for arg in command], cwd=work,
                                text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE)
        assert result.returncode, (label, result.stdout, result.stderr)
        assert error in result.stdout + result.stderr, (label, result)
    else:
        output = run(command, work)
        assert "ignoring unknown" not in output, (label, output)
        assert "ignoring malformed" not in output, (label, output)
    return image


def check(label, config, mode):
    image = link(label, config)
    expected = []
    addresses = {}
    expected_symbols = {}
    next_value = 256
    for section, entries in contents.items():
        seen = set()
        mappings = []
        for name, raw in entries:
            if raw not in addresses:
                if mode == "seq":
                    while any(low <= next_value < end for low, end in ranges):
                        next_value += 1
                    address = next_value
                    next_value += 1
                else:
                    digest = hashlib.md5(raw).digest()
                    candidates = [int.from_bytes(digest[i:i + 4], "little")
                                  for i in range(len(digest) - 3)]
                    address = next(value for value in candidates
                                   if not any(low <= value < end for low, end in ranges)
                                   and value not in addresses.values())
                addresses[raw] = address
            address = addresses[raw]
            expected_symbols[name] = address
            if address not in seen:
                seen.add(address)
                text = "".join(chr(byte) for byte in raw
                               if byte == 9 or 32 <= byte <= 126).rstrip(" \t")
                mappings.append({"address": address, "string": text})
        expected.append({"section": section, "entries": mappings})

    def payload(extension):
        path = Path(str(image) + "." + suffix + "." + extension)
        assert not path.exists(), (label, path)
        return gzip.decompress(Path(str(path) + ".gz").read_bytes())

    mapping = json.loads(payload("json"))
    assert mapping == {"schema_version": 1, "plugin": "ReassignSectionAddresses",
                       "output_file": str(image), "sections": expected}, (label, mapping)
    rows = [["section", "address", "string"]]
    for section in expected:
        rows.extend([[section["section"], "0x{:08X}".format(entry["address"]), entry["string"]]
                     for entry in section["entries"]])
    check_mapping_csv(payload("csv"), rows)
    debug = json.loads(payload("debug.json"))
    assert debug["schema_version"] == 3, (label, debug)
    actual = {sym["symbol"]: sym["assigned_address"]
              for section in debug["sections"] for sym in section["symbols"]}
    assert actual == expected_symbols, (label, debug)
    for section in debug["sections"]:
        expected_bytes = dict(contents[section["section"]])
        for sym in section["symbols"]:
            assert bytes.fromhex(sym["raw_bytes"]) == expected_bytes[sym["symbol"]], (label, sym)
    elf_symbols = {sym["Name"]["Name"]: sym for sym in symbols(inspect(args, image))}
    for name, address in expected_symbols.items():
        assert elf_symbols[name]["Section"]["Name"] == "Absolute", (label, name)
        assert elf_symbols[name]["Value"] == address, (label, name, address)
    assert not list(work.glob(image.name + ".old.*")), label


for mode in ("seq", "md5"):
    for style in (">-", ">", "|-", "|", ">+", "|+"):
        check(mode + "-" + style.replace(">", "folded").replace("|", "literal"),
              block(options(mode), style), mode)

# Ordinary multiline quoted/plain scalars still work without backslashes.
body = options("seq")
for quote in ('"', "'"):
    check("quoted-" + str(ord(quote)), prefix + quote + "\n".join(
        "      " + line for line in body.splitlines()) + quote + "\n", "seq")
plain = ("section=.reassign_a,.reassign_b,.reassign_clean:hash=seq:seq_start=256:"
         "exclude_range=0-256,\n      256-257,0x86000000-0x87000000:"
         "output_format=csv,json:output_suffix=string ids:gzip=yes:debug=yes:clean_strings=yes")
check("plain", prefix + plain + "\n", "seq")
check("crlf-tabs", block(body.replace(" = ", "\t=\t"), "|").replace("\n", "\r\n"), "seq")

# Trimming must not hide empty entries, malformed values or internal whitespace.
invalid = (
    ("section=.reassign_a,\n  , .reassign_b", "section= must not contain empty section names"),
    ("output_format=csv,\n  , json", "output_format= must be"),
    ("output_suffix= \n  ", "output_suffix= must be"),
    ("seq_start=0x1 00", "seq_start= must be"),
    ("exclude_range=0-256,\n  ", "exclude_range= must be"),
    ("exclude_range=257-256", "exclude_range= must be"),
    ("debug=yes please", "debug= must be"),
)
for index, (field, error) in enumerate(invalid):
    for style in (">-", "|-"):
        label = "folded" if style[0] == ">" else "literal"
        link("invalid-{}-{}".format(index, label),
             block("section=.reassign_a:\n" + field, style), error)

# A newline INSIDE a literal suffix remains a forbidden control byte.
link("invalid-internal-newline", block("section=.reassign_a:\noutput_suffix=bad\n  name", "|-"),
     "output_suffix= must be")
for style in (">-", "|-"):
    # '#' inside a block is option content, not a silently stripped comment.
    label = "folded" if style[0] == ">" else "literal"
    image = link("comment-" + label,
                 block("section=.reassign_a:\nhash=seq # not a comment", style))
    value = {sym["Name"]["Name"]: sym["Value"] for sym in symbols(inspect(args, image))}
    assert value["other_a"] == 0x863425c2, value

print("Multiline YAML option checks passed")
