#!/usr/bin/env python3
"""Stress borrowed hashing, deterministic assignments and parallel output."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

from check_address_patterns import inspect, run, sections
from mapping_csv import check_mapping_csv


parser = argparse.ArgumentParser()
parser.add_argument("--compiler", required=True)
parser.add_argument("--compiler-flags", default="")
parser.add_argument("--link", required=True)
parser.add_argument("--readelf")
parser.add_argument("--references", action="store_true")
parser.add_argument("--exclude-ranges", action="store_true")
parser.add_argument("--collisions", action="store_true")
parser.add_argument("--work", type=Path, required=True)
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)
objects = []
expected = {}
selected = (".reassign_a", ".reassign_b")
lengths = (0, 1, 2, 3, 7, 31, 55, 56, 57, 63, 64, 65, 119, 120, 121,
           127, 128, 129, 1024, 65535, 65536, 65537)


def content(file_index, index):
    if args.references:
        if args.collisions and file_index in (0, 15):
            # Real lower-word MD5/SHA1 collisions, in different sections. Repeat
            # them in the last input to check reuse of a collision-resolved ID.
            collision_contents = {
                1: b"md5-collision-0-32678\0", 2: b"md5-collision-0-93183\0",
                3: b"sha1-collision-0-33489\0", 4: b"sha1-collision-0-48140\0",
            }
            if index in collision_contents:
                return collision_contents[index]
        return (b"same\0" if index % 8 == 0 else
                ("string-{}-{}\0".format(file_index, index)).encode())
    return bytes((offset * 37 + 1) % 256 for offset in range(lengths[index]))


for file_index in range(16 if args.references else 1):
    source = []
    src = work / ("input_{}{}".format(file_index, ".s" if args.references else ".c"))
    obj = src.with_suffix(".o")
    for index in range(64 if args.references else len(lengths)):
        name = "fmt_{}".format(index)  # Intentionally repeated across files.
        section = selected[index % 2]
        value = content(file_index, index)
        expected[(obj.name, name)] = value
        if args.references:
            # Repeated and distinct content in different chunks/sections.
            input_section = section + "." + str(index)
            source.extend([
                '.section {},"a",@progbits'.format(input_section),
                ".local " + name, ".type {},@object".format(name), name + ":",
                ".byte " + ",".join(str(byte) for byte in value),
                ".size {},.-{}".format(name, name),
                '.section .data.refs,"aw",@progbits', ".p2align 2",
                ".Lptr_{}: .word 0".format(index),
                ".reloc .Lptr_{}, R_HEX_32, {} + 1".format(index, input_section),
            ])
            if index == 0:
                source.extend([
                    ".text", ".globl entry_{}".format(file_index),
                    ".hidden entry_{}".format(file_index),
                    "entry_{}:".format(file_index),
                    ".Lhigh: .word 0x00004000", ".Llow: .word 0x6a49c000",
                    ".reloc .Lhigh, R_HEX_B32_PCREL_X, " + input_section,
                    ".reloc .Llow, R_HEX_6_PCREL_X, " + input_section + " + 4",
                ])
        else:
            # Every byte value occurs; end nonempty inputs without a NUL.
            size = lengths[index]
            source.append(
                'static const unsigned char {}[{}] __attribute__((used, '
                'aligned(1), section("{}"))) = {{{}}};'.format(
                    name, size, section,
                    ",".join(str(byte) for byte in value)))
    if args.references:
        # Most relocations are irrelevant and must retain normal handling.
        source.extend([
            '.section .data.unselected,"aw",@progbits',
            ".local unrelated", ".type unrelated,@object",
            "unrelated: .word 123", ".size unrelated,4",
            '.section .data.refs,"aw",@progbits',
        ])
        source.extend(".word unrelated" for _ in range(128))
    else:
        source.append("void entry_0(void) {}")
    src.write_text("\n".join(source) + "\n")
    run([args.compiler, *shlex.split(args.compiler_flags), "-c", src, "-o", obj], work)
    objects.append(obj)

script = work / "layout.t"
script.write_text("""SECTIONS {
  .text 0x10000 : { *(.text*) }
  .data : { *(.data*) *(.sdata*) }
  .bss : { *(.bss*) *(.sbss*) }
  .reassign_a 0 (DSECT) : { *(.reassign_a*) }
  .reassign_b 0 (DSECT) : { *(.reassign_b*) }
}""")
image = work / "image.out"
config = work / "plugins.yaml"

for mode in ("md5", "sha1", "seq"):
    exclusions = set()
    ranges = []
    if args.exclude_ranges:
        if mode == "seq":
            ranges = [(0x100, 0x102), (0x180, 0x188), (0x200, 0x210)]
        else:
            # Force use of higher-order slices for every string, not just one
            # fixture, in both serial and parallel hash jobs.
            for value in expected.values():
                digest = getattr(hashlib, mode)(value).digest()
                for i in ((0, 1) if mode == "md5" else (16, 15)):
                    exclusions.add(int.from_bytes(
                        digest[i:i + 4], "little" if mode == "md5" else "big"))
            ranges = [(value, value) for value in sorted(exclusions)]
    range_option = (":exclude_range=" + ",".join("0x{:x}-0x{:x}".format(low, high)
                    for low, high in ranges)) if ranges else ""
    baseline = None
    for compressed in ((False, True) if args.references else (False,)):
        config.write_text("""GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.reassign_a,.reassign_b:hash={}:seq_start=0x100:output_format=csv,json:debug=yes:gzip={}{}
