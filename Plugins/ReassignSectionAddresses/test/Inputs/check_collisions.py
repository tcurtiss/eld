#!/usr/bin/env python3
# Part of the eld Project, under the BSD License
# See https://github.com/qualcomm/eld/LICENSE.txt for license information.
# SPDX-License-Identifier: BSD-3-Clause
"""Check global collision handling with real, independently verified digests."""

import argparse
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
parser.add_argument("--readelf", required=True)
parser.add_argument("--work", type=Path, required=True)
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)
MASK32 = 0xffffffff
SELECTED = (".reassign_a", ".reassign_b")


def slices(mode, raw):
    digest = getattr(hashlib, mode)(raw).digest()
    offsets = range(13) if mode == "md5" else range(16, -1, -1)
    return [int.from_bytes(digest[i:i + 4], "little" if mode == "md5" else "big")
            for i in offsets]


def check(label, mode, first, second, exclusions=(), cross=True, reverse=False,
          artifacts=True, third=None, error=None, start=0, ranges=()):
    directory = work / label
    directory.mkdir(exist_ok=True)
    second_section = SELECTED[1] if cross else SELECTED[0]
    contents = {
        "first_a": (SELECTED[0], first),
        "second_b": (second_section, second),
        "repeat_a": (second_section, first),
        "repeat_b": (second_section, second),
    }
    if third is not None:
        contents["third_c"] = (second_section, third)
    source = directory / "data.c"
    source.write_text("\n".join(
        '__attribute__((used, aligned(1), section("{}"))) '
        'static const unsigned char {}[{}] = {{{}}};'.format(
            section, name, len(raw), ",".join(str(byte) for byte in raw))
        for name, (section, raw) in contents.items()) + "\nvoid entry(void) {}\n")
    obj = directory / "data.o"
    run([args.compiler, *shlex.split(args.compiler_flags), "-c", source, "-o", obj], directory)
    script = directory / "layout.t"
    script.write_text('''SECTIONS {
  .text 0x10000 : { *(.text*) }
  .reassign_a 0 (DSECT) : { *(.reassign_a) }
  .reassign_b 0 (DSECT) : { *(.reassign_b) }
}''')
    order = SELECTED[::-1] if reverse else SELECTED
    options = "section={}:hash={}:seq_start={}:output_format={}:debug={}".format(
        ",".join(order), mode, start, "csv,json" if artifacts else "none",
        "yes" if artifacts else "no")
    if exclusions or ranges:
        all_ranges = [(value, value + 1) for value in sorted(set(exclusions))] + list(ranges)
        options += ":exclude_range=" + ",".join("{}-{}".format(low, high)
                                               for low, high in all_ranges)
    config = directory / "plugins.yaml"
    config.write_text('''GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: ''' + options + '\n')
    image = directory / "image.out"
    for suffix in ("csv", "json", "debug.json"):
        path = Path(str(image) + ".reassign." + suffix)
        if path.exists():
            path.unlink()
    result = subprocess.run([str(arg) for arg in [
        *shlex.split(args.link), obj, "-T", script, "-e", "entry", "-o", image,
        "--plugin-config", config]], cwd=directory, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if error:
        assert result.returncode != 0, label
        assert error in result.stderr, (label, result.stderr)
        for suffix in ("csv", "json", "debug.json"):
            assert not Path(str(image) + ".reassign." + suffix).exists(), label
        return
    assert result.returncode == 0, (label, result.stdout, result.stderr)
    occupied = {}
    sequential = {}
    counter = start
    expected = {}
    expected_sections = []
    expected_rows = [["section", "address", "string"]]

    def blocked(address):
        return address in exclusions or any(low <= address < end for low, end in ranges)

    for section in order:
        entries = []
        seen = set()
        for name, (selected, raw) in contents.items():
            if selected != section:
                continue
            text = raw[:-1] if raw.endswith(b"\0") else raw
            if mode == "seq":
                if text not in sequential:
                    while blocked(counter):
                        if counter in exclusions:
                            counter = (counter + 1) & MASK32
                        else:
                            for low, end in ranges:
                                if low <= counter < end:
                                    counter = end & MASK32
                                    break
                    assert counter not in occupied, (label, counter)
                    sequential[text] = counter
                    occupied[counter] = text
                    counter = (counter + 1) & MASK32
                address = sequential[text]
            else:
                address = next(word for word in slices(mode, raw)
                               if not blocked(word) and
                               (word not in occupied or occupied[word] == raw))
                occupied.setdefault(address, raw)
            expected[name] = address
            if address not in seen:
                seen.add(address)
                entries.append({"address": address, "string": text.decode("latin1")})
                expected_rows.append([section, "0x{:08X}".format(address), text.decode("latin1")])
        if entries:
            expected_sections.append({"section": section, "entries": entries})
    elf_symbols = {s["Name"]["Name"]: s for s in symbols(inspect(args, image))}
    for name, address in expected.items():
        assert elf_symbols[name]["Section"]["Name"] == "Absolute", name
        assert elf_symbols[name]["Value"] == address, (label, name, address, elf_symbols[name])
    assert expected["first_a"] == expected["repeat_a"], label
    assert expected["second_b"] == expected["repeat_b"], label
    identity = lambda raw: raw[:-1] if mode == "seq" and raw.endswith(b"\0") else raw
    assert (expected["first_a"] == expected["second_b"]) == (identity(first) == identity(second)), label
    if artifacts:
        mapping = json.loads(Path(str(image) + ".reassign.json").read_text())
        assert mapping["sections"] == expected_sections, (label, mapping)
        check_mapping_csv(Path(str(image) + ".reassign.csv").read_bytes(), expected_rows)
        debug = json.loads(Path(str(image) + ".reassign.debug.json").read_text())
        observed = {s["symbol"]: s["assigned_address"]
                    for section in debug["sections"] for s in section["symbols"]}
        assert observed == expected, (label, observed, expected)
    else:
        for suffix in ("csv", "json", "debug.json"):
            assert not Path(str(image) + ".reassign." + suffix).exists(), label
    return expected


# Birthday-search fixtures at word and byte boundaries. hashlib independently
# verifies the collisions, including the final 32-bit slice of each digest.
samples = {
    "md5": [(32678, 93183), (50942, 82830), (51465, 70722)],
    "sha1": [(33489, 48140), (22228, 79286), (37144, 47387), (54240, 81441)],
}
byte_samples = {
    "md5": [(1, 4841, 27180), (2, 6603, 55940), (3, 80858, 124715),
            (12, 12494, 88181)],
    "sha1": [(1, 6991, 13618), (2, 68094, 100992), (3, 9538, 129652),
             (16, 61218, 76803)],
}
for mode, pairs in samples.items():
    fixtures = [(word_depth * 4, "{}-collision-{}-".format(mode, word_depth), *pair)
                for word_depth, pair in enumerate(pairs)]
    fixtures.extend((depth, "{}-slice-collision-{}-".format(mode, depth), first, second)
                    for depth, first, second in byte_samples[mode])
    for depth, text_prefix, first_index, second_index in fixtures:
        first = (text_prefix + str(first_index)).encode() + b"\0"
        second = (text_prefix + str(second_index)).encode() + b"\0"
        a, b = slices(mode, first), slices(mode, second)
        assert a[depth] == b[depth], (mode, depth)
        exclusions = set(a[:depth] + b[:depth])
        assert a[depth] not in exclusions, (mode, depth)
        prefix = mode + "-slice-" + str(depth)
        if depth + 1 == len(a):
            check(prefix + "-exhausted", mode, first, second, exclusions,
                  error="all {} 32-bit digest slices are excluded or already assigned to different contents for symbol 'second_b'".format(mode))
            result = check(prefix + "-identical-last", mode, first, first, exclusions)
            assert result["first_a"] == a[-1], result
            continue
        assert b[depth + 1] != a[depth] and b[depth + 1] not in exclusions
        result = check(prefix + "-within", mode, first, second, exclusions, cross=False)
        assert result["first_a"] == a[depth] and result["second_b"] == b[depth + 1]
        check(prefix + "-cross", mode, first, second, exclusions)
        check(prefix + "-reverse", mode, first, second, exclusions, reverse=True)
        check(prefix + "-no-artifacts", mode, first, second, exclusions, artifacts=False)
        if depth + 2 < len(b):
            result = check(prefix + "-excluded-alternative", mode, first, second,
                           exclusions | {b[depth + 1]})
            assert result["second_b"] == b[depth + 2], result
        check(prefix + "-exhausted", mode, first, second, exclusions | set(b[depth + 1:]),
              error="all {} 32-bit digest slices are excluded or already assigned to different contents for symbol 'second_b'".format(mode))

# Wrap is legal while the new IDs are unused; duplicates remain legal after
# wrap. Existing IDs must not be reused for distinct contents, across sections.
check("seq-wrap-unused", "seq", b"first\0", b"second\0", start=MASK32,
      third=b"third\0")
check("seq-wrap-duplicates", "seq", b"same\0", b"same\0", start=MASK32)
check("seq-two-allowed", "seq", b"first\0", b"second\0", start=MASK32 - 1,
      ranges=[(0, MASK32 - 1)])
check("seq-cross-exhausted", "seq", b"first\0", b"second\0", start=MASK32 - 1,
      ranges=[(0, MASK32 - 1)], third=b"third\0",
      error="sequential address reuse after wrap (ID 4294967294) for symbol 'third_c'")
check("seq-single-duplicates", "seq", b"same", b"same\0", ranges=[(0, MASK32)])
check("seq-single-exhausted", "seq", b"same", b"same\0", ranges=[(0, MASK32)],
      third=b"different\0",
      error="sequential address reuse after wrap (ID 4294967295) for symbol 'third_c'")

print("Collision checks passed")