""".format(mode, "yes" if compressed else "no", range_option))
        counts = (0, 1, 2, 4, 8) if args.references else (0, 2, 8)
        for count in counts:
            flags = ["--thread-count", str(count)] if count else ["--no-threads"]
            run([*shlex.split(args.link), *objects, "-T", script, "-e", "entry_0",
                 "--plugin-config", config, "-o", image, *flags,
                 *(["--shared", "--emit-relocs"] if args.references else [])], work)
            payloads = []
            for suffix in ("csv", "json", "debug.json"):
                path = Path(str(image) + ".reassign." + suffix + (".gz" if compressed else ""))
                payloads.append(gzip.decompress(path.read_bytes()) if compressed else path.read_bytes())
            result = (image.read_bytes(), *payloads)
            if baseline is None:
                baseline = result
            assert result == baseline, (mode, count, compressed, "nondeterministic output")
            mapping = json.loads(payloads[1])
            debug = json.loads(payloads[2])
            expected_rows = [["section", "address", "string"]]
            expected_sections = []
            sequential = {}
            assigned_contents = {}
            next_sequential = 0x100
            observed = {}
            reference_count = 0
            for section in debug["sections"]:
                entries = []
                seen = set()
                for symbol in section["symbols"]:
                    key = (Path(symbol["input_file"]).name, symbol["symbol"])
                    assert key not in observed, key
                    value = expected[key]
                    observed[key] = value
                    assert bytes.fromhex(symbol["raw_bytes"]) == value, key
                    text = value[:-1] if value.endswith(b"\0") else value
                    if mode != "seq":
                        digest = getattr(hashlib, mode)(value).digest()
                        offsets = (range(13) if mode == "md5" else
                                   range(16, -1, -1))
                        words = [int.from_bytes(digest[i:i + 4],
                                 "little" if mode == "md5" else "big") for i in offsets]
                        address = next(word for word in words if word not in exclusions and
                                       (word not in assigned_contents or
                                        assigned_contents[word] == value))
                        assigned_contents.setdefault(address, value)
                    else:
                        if text not in sequential:
                            for low, high in ranges:
                                if low <= next_sequential <= high:
                                    next_sequential = high + 1
                            sequential[text] = next_sequential
                            next_sequential += 1
                        address = sequential[text]
                    assert symbol["assigned_address"] == address, (mode, key, address, symbol)
                    reference_count += len(symbol["relocations"])
                    if address not in seen:
                        seen.add(address)
                        entries.append({"address": address, "string": text.decode("latin1")})
                        expected_rows.append([section["section"], "0x{:08X}".format(address),
                                              text.decode("latin1")])
                expected_sections.append({"section": section["section"], "entries": entries})
            assert observed == expected, (len(observed), len(expected))
            assert mapping["sections"] == expected_sections, mode
            check_mapping_csv(payloads[0], expected_rows)
            if args.references:
                assert reference_count == 16 * (64 + 2), reference_count
                info = inspect(args, image)
                by_name = {s["Name"]["Name"]: s for s in sections(info).values()}
                for section in debug["sections"]:
                    for symbol in section["symbols"]:
                        for reloc in symbol["relocations"]:
                            source = reloc["source"]
                            output = by_name[source["output_section"]]
                            offset = output["Offset"] + source["address"] - output["Address"]
                            actual = int.from_bytes(result[0][offset:offset + 4], "little")
                            assert actual == reloc["replacement_data"], reloc
                            assert reloc["value"] == (
                                symbol["assigned_address"] + reloc["target"]["interior_offset"]), reloc
            else:
                assert reference_count == 0

if args.exclude_ranges:
    # Exhaustion must also fail cleanly after all parallel workers have joined,
    # with no partially written mapping/debug artifacts.
    first_content = next(iter(expected.values()))
    for mode in ("md5", "sha1"):
        digest = getattr(hashlib, mode)(first_content).digest()
        words = [int.from_bytes(digest[i:i + 4],
                 "little" if mode == "md5" else "big")
                 for i in range(len(digest) - 3)]
        excluded_values = ",".join("0x{0:x}-0x{0:x}".format(word) for word in words)
        config.write_text("""GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.reassign_a,.reassign_b:hash={}:exclude_range={}:output_format=csv,json:debug=yes
""".format(mode, excluded_values))
        failed_image = work / (mode + "-excluded.out")
        for count in (0, 8):
            flags = ["--thread-count", str(count)] if count else ["--no-threads"]
            command = [*shlex.split(args.link), *objects, "-T", script, "-e", "entry_0",
                       "--plugin-config", config, "-o", failed_image, *flags]
            result = subprocess.run([str(arg) for arg in command], cwd=work,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert result.returncode != 0, (mode, count)
            assert "all {} 32-bit digest slices are excluded".format(mode) in result.stderr, result.stderr
            for suffix in ("csv", "json", "debug.json"):
                assert not Path(str(failed_image) + ".reassign." + suffix).exists(), suffix

# All writers must finish even when two files fail. Diagnostics use option
# order, while the successful debug writer must still produce a complete file.
failure_image = work / "failure.out"
for suffix in ("csv", "json"):
    Path(str(failure_image) + ".reassign." + suffix).mkdir(exist_ok=True)
for formats in ("csv,json", "json,csv"):
    config.write_text("""GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.reassign_a,.reassign_b:output_format={}:debug=yes
""".format(formats))
    command = [*shlex.split(args.link), *objects, "-T", script, "-e", "entry_0",
               "--plugin-config", config, "-o", failure_image, "--thread-count", "8"]
    result = subprocess.run([str(arg) for arg in command], cwd=work,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert result.returncode != 0, formats
    first = formats.split(",")[0]
    assert "failed to write mapping output '{}.reassign.{}'".format(
        failure_image, first) in result.stderr, result.stderr
    debug = json.loads(Path(str(failure_image) + ".reassign.debug.json").read_text())
    assert sum(len(s["symbols"]) for s in debug["sections"]) == len(expected)
